import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { writeAudit } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { auditLog, sponsors } from '../db/schema.js';
import type { PayPalClient } from '../paypal/client.js';
import { getInvoice, sendInvoiceReminder } from '../paypal/invoicing.js';
import { loadSponsorWithEvent } from './draft.js';

export type ReminderOutcome =
  | 'reminded'
  | 'not_found'
  | 'no_invoice' // the sponsor has not been invoiced (or the invoice id is missing)
  | 'already_paid' // PayPal says it is paid; the INVOICE.PAID webhook, not this job, updates our records
  | 'not_open' // cancelled, refunded, draft, payment pending...: a reminder makes no sense
  | 'recent'; // reminded within the last minIntervalHours

export const REMINDER_ACTOR = 'workflow:invoice-reminders';

// PayPal invoice states in which the payer still owes money and a reminder is wanted.
const OPEN = new Set(['SENT', 'UNPAID', 'PARTIALLY_PAID']);
const PAID = new Set(['PAID', 'MARKED_AS_PAID']);

export interface ReminderDeps {
  db: Db;
  client: PayPalClient;
  // A sponsor is reminded at most once in this many hours, however often the job runs.
  minIntervalHours: number;
}

// Sponsors that have an invoice out and have not paid, by our records: the job's work list.
export async function listInvoicedSponsorIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: sponsors.id })
    .from(sponsors)
    .where(and(eq(sponsors.status, 'invoiced'), isNotNull(sponsors.paypalInvoiceId)));
  return rows.map((r) => r.id);
}

// Reminds one sponsor about an unpaid invoice. Our status is only a hint: PayPal's live invoice status decides, so a
// payment whose webhook has not landed yet is never nagged. The reminder text is ours (sponsor input is never copied
// into it beyond the names). The audit row is written after PayPal accepts, so a failed call can be retried by the
// workflow instead of being skipped as 'recent'; the price is a possible second email if the process dies in between.
export async function remindSponsor(deps: ReminderDeps, sponsorId: string): Promise<ReminderOutcome> {
  const { db, client } = deps;
  const found = await loadSponsorWithEvent(db, sponsorId);
  if (!found) return 'not_found';
  const { sponsor, event } = found;
  if (!sponsor.paypalInvoiceId || (sponsor.status !== 'invoiced' && sponsor.status !== 'paid')) return 'no_invoice';
  if (sponsor.status === 'paid') return 'already_paid';

  const [recent] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, 'invoice.reminder'),
        sql`${auditLog.input}->>'sponsorId' = ${sponsor.id}`,
        sql`${auditLog.createdAt} > now() - make_interval(hours => ${deps.minIntervalHours})`,
      ),
    )
    .limit(1);
  if (recent) return 'recent';

  const invoice = await getInvoice(client, sponsor.paypalInvoiceId);
  if (PAID.has(invoice.status)) return 'already_paid';
  if (!OPEN.has(invoice.status)) return 'not_open';

  try {
    await sendInvoiceReminder(client, invoice.id, {
      subject: `Reminder: ${event.name} sponsorship invoice`,
      note: `A friendly reminder that this invoice for ${event.name} is still open. Thank you for supporting the event.`,
    });
  } catch (err) {
    await writeAudit(db, {
      actor: REMINDER_ACTOR,
      action: 'invoice.reminder_failed',
      input: { sponsorId: sponsor.id, invoiceStatus: invoice.status },
      reason: `failed: ${err instanceof Error ? err.message : String(err)}`,
      paypalId: invoice.id,
    }).catch(() => undefined);
    throw err;
  }
  await writeAudit(db, {
    actor: REMINDER_ACTOR,
    action: 'invoice.reminder',
    input: { sponsorId: sponsor.id, eventId: event.id, invoiceStatus: invoice.status },
    reason: 'sponsor invoice still unpaid',
    paypalId: invoice.id,
  });
  return 'reminded';
}
