import { z } from 'zod';
import { CurrencyCode, IsoDateTime, MinorUnits } from './common.js';

// The per-sponsor spend report (F22), published at an unguessable link: GET /api/reports/:shareToken.
// It names categories and vendors, never volunteers or other people: payouts and claims appear only inside category totals.
// Every figure is computed by code from the ledger and the executor's records; only `narrative` may come from a model.

export const SponsorReportLine = z.object({
  at: IsoDateTime,
  category: z.string().nullable(),
  vendor: z.string().nullable(),
  // The whole purchase, and the part of it attributed to this sponsor.
  purchaseMinor: MinorUnits,
  attributedMinor: MinorUnits,
  // direct: the purchase was funded by this sponsor alone. shared: paid from the pooled income, so each source pays its share.
  basis: z.enum(['direct', 'shared']),
  // The PayPal order or capture id, to look the payment up.
  paypalId: z.string().nullable(),
  // PayPal's own transaction records (Transaction Search) checked against this purchase. Absent when the check could not run.
  // not_found is not an accusation: Transaction Search can take hours to list a payment.
  paypalCheck: z.enum(['confirmed', 'differs', 'not_found']).optional(),
});
export type SponsorReportLine = z.infer<typeof SponsorReportLine>;

export const SponsorReportView = z.object({
  sponsor: z.object({ name: z.string(), tier: z.string() }),
  event: z.object({ name: z.string(), date: IsoDateTime }),
  currency: CurrencyCode,
  funds: z.object({
    pledgedMinor: MinorUnits,
    // What actually cleared from this sponsor (net of refunds and fees).
    clearedMinor: MinorUnits,
    status: z.enum(['pledged', 'invoiced', 'paid']),
  }),
  spend: z.object({
    totalMinor: MinorUnits, // attributed to this sponsor
    directMinor: MinorUnits,
    sharedMinor: MinorUnits,
    byCategory: z.array(z.object({ category: z.string(), attributedMinor: MinorUnits, purchases: z.number().int().nonnegative() })),
    // Purchases only, with their vendors. Payouts and claims are left out of the lines on purpose.
    lines: z.array(SponsorReportLine),
    // When the lines were checked against PayPal's transaction records; absent when no check ran.
    paypalCheckedAt: IsoDateTime.optional(),
  }),
  narrative: z.object({ text: z.string().max(1200), source: z.enum(['ai', 'template']) }),
  generatedAt: IsoDateTime,
});
export type SponsorReportView = z.infer<typeof SponsorReportView>;
