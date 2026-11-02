import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../../db/audit.js';
import type { Db } from '../../db/client.js';
import { recordLedgerEntry } from '../../db/ledger.js';
import { events, sponsors } from '../../db/schema.js';
import { fromPayPalMoney, PayPalMoney } from '../../paypal/money.js';
import type { WebhookHandler } from '../registry.js';

const ACTOR = 'webhook:paypal-treasury';

// Fields from the documented capture object (PayPal Payments v2, components.schemas.capture in
// paypal/paypal-rest-api-specifications openapi/payments_payment_v2.json).
const CaptureResource = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  amount: PayPalMoney,
  custom_id: z.string().optional(),
  // net_amount = gross_amount - paypal_fee - platform_fees: what actually lands in the Treasury.
  // PayPal omits the breakdown while a capture is pending, so it is optional.
  seller_receivable_breakdown: z.looseObject({ net_amount: PayPalMoney.optional() }).optional(),
});

// A Treasury capture is income only when we can tell which event it belongs to. Whoever creates the
// Treasury order (tickets, donations) sets purchase_units[].custom_id with buildCaptureTag(); a capture
// without a valid tag is left out of the ledger and audited, never guessed.
export const CAPTURE_INCOME_SOURCES = ['ticket', 'donation'] as const;
export type CaptureIncomeSource = (typeof CAPTURE_INCOME_SOURCES)[number];

const TAG = /^qm:([^:]+):(ticket|donation)(?::([^:]+))?$/;

export function buildCaptureTag(eventId: string, source: CaptureIncomeSource, sponsorId?: string) {
  return `qm:${eventId}:${source}${sponsorId ? `:${sponsorId}` : ''}`;
}

export function parseCaptureTag(customId: string | undefined) {
  const match = customId ? TAG.exec(customId) : null;
  if (!match) return null;
  const eventId = z.uuid().safeParse(match[1]);
  const sponsorId = match[3] === undefined ? { success: true as const, data: undefined } : z.uuid().safeParse(match[3]);
  if (!eventId.success || !sponsorId.success) return null;
  return { eventId: eventId.data, source: match[2] as CaptureIncomeSource, sponsorId: sponsorId.data };
}

// Completed Treasury capture -> ledger income. The Procurement app's captures are spend, which the
// payment executor records, so they are ignored here. Idempotent on the capture id.
export function createCaptureCompletedHandler(getDb: () => Db): WebhookHandler {
  return async (event, { app }) => {
    if (app !== 'treasury') return;
    const db = getDb();

    const parsed = CaptureResource.safeParse(event.resource);
    if (!parsed.success) {
      await writeAudit(db, {
        actor: ACTOR,
        action: 'ledger.capture_ignored',
        input: { webhookEventId: event.id },
        reason: 'PAYMENT.CAPTURE.COMPLETED resource is not a capture',
      });
      return;
    }
    const capture = parsed.data;
    if (capture.status !== 'COMPLETED') return;

    // Spendable income is what the Treasury received after PayPal's fees, not the gross the buyer paid.
    const net = capture.seller_receivable_breakdown?.net_amount;
    const basis: 'net' | 'gross' = net ? 'net' : 'gross';
    let money: { amountMinor: number; currency: string };
    try {
      money = fromPayPalMoney(net ?? capture.amount);
    } catch (err) {
      await writeAudit(db, {
        actor: ACTOR,
        action: 'ledger.capture_ignored',
        input: { webhookEventId: event.id, captureId: capture.id },
        reason: err instanceof Error ? err.message : 'unreadable amount',
        paypalId: capture.id,
      });
      return;
    }

    const unmatched = (reason: string) =>
      writeAudit(db, {
        actor: ACTOR,
        action: 'ledger.capture_unmatched',
        input: { webhookEventId: event.id, captureId: capture.id, amount: money.amountMinor, currency: money.currency },
        reason,
        paypalId: capture.id,
      });

    const tag = parseCaptureTag(capture.custom_id);
    if (!tag) {
      await unmatched('capture has no valid Quartermaster custom_id tag');
      return;
    }
    const [target] = await db.select({ id: events.id }).from(events).where(eq(events.id, tag.eventId));
    if (!target) {
      await unmatched('custom_id names an event that does not exist');
      return;
    }
    if (tag.sponsorId) {
      const [sponsor] = await db
        .select({ id: sponsors.id })
        .from(sponsors)
        .where(and(eq(sponsors.id, tag.sponsorId), eq(sponsors.eventId, tag.eventId)));
      if (!sponsor) {
        await unmatched('custom_id names a sponsor that is not part of that event');
        return;
      }
    }

    await db.transaction(async (tx) => {
      const recorded = await recordLedgerEntry(tx, {
        eventId: tag.eventId,
        direction: 'in',
        amount: money.amountMinor,
        currency: money.currency,
        source: tag.source,
        paypalId: capture.id,
        captureId: capture.id,
        sponsorId: tag.sponsorId ?? null,
      });
      if (recorded) {
        await writeAudit(tx, {
          actor: ACTOR,
          action: 'ledger.income_recorded',
          input: {
            webhookEventId: event.id,
            source: tag.source,
            sponsorId: tag.sponsorId ?? null,
            amount: money.amountMinor,
            currency: money.currency,
            amountBasis: basis,
          },
          reason:
            basis === 'net'
              ? 'PAYMENT.CAPTURE.COMPLETED on the Treasury app, net of PayPal fees'
              : 'PAYMENT.CAPTURE.COMPLETED on the Treasury app; no seller_receivable_breakdown.net_amount, so the gross amount was recorded (fees reconciled via Transaction Search)',
          paypalId: capture.id,
        });
      }
    });
  };
}
