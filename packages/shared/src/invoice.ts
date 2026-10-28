import { z } from 'zod';
import { CurrencyCode, Id, IsoDate, IsoDateTime, MinorUnits } from './common.js';

// Our own lifecycle. The API maps PayPal's statuses (SENT, UNPAID, PAID, MARKED_AS_PAID, ...) onto these.
export const InvoiceStatus = z.enum([
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'cancelled',
  'refunded',
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const InvoiceLineItem = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  quantity: z.number().int().positive(),
  unitAmount: MinorUnits,
});
export type InvoiceLineItem = z.infer<typeof InvoiceLineItem>;

// Structured output of the treasury agent. The organizer confirms it before it is sent.
export const InvoiceDraft = z.object({
  sponsorId: Id,
  items: z.array(InvoiceLineItem).min(1),
  currency: CurrencyCode,
  dueInDays: z.number().int().min(0).max(90),
  // Shown to the sponsor. Never copy untrusted sponsor text into it.
  note: z.string().max(4000),
  // Why the agent drafted this, for the audit log and the Approvals screen.
  reasoning: z.string().min(1).max(1000),
});
export type InvoiceDraft = z.infer<typeof InvoiceDraft>;

export const Invoice = z.object({
  id: Id,
  eventId: Id,
  sponsorId: Id,
  paypalInvoiceId: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  status: InvoiceStatus,
  items: z.array(InvoiceLineItem).min(1),
  total: MinorUnits,
  amountPaid: MinorUnits,
  currency: CurrencyCode,
  issuedOn: IsoDate.nullable(),
  dueDate: IsoDate.nullable(),
  recipientEmail: z.email(),
  // PayPal's hosted payer page (metadata.recipient_view_url).
  recipientViewUrl: z.url().nullable(),
  sentAt: IsoDateTime.nullable(),
  paidAt: IsoDateTime.nullable(),
  lastRemindedAt: IsoDateTime.nullable(),
  reminderCount: z.number().int().nonnegative(),
  draftReasoning: z.string().nullable(),
});
export type Invoice = z.infer<typeof Invoice>;

// Structured output of the nudge drafter. Friendly, not a demand.
export const InvoiceReminderDraft = z.object({
  invoiceId: Id,
  subject: z.string().min(1).max(4000),
  note: z.string().min(1).max(4000),
  reasoning: z.string().min(1).max(1000),
});
export type InvoiceReminderDraft = z.infer<typeof InvoiceReminderDraft>;
