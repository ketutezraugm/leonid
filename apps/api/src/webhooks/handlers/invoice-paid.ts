import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../../db/audit.js';
import type { Db } from '../../db/client.js';
import { recordLedgerEntry } from '../../db/ledger.js';
import { sponsors } from '../../db/schema.js';
import { fromPayPalMoney, PayPalMoney } from '../../paypal/money.js';
import type { WebhookHandler } from '../registry.js';

const ACTOR = 'webhook:paypal-treasury';

// Shape taken from a real INVOICING.INVOICE.PAID event (see fixtures/invoice-paid.json).
const InvoicePaidResource = z.object({
  invoice: z.looseObject({
    id: z.string().min(1),
    status: z.string(),
    due_amount: PayPalMoney.optional(),
    payments: z
      .looseObject({
        paid_amount: PayPalMoney.optional(),
        transactions: z
          .array(
            z.looseObject({
              transaction_status: z.string().optional(),
              // "The ID for a PayPal payment transaction" (Invoicing v2 payment_detail).
              payment_id: z.string().min(1).optional(),
            }),
          )
          .default([]),
      })
      .optional(),
  }),
});
type Invoice = z.infer<typeof InvoicePaidResource>['invoice'];

type PaidCheck =
  | { kind: 'paid'; amount: number; currency: string; captureId: string | null }
  | { kind: 'not_fully_paid' }
  | { kind: 'malformed'; reason: string };

// PayPal fires INVOICING.INVOICE.PAID for partial and pending payments too. Only a fully settled
// invoice is income: status PAID, nothing left due, and a PayPal transaction that succeeded.
// MARKED_AS_PAID is the invoicer's own claim (cash or cheque), not money PayPal moved, so it is ignored.
function checkFullyPaid(invoice: Invoice): PaidCheck {
  if (invoice.status !== 'PAID') return { kind: 'not_fully_paid' };
  try {
    if (invoice.due_amount && fromPayPalMoney(invoice.due_amount).amountMinor !== 0) {
      return { kind: 'not_fully_paid' };
    }
    const paid = invoice.payments?.paid_amount;
    if (!paid) return { kind: 'malformed', reason: 'PAID invoice has no payments.paid_amount' };
    const { amountMinor, currency } = fromPayPalMoney(paid);
    if (amountMinor <= 0) return { kind: 'not_fully_paid' };
    const settled = invoice.payments?.transactions.find((t) => t.transaction_status === 'SUCCESS');
    if (!settled) return { kind: 'not_fully_paid' };
    return { kind: 'paid', amount: amountMinor, currency, captureId: settled.payment_id ?? null };
  } catch (err) {
    return { kind: 'malformed', reason: err instanceof Error ? err.message : 'unreadable amount' };
  }
}

// Fully paid sponsor invoice -> one ledger row (cleared income) and the sponsor marked paid, in one
// transaction. Idempotent: PayPal retries, and the event store only remembers ids until a restart.
export function createInvoicePaidHandler(getDb: () => Db): WebhookHandler {
  return async (event, { app }) => {
    // Invoices belong to the Treasury app; the Procurement webhook never carries sponsor money.
    if (app !== 'treasury') return;
    const db = getDb();

    const parsed = InvoicePaidResource.safeParse(event.resource);
    if (!parsed.success) {
      await writeAudit(db, {
        actor: ACTOR,
        action: 'ledger.invoice_ignored',
        input: { webhookEventId: event.id },
        reason: 'INVOICING.INVOICE.PAID resource is not an invoice',
      });
      return;
    }
    const { invoice } = parsed.data;

    const check = checkFullyPaid(invoice);
    if (check.kind === 'not_fully_paid') return;
    if (check.kind === 'malformed') {
      await writeAudit(db, {
        actor: ACTOR,
        action: 'ledger.invoice_ignored',
        input: { webhookEventId: event.id, invoiceId: invoice.id },
        reason: check.reason,
        paypalId: invoice.id,
      });
      return;
    }

    const [sponsor] = await db
      .select()
      .from(sponsors)
      .where(eq(sponsors.paypalInvoiceId, invoice.id))
      .limit(1);
    if (!sponsor) {
      // Not one of our sponsor invoices (or created outside the app). Nothing to credit; leave a trace.
      await writeAudit(db, {
        actor: ACTOR,
        action: 'ledger.invoice_unmatched',
        input: { webhookEventId: event.id, invoiceId: invoice.id, amount: check.amount, currency: check.currency },
        reason: 'no sponsor has this paypal_invoice_id',
        paypalId: invoice.id,
      });
      return;
    }

    await db.transaction(async (tx) => {
      // Gross paid amount: the invoice event carries no fee breakdown. PayPal's fee on sponsor
      // invoices is reconciled later from Transaction Search (reports), not here.
      const recorded = await recordLedgerEntry(tx, {
        eventId: sponsor.eventId,
        direction: 'in',
        amount: check.amount,
        currency: check.currency,
        source: 'sponsor_invoice',
        paypalId: invoice.id,
        // The PayPal transaction behind the payment, so a later capture refund/reversal can find this row.
        captureId: check.captureId,
        sponsorId: sponsor.id,
      });
      await tx.update(sponsors).set({ status: 'paid' }).where(eq(sponsors.id, sponsor.id));
      if (recorded) {
        await writeAudit(tx, {
          actor: ACTOR,
          action: 'ledger.income_recorded',
          input: {
            webhookEventId: event.id,
            source: 'sponsor_invoice',
            sponsorId: sponsor.id,
            amount: check.amount,
            currency: check.currency,
          },
          reason: 'INVOICING.INVOICE.PAID, invoice fully paid',
          paypalId: invoice.id,
        });
      }
    });
  };
}
