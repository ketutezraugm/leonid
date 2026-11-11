import { z } from 'zod';
import { CurrencyCode, Id, IsoDateTime, MinorUnits } from './common.js';

export const LedgerDirection = z.enum(['in', 'out']);
export type LedgerDirection = z.infer<typeof LedgerDirection>;

export const LedgerSource = z.enum([
  'sponsor_invoice',
  'subscription',
  'ticket',
  'donation',
  'purchase',
  'refund',
  'claim_payout',
  'speaker_payout',
  'prize_payout',
  'income_reversal',
]);
export type LedgerSource = z.infer<typeof LedgerSource>;

// Written by webhook handlers only, so every row is money PayPal has confirmed.
// A refund of a purchase is direction 'in' with source 'refund'. Income going back out (a refunded or
// reversed ticket, donation or sponsor payment) is direction 'out' with source 'income_reversal';
// cleared income is income in minus income reversals.
export const LedgerEntry = z.object({
  id: Id,
  eventId: Id,
  direction: LedgerDirection,
  amount: MinorUnits,
  currency: CurrencyCode,
  source: LedgerSource,
  paypalId: z.string().min(1),
  captureId: z.string().min(1).nullable(),
  sponsorId: Id.nullable(),
  category: z.string().min(1).nullable(),
  createdAt: IsoDateTime,
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;
