import { createHash, randomBytes } from 'node:crypto';
import { ReceiptExtraction, type ClaimView, type ClaimVolunteer } from '@quartermaster/shared';
import type { LanguageModel } from 'ai';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { getEvent } from '../db/events.js';
import { claims, volunteers } from '../db/schema.js';
import type { SpendOutcome } from '../payments/executor.js';
import type { ApprovalStatus, Spend } from '../payments/ports.js';
import { extractReceipt, reviewReasons } from './extract.js';

// F16 receipt claims. A claim is money out, so it moves only one way: as a `kind: 'claim'` spend through the
// executor, which runs the rules check (the $50 per person per day cap, the approval threshold, the funds
// gate), writes the audit row and sends the payout from the Treasury app. Nothing here calls PayPal.

export interface ClaimDeps {
  db: Db;
  model?: LanguageModel;
  // executor.requestSpend. Undefined when this server cannot pay (PayPal not configured): claims then wait
  // for a human instead of being paid.
  requestSpend?: (spend: Spend) => Promise<SpendOutcome>;
  // What happened to a claim's approval on the Approvals screen (approvals.findByReference).
  approvalStatus?: (referenceId: string) => Promise<ApprovalStatus | undefined>;
}

type ClaimRow = typeof claims.$inferSelect;
export type VolunteerRow = typeof volunteers.$inferSelect;

export const claimReference = (claimId: string) => `claim:${claimId}`;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// a***@example.com: enough for the treasurer to recognise it, not enough to read it off a screenshot.
export const maskEmail = (email: string) => {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
};

const volunteerView = (v: VolunteerRow): ClaimVolunteer => ({
  id: v.id,
  eventId: v.eventId,
  name: v.name,
  payoutEmailHint: maskEmail(v.payoutEmail),
});

export async function createVolunteer(db: Db, input: { eventId: string; name: string; payoutEmail: string }) {
  const claimToken = randomBytes(24).toString('base64url');
  const [row] = await db
    .insert(volunteers)
    .values({
      eventId: input.eventId,
      name: input.name,
      payoutEmail: input.payoutEmail.toLowerCase(),
      tokenHash: hashToken(claimToken),
    })
    .returning();
  return { volunteer: volunteerView(row!), claimToken };
}

export async function findVolunteerByToken(db: Db, token: string): Promise<VolunteerRow | undefined> {
  if (!token || token.length > 200) return undefined;
  const [row] = await db.select().from(volunteers).where(eq(volunteers.tokenHash, hashToken(token)));
  return row;
}

type ClaimPatch = Partial<typeof claims.$inferInsert>;
async function update(db: Db, id: string, patch: ClaimPatch): Promise<ClaimRow> {
  const [row] = await db.update(claims).set({ ...patch, updatedAt: new Date() }).where(eq(claims.id, id)).returning();
  return row!;
}

// What the executor's answer means for the claim.
function outcomePatch(outcome: SpendOutcome): ClaimPatch {
  switch (outcome.status) {
    case 'submitted':
      return { status: 'approved', reasons: [], paypalBatchId: outcome.batchId };
    case 'paid':
      return { status: 'approved', reasons: [], paypalBatchId: outcome.captureId ?? outcome.orderId };
    case 'needs_approval':
      return { status: 'pending_approval', reasons: outcome.reasons };
    case 'blocked':
      return { status: 'rejected', reasons: outcome.reasons };
    case 'refused':
      return { status: 'needs_review', reasons: [`not sent: ${outcome.reason.replaceAll('_', ' ')}`] };
    case 'failed':
      return { status: 'needs_review', reasons: ['PayPal did not take the payout; check it before trying again'] };
  }
}

// Sends a claim's amount to the rules engine and records what came back. One reference per claim, so a
// repeat can never pay twice; a different amount for the same claim is refused by the executor.
async function payClaim(deps: ClaimDeps, claim: ClaimRow, volunteer: VolunteerRow, amount: number, actor: string): Promise<ClaimRow> {
  if (!deps.requestSpend) {
    return update(deps.db, claim.id, { amount, status: 'needs_review', reasons: ['payouts are not set up on this server yet'] });
  }
  const outcome = await deps.requestSpend({
    referenceId: claimReference(claim.id),
    amountMinor: amount,
    currency: claim.currency,
    actor,
    // Our own words only: the receipt's text never reaches the Approvals screen as reasoning.
    reason: `Receipt claim (${claim.category}) for ${volunteer.name}`,
    category: claim.category,
    eventId: claim.eventId,
    kind: 'claim',
    payee: volunteer.name,
    payeeEmail: volunteer.payoutEmail,
  });
  return update(deps.db, claim.id, { amount, ...outcomePatch(outcome) });
}

