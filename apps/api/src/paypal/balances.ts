import { z } from 'zod';
import { CurrencyCode, type TreasuryBalance, type TreasuryResponse } from '@leonid/shared';
import type { PayPalClient } from './client.js';
import { fromPayPalSignedMoney, PayPalMoney } from './money.js';

// Transaction Search & Reporting on the Treasury app: GET /v1/reporting/balances. Read only, moves no money.
// Checked against the sandbox: a currency with no balance comes back with no `balances` key at all.

const Balances = z.object({
  balances: z
    .array(z.object({ currency: z.string(), total_balance: PayPalMoney, available_balance: PayPalMoney.optional(), withheld_balance: PayPalMoney.optional() }))
    .default([]),
  account_id: z.string().optional(),
  as_of_time: z.string().optional(),
});

export async function getTreasuryBalances(client: PayPalClient): Promise<TreasuryResponse> {
  const res = await client.request({ method: 'GET', path: '/v1/reporting/balances', schema: Balances });
  const minor = (m: PayPalMoney) => fromPayPalSignedMoney(m).amountMinor;
  const balances: TreasuryBalance[] = [];
  res.balances.forEach((b, i) => {
    // One unsupported (zero-decimal) or malformed currency must not blank the whole wallet card: skip just that entry.
    // The warning names only the entry's position, never PayPal's payload text.
    try {
      balances.push({
        currency: CurrencyCode.parse(b.currency),
        totalMinor: minor(b.total_balance),
        // Missing means PayPal didn't say; don't pretend the total is spendable.
        availableMinor: b.available_balance ? minor(b.available_balance) : null,
        withheldMinor: b.withheld_balance ? minor(b.withheld_balance) : 0,
      });
    } catch {
      console.warn(`treasury balances: skipped entry ${i}, unsupported or malformed money`);
    }
  });
  return {
    merchantId: res.account_id ?? null,
    asOf: res.as_of_time ?? null,
    balances,
  };
}
