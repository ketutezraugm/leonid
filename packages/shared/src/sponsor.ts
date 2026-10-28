import { z } from 'zod';
import { CurrencyCode, Id, MinorUnits } from './common.js';

// Overdue is derived from the invoice due date, not stored here.
export const SponsorStatus = z.enum(['pledged', 'invoiced', 'paid', 'cancelled']);
export type SponsorStatus = z.infer<typeof SponsorStatus>;

export const Sponsor = z.object({
  id: Id,
  eventId: Id,
  name: z.string().min(1),
  contactEmail: z.email(),
  tier: z.string().min(1),
  pledged: MinorUnits,
  currency: CurrencyCode,
  paypalInvoiceId: z.string().nullable(),
  status: SponsorStatus,
});
export type Sponsor = z.infer<typeof Sponsor>;