// A volunteer's new claim: store it, read the receipt, and pay it through the rules engine when the reading is
// clear. Anything unclear waits for the treasurer. Undefined when the volunteer's event is gone.
export async function submitClaim(
  deps: ClaimDeps,
  volunteer: VolunteerRow,
  input: { category: string; image: Buffer; mimeType: string },
): Promise<ClaimRow | undefined> {
  const event = await getEvent(deps.db, volunteer.eventId);
  if (!event) return undefined;
  const [inserted] = await deps.db
    .insert(claims)
    .values({
      eventId: volunteer.eventId,
      volunteerId: volunteer.id,
      category: input.category,
      receiptMime: input.mimeType,
      receiptImage: input.image,
      currency: event.currency,
    })
    .returning();
  const claim = inserted!;
  const read = await extractReceipt(deps.model, { data: input.image, mediaType: input.mimeType });
  if (read.kind === 'unread') return update(deps.db, claim.id, { status: 'needs_review', reasons: [read.why] });
  const doubts = reviewReasons(read.extraction, event.currency);
  if (doubts.length > 0) {
    return update(deps.db, claim.id, {
      extracted: read.extraction,
      amount: read.extraction.total,
      status: 'needs_review',
      reasons: doubts,
    });
  }
  const withReading = await update(deps.db, claim.id, { extracted: read.extraction });
  return payClaim(deps, withReading, volunteer, read.extraction.total, `volunteer:${volunteer.id}`);
}

// The treasurer read a receipt that was waiting on review and confirms the amount. It still goes through the
// rules engine. Only a claim waiting on review can be confirmed, so a claim already sent is never sent again.
export async function reviewClaim(
  deps: ClaimDeps,
  claimId: string,
  amount: number,
  actor: string,
  eventId?: string,
): Promise<{ claim: ClaimView } | { error: 'not_found' | 'not_waiting' }> {
  const where = eventId ? and(eq(claims.id, claimId), eq(claims.eventId, eventId)) : eq(claims.id, claimId);
  const [row] = await deps.db.select().from(claims).where(where);
  if (!row) return { error: 'not_found' };
  if (row.status !== 'needs_review') return { error: 'not_waiting' };
  const [volunteer] = await deps.db.select().from(volunteers).where(eq(volunteers.id, row.volunteerId));
  if (!volunteer) return { error: 'not_found' };
  return { claim: claimView(await payClaim(deps, row, volunteer, amount, actor), volunteer.name) };
}

// Never selects the image, so lists stay small.
const listColumns = {
  id: claims.id,
  eventId: claims.eventId,
  volunteerId: claims.volunteerId,
  category: claims.category,
  extracted: claims.extracted,
  amount: claims.amount,
  currency: claims.currency,
  status: claims.status,
  reasons: claims.reasons,
  paypalBatchId: claims.paypalBatchId,
  submittedAt: claims.submittedAt,
};
type ListedClaim = Pick<ClaimRow, keyof typeof listColumns>;

export function claimView(row: ListedClaim, volunteerName: string): ClaimView {
  const extracted = row.extracted ? ReceiptExtraction.safeParse(row.extracted) : null;
  return {
    id: row.id,
    eventId: row.eventId,
    volunteerName,
    category: row.category,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    reasons: row.reasons,
    extracted: extracted?.success ? extracted.data : null,
    paypalBatchId: row.paypalBatchId,
    submittedAt: row.submittedAt.toISOString(),
  };
}

// A claim sent to the Approvals screen settles there. Read its approval so both screens agree.
async function settled(deps: ClaimDeps, row: ListedClaim): Promise<ListedClaim> {
  if (row.status !== 'pending_approval' || !deps.approvalStatus) return row;
  const status = await deps.approvalStatus(claimReference(row.id));
  const patch: ClaimPatch | undefined =
    status === 'paid'
      ? { status: 'approved', reasons: [] }
      : status === 'rejected'
        ? { status: 'rejected', reasons: ['the treasurer declined it'] }
        : undefined;
  return patch ? update(deps.db, row.id, patch) : row;
}

const views = async (deps: ClaimDeps, rows: ListedClaim[], nameOf: (volunteerId: string) => string) =>
  Promise.all(rows.map(async (row) => claimView(await settled(deps, row), nameOf(row.volunteerId))));

export async function listVolunteerClaims(deps: ClaimDeps, volunteer: VolunteerRow): Promise<ClaimView[]> {
  const rows = await deps.db
    .select(listColumns)
    .from(claims)
    .where(eq(claims.volunteerId, volunteer.id))
    .orderBy(desc(claims.submittedAt))
    .limit(50);
  return views(deps, rows, () => volunteer.name);
}

export async function listEventClaims(deps: ClaimDeps, eventId: string): Promise<{ claims: ClaimView[]; volunteers: ClaimVolunteer[] }> {
  const [people, rows] = await Promise.all([
    deps.db.select().from(volunteers).where(eq(volunteers.eventId, eventId)).orderBy(volunteers.name),
    deps.db.select(listColumns).from(claims).where(eq(claims.eventId, eventId)).orderBy(desc(claims.submittedAt)).limit(200),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  return { claims: await views(deps, rows, (id) => names.get(id) ?? 'Unknown'), volunteers: people.map(volunteerView) };
}

export async function getReceipt(db: Db, claimId: string) {
  const [row] = await db.select({ image: claims.receiptImage, mime: claims.receiptMime }).from(claims).where(eq(claims.id, claimId));
  return row;
}
