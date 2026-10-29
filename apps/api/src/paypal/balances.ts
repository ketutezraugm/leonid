import { z } from 'zod';
import type { TreasuryResponse } from '@quartermaster/shared';
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
  const minor = (m: PayPalMoney | undefined) => (m ? fromPayPalSignedMoney(m).amountMinor : 0);
  return {
    merchantId: res.account_id ?? null,
    asOf: res.as_of_time ?? null,
    balances: res.balances.map((b) => ({
      currency: b.currency,
      totalMinor: minor(b.total_balance),
      availableMinor: b.available_balance ? minor(b.available_balance) : minor(b.total_balance),
      withheldMinor: minor(b.withheld_balance),
    })),
  };
}
