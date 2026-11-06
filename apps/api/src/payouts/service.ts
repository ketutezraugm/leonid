import type { CreatePayoutRequest, PayoutItem, PayoutItemStatus, WidgetFilter } from '@quartermaster/shared';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { maskEmail } from '../claims/service.js';
import { writeAudit } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { getEvent } from '../db/events.js';
import { claims, payouts, volunteers } from '../db/schema.js';
import type { SpendOutcome } from '../payments/executor.js';
import type { ApprovalStatus, Spend } from '../payments/ports.js';
import { payoutItemStatusOf } from '../paypal/payout-status.js';

// F17: prizes and speaker fees, and what PayPal says happened to every payout item (claims included).
// Money moves only through the executor (rules check, audit, Treasury payout). Status after that comes from
// PayPal's payout item webhooks (invariant 5); this file never marks anything paid on its own.

export interface PayoutDeps {
  db: Db;
  requestSpend?: (spend: Spend) => Promise<SpendOutcome>;
  approvalStatus?: (referenceId: string) => Promise<ApprovalStatus | undefined>;
}

type PayoutRow = typeof payouts.$inferSelect;
type ClaimRow = typeof claims.$inferSelect;
type PayoutPatch = Partial<typeof payouts.$inferInsert>;

export const payoutReference = (payoutId: string) => `payout:${payoutId}`;

async function update(db: Db, id: string, patch: PayoutPatch): Promise<PayoutRow> {
  const [row] = await db.update(payouts).set({ ...patch, updatedAt: new Date() }).where(eq(payouts.id, id)).returning();
  return row!;
}

function outcomePatch(outcome: SpendOutcome): PayoutPatch {
  switch (outcome.status) {
    case 'submitted':
      return { status: 'processing', reasons: [], paypalBatchId: outcome.batchId };
    case 'paid':
      return { status: 'processing', reasons: [], paypalBatchId: outcome.captureId ?? outcome.orderId };
    case 'needs_approval':
      return { status: 'pending_approval', reasons: outcome.reasons };
    case 'blocked':
      return { status: 'blocked', reasons: outcome.reasons };
    case 'refused':
      return { status: 'failed', reasons: [`not sent: ${outcome.reason.replaceAll('_', ' ')}`] };
    case 'failed':
      return { status: 'failed', reasons: ['PayPal did not take the payout; check it before trying again'] };
  }
}

// A prize or speaker fee: recorded, then sent to the rules engine. Undefined when the event does not exist.
export async function createPayout(
  deps: PayoutDeps,
  eventId: string,
  input: Omit<CreatePayoutRequest, 'eventId'>,
  actor: string,
): Promise<PayoutRow | undefined> {
  const event = await getEvent(deps.db, eventId);
  if (!event) return undefined;
  const [row] = await deps.db
    .insert(payouts)
    .values({
      eventId,
      kind: input.kind,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail.toLowerCase(),
      countryCode: input.countryCode ?? null,
      amount: input.amount,
      currency: event.currency,
      category: input.category,
      sponsorId: input.sponsorId ?? null,
      note: input.note,
    })
    .returning();
  const payout = row!;
  if (!deps.requestSpend) {
    return update(deps.db, payout.id, { status: 'failed', reasons: ['payouts are not set up on this server yet'] });
  }
  const outcome = await deps.requestSpend({
    referenceId: payoutReference(payout.id),
    amountMinor: payout.amount,
    currency: payout.currency,
    actor,
    reason: `${payout.kind === 'prize' ? 'Prize' : 'Speaker fee'} for ${payout.recipientName}`,
    category: payout.category,
    eventId,
    kind: 'payout',
    payee: payout.recipientName,
    payeeEmail: payout.recipientEmail,
    fundedBySponsorId: payout.sponsorId ?? undefined,
  });
  return update(deps.db, payout.id, outcomePatch(outcome));
}

// --- PayPal's payout item webhooks

// A late "pending" never turns a settled item back.
const SETTLED: readonly string[] = ['paid', 'failed', 'returned', 'blocked'];
const mayMove = (from: string | null, to: PayoutItemStatus) => from !== to && !(from && SETTLED.includes(from) && to === 'processing');

export interface PayoutItemUpdate {
  senderItemId: string;
  transactionStatus: string | null;
  paypalItemId: string;
  webhookEventId: string;
}

