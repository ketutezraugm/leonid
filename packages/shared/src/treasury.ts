import { z } from 'zod';
import { CurrencyCode } from './common.js';

// GET /api/treasury (treasurer only): the Treasury PayPal account's balances for the wallet card.
// Integer minor units. PayPal's reporting balance lags (asOf is when it was last refreshed), so it is for display;
// the funds-gated budget uses webhook-confirmed income in the ledger, not this number.
export const TreasuryBalance = z.object({
  currency: CurrencyCode,
  totalMinor: z.number().int(), // can be negative after refunds
  availableMinor: z.number().int(),
  withheldMinor: z.number().int(),
});
export type TreasuryBalance = z.infer<typeof TreasuryBalance>;

export const TreasuryResponse = z.object({
  merchantId: z.string().nullable(),
  asOf: z.string().nullable(),
  balances: z.array(TreasuryBalance),
});
export type TreasuryResponse = z.infer<typeof TreasuryResponse>;
