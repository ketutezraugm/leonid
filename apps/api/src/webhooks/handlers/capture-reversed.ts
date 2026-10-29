import { z } from 'zod';
import { writeAudit } from '../../db/audit.js';
import type { Db } from '../../db/client.js';
import { findIncomeByCapture, INCOME_REVERSAL_SOURCE, recordLedgerEntry } from '../../db/ledger.js';
import { fromPayPalMoney, PayPalMoney } from '../../paypal/money.js';
import type { WebhookHandler } from '../registry.js';

const ACTOR = 'webhook:paypal-treasury';

export const INCOME_REVERSAL_EVENTS = ['PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED'] as const;

// Both events carry a Payments v2 refund (components.schemas.refund in paypal/paypal-rest-api-specifications
// openapi/payments_payment_v2.json). The refund points at the capture it undoes with a HATEOAS link
// rel "up" -> /v2/payments/captures/{capture_id} (see the "Show refund details" sample response).
const ReversalResource = z.looseObject({
  id: z.string().min(1),
  status: z.string().optional(),
  amount: PayPalMoney,
  // net_amount is what left the Treasury balance (gross refunded minus any fee PayPal returned).
  seller_payable_breakdown: z.looseObject({ net_amount: PayPalMoney.optional() }).optional(),
  links: z.array(z.looseObject({ rel: z.string(), href: z.string() })).default([]),
});
type ReversalResource = z.infer<typeof ReversalResource>;

// A refund that failed or was cancelled moved no money. PENDING is counted already: the money is
// leaving, and treating it as still spendable is the unsafe direction.
const NO_MONEY_MOVED = new Set(['FAILED', 'CANCELLED']);

const CAPTURE_HREF = /\/v2\/payments\/captures\/([^/?#]+)/;

function originalCaptureId(resource: ReversalResource, eventType: string): string | null {
  const up = resource.links.find((l) => l.rel === 'up' && CAPTURE_HREF.test(l.href));
  if (up) return CAPTURE_HREF.exec(up.href)?.[1] ?? null;
  // PayPal publishes no REVERSED sample. If it ever carries the reversed capture itself instead of a
  // refund, the resource id is the capture id; it is still only used if that capture is our income.
  if (eventType === 'PAYMENT.CAPTURE.REVERSED' && resource.status === 'REVERSED') return resource.id;
  return null;
}

// The refund schema documents amount as the (positive) amount refunded. With no published REVERSED
// sample, a signed value is tolerated: the row's direction is already 'out', so only the magnitude matters.
function magnitude(money: PayPalMoney): PayPalMoney {
  return { ...money, value: money.value.replace(/^-/, '') };
}

// Treasury capture refunded (PAYMENT.CAPTURE.REFUNDED) or reversed by PayPal (PAYMENT.CAPTURE.REVERSED)
// -> one income_reversal row, so cleared income goes down. Only undoes a capture this ledger recorded
// as income. Idempotent on the refund id: a replay, or REFUNDED and REVERSED for the same refund,
// writes one row.
//
// Procurement-app refunds (a vendor refunding our purchase, P4's late-delivery case) arrive on the
// procurement receiver and are ignored here; P4 registers its own handler for the same event type,
// and the registry runs every handler with the receiving app in ctx.
export function createCaptureReversalHandler(getDb: () => Db): WebhookHandler {
  return async (event, { app }) => {
    if (app !== 'treasury') return;
    const db = getDb();

    const parsed = ReversalResource.safeParse(event.resource);
    if (!parsed.success) {
      await writeAudit(db, {
        actor: ACTOR,
        action: 'ledger.reversal_ignored',
        input: { webhookEventId: event.id, eventType: event.event_type },
        reason: `${event.event_type} resource is not a refund`,
      });
      return;
    }
    const refund = parsed.data;
    if (refund.status && NO_MONEY_MOVED.has(refund.status)) return;

    const captureId = originalCaptureId(refund, event.event_type);
    const income = captureId ? await findIncomeByCapture(db, captureId) : undefined;
    if (!captureId || !income) {
      await writeAudit(db, {
        actor: ACTOR,
        action: 'ledger.reversal_unmatched',
        input: { webhookEventId: event.id, eventType: event.event_type, refundId: refund.id, captureId },
        reason: captureId
          ? 'refunded capture is not income this ledger recorded'
          : 'refund has no rel=up link to a capture',
        paypalId: refund.id,
      });
      return;
    }

    const net = refund.seller_payable_breakdown?.net_amount;
    const basis: 'net' | 'gross' = net ? 'net' : 'gross';
    let money: { amountMinor: number; currency: string };
    try {
      money = fromPayPalMoney(magnitude(net ?? refund.amount));
      if (money.amountMinor === 0) throw new RangeError('reversal amount is zero');
    } catch (err) {
      await writeAudit(db, {
        actor: ACTOR,
        action: 'ledger.reversal_ignored',
        input: { webhookEventId: event.id, eventType: event.event_type, refundId: refund.id, captureId },
        reason: err instanceof Error ? err.message : 'unreadable amount',
        paypalId: refund.id,
      });
      return;
    }

    await db.transaction(async (tx) => {
      const recorded = await recordLedgerEntry(tx, {
        eventId: income.eventId,
        direction: 'out',
        amount: money.amountMinor,
        currency: money.currency,
        source: INCOME_REVERSAL_SOURCE,
        paypalId: refund.id,
        captureId,
        sponsorId: income.sponsorId,
      });
      // TODO(P3): a refunded sponsor invoice leaves sponsors.status = 'paid'. Partial refunds and the
      // net/gross difference make "no longer paid" ambiguous; drive it from INVOICING.INVOICE.REFUNDED
      // once that handler exists, and re-close the sponsor's Gantt gate there.
      if (recorded) {
        await writeAudit(tx, {
          actor: ACTOR,
          action: 'ledger.income_reversed',
          input: {
            webhookEventId: event.id,
            eventType: event.event_type,
            captureId,
            originalSource: income.source,
            originalPaypalId: income.paypalId,
            sponsorId: income.sponsorId,
            amount: money.amountMinor,
            currency: money.currency,
            amountBasis: basis,
          },
          reason:
            basis === 'net'
              ? `${event.event_type} on the Treasury app, net amount`
              : `${event.event_type} on the Treasury app; no seller_payable_breakdown.net_amount, so the gross amount was recorded`,
          paypalId: refund.id,
        });
      }
    });
  };
}