export type PayoutItemMatch = 'claim' | 'payout' | 'unmatched' | 'unknown_status' | 'unchanged';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What one payout item event means for our records. sender_item_id is our reference id (claim:<id> or payout:<id>),
// because paypal/payouts.ts sends it as both sender_batch_id and sender_item_id.
export async function applyPayoutItem(db: Db, item: PayoutItemUpdate): Promise<PayoutItemMatch> {
  const status = payoutItemStatusOf(item.transactionStatus);
  const audit = (action: string, reason: string) =>
    writeAudit(db, {
      actor: 'paypal-webhook',
      action,
      input: { webhookEventId: item.webhookEventId, senderItemId: item.senderItemId, transactionStatus: item.transactionStatus },
      reason,
      paypalId: item.paypalItemId,
    });
  if (!status) {
    await audit('payout.status_unknown', `PayPal status ${item.transactionStatus ?? 'missing'} is not one we know; left as it was`);
    return 'unknown_status';
  }
  const [kind, id = ''] = item.senderItemId.split(':');
  const uuid = UUID.test(id) ? id : null;

  if (kind === 'payout' && uuid) {
    const [row] = await db.select().from(payouts).where(eq(payouts.id, uuid));
    if (row) {
      if (!mayMove(row.status, status)) return 'unchanged';
      await update(db, row.id, { status, paypalItemId: item.paypalItemId });
      await audit('payout.status', `PayPal says the payout is ${status}`);
      return 'payout';
    }
  }
  if (kind === 'claim' && uuid) {
    const [row] = await db.select().from(claims).where(eq(claims.id, uuid));
    if (row) {
      if (!mayMove(row.payoutStatus, status)) return 'unchanged';
      const claimPatch: Partial<typeof claims.$inferInsert> =
        status === 'paid'
          ? { status: 'paid', reasons: [] }
          : status === 'unclaimed'
            ? { reasons: ['PayPal is holding it until a PayPal account for this email is set up'] }
            : status === 'processing' || status === 'pending_approval' || status === 'queued'
              ? {}
              : { status: 'rejected', reasons: [`PayPal could not pay it out (${status}); the treasurer will follow up`] };
      const payoutStatus = status === 'pending_approval' || status === 'queued' ? null : status;
      await db
        .update(claims)
        .set({ ...claimPatch, payoutStatus, paypalItemId: item.paypalItemId, updatedAt: new Date() })
        .where(eq(claims.id, row.id));
      await audit('payout.status', `PayPal says the claim payout is ${status}`);
      return 'claim';
    }
  }
  await audit('payout.status_unmatched', 'no claim or payout has this sender_item_id');
  return 'unmatched';
}

// --- The ledger: every payout item of an event, claims included, in the shared PayoutItem shape.

const claimItemStatus = (c: Pick<ClaimRow, 'status' | 'payoutStatus'>): PayoutItemStatus => {
  if (c.payoutStatus) return c.payoutStatus;
  switch (c.status) {
    case 'paid':
      return 'paid';
    case 'approved':
      return 'processing';
    case 'pending_approval':
      return 'pending_approval';
    case 'rejected':
      return 'blocked';
    default:
      return 'queued';
  }
};

// A payout waiting on the Approvals screen settles there; read it so this list agrees.
async function settled(deps: PayoutDeps, row: PayoutRow): Promise<PayoutRow> {
  if (row.status !== 'pending_approval' || !deps.approvalStatus) return row;
  const status = await deps.approvalStatus(payoutReference(row.id));
  if (status === 'paid' || status === 'capturing') return update(deps.db, row.id, { status: 'processing', reasons: [] });
  if (status === 'rejected') return update(deps.db, row.id, { status: 'blocked', reasons: ['the treasurer declined it'] });
  return row;
}

export function payoutItemOf(row: PayoutRow): PayoutItem {
  return {
    id: row.id,
    eventId: row.eventId,
    payoutId: row.paypalBatchId,
    kind: row.kind,
    recipientName: row.recipientName,
    destination: { recipientType: 'EMAIL', receiver: maskEmail(row.recipientEmail), countryCode: row.countryCode },
    amount: row.amount,
    currency: row.currency,
    category: row.category,
    sponsorId: row.sponsorId,
    claimId: null,
    note: (row.reasons.length > 0 ? row.reasons.join('; ') : row.note).slice(0, 4000),
    senderItemId: payoutReference(row.id),
    paypalItemId: row.paypalItemId,
    status: row.status,
    ruleResult: null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPayoutItems(deps: PayoutDeps, eventId: string, filter: WidgetFilter = {}): Promise<PayoutItem[]> {
  const [payoutRows, claimRows] = await Promise.all([
    deps.db.select().from(payouts).where(eq(payouts.eventId, eventId)).orderBy(desc(payouts.createdAt)).limit(200),
    deps.db
      .select({
        id: claims.id,
        eventId: claims.eventId,
        category: claims.category,
        amount: claims.amount,
        currency: claims.currency,
        status: claims.status,
        payoutStatus: claims.payoutStatus,
        reasons: claims.reasons,
        paypalBatchId: claims.paypalBatchId,
        paypalItemId: claims.paypalItemId,
        updatedAt: claims.updatedAt,
        name: volunteers.name,
        email: volunteers.payoutEmail,
      })
      .from(claims)
      .innerJoin(volunteers, eq(volunteers.id, claims.volunteerId))
      .where(and(eq(claims.eventId, eventId), isNotNull(claims.amount)))
      .orderBy(desc(claims.submittedAt))
      .limit(200),
  ]);
  const fromPayouts = (await Promise.all(payoutRows.map((r) => settled(deps, r)))).map(payoutItemOf);
  const fromClaims: PayoutItem[] = claimRows
    .filter((c) => (c.amount ?? 0) > 0)
    .map((c) => ({
      id: c.id,
      eventId: c.eventId,
      payoutId: c.paypalBatchId,
      kind: 'claim' as const,
      recipientName: c.name,
      destination: { recipientType: 'EMAIL' as const, receiver: maskEmail(c.email), countryCode: null },
      amount: c.amount!,
      currency: c.currency,
      category: c.category,
      sponsorId: null,
      claimId: c.id,
      note: c.reasons.join('; ').slice(0, 4000),
      senderItemId: `claim:${c.id}`,
      paypalItemId: c.paypalItemId,
      status: claimItemStatus(c),
      ruleResult: null,
      updatedAt: c.updatedAt.toISOString(),
    }));
  return [...fromPayouts, ...fromClaims].filter(
    (item) => (!filter.sponsorId || item.sponsorId === filter.sponsorId) && (!filter.category || item.category === filter.category),
  );
}
