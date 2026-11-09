import { z } from 'zod';
import { CurrencyCode, Id, IsoDate, IsoDateTime, MinorUnits } from './common.js';
import { Sponsor } from './sponsor.js';

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

// One row of the Money screen's "Sponsors and invoices" tab: the shared Sponsor without a contact email, because the
// sponsor row has none. The treasurer types the recipient when sending (POST /api/sponsors/:id/send).
export const SponsorSummary = Sponsor.omit({ contactEmail: true });
export type SponsorSummary = z.infer<typeof SponsorSummary>;

// GET /api/sponsors[?eventId=]: the event's sponsors, by name.
export const SponsorsResponse = z.object({ sponsors: z.array(SponsorSummary) });
export type SponsorsResponse = z.infer<typeof SponsorsResponse>;

// GET /api/sponsors/:id/draft[?eventId=]: the pledge as an invoice draft, for the treasurer to read before sending.
// Drafts are not stored, so each call builds a fresh one.
export const InvoiceDraftResponse = z.object({
  sponsor: SponsorSummary.pick({ id: true, name: true, tier: true, pledged: true, status: true }),
  event: z.object({ id: Id, name: z.string(), currency: CurrencyCode }),
  draft: InvoiceDraft,
});
export type InvoiceDraftResponse = z.infer<typeof InvoiceDraftResponse>;

// POST /api/sponsors/:id/send[?eventId=] body { draft, recipientEmail }. resumed: an earlier attempt had already
// created the PayPal invoice and this one finished it (the sponsor is never invoiced twice).
export const SendInvoiceRequest = z.object({ draft: InvoiceDraft, recipientEmail: z.email() });
export type SendInvoiceRequest = z.infer<typeof SendInvoiceRequest>;
export const SentInvoiceResponse = z.object({
  paypalInvoiceId: z.string().min(1),
  invoiceNumber: z.string().nullable(),
  recipientViewUrl: z.string().nullable(),
  resumed: z.boolean(),
});
export type SentInvoiceResponse = z.infer<typeof SentInvoiceResponse>;
