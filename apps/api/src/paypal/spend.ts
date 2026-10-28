import { z } from 'zod';
import type { PayPalClient } from './client.js';
import { PayPalMoney, toPayPalMoney } from './money.js';

// MONEY MOVES HERE. Import this file only from payments/executor.ts, after the rules engine said "allow"
// or the treasurer approved (money-safety.md). ESLint blocks imports from anywhere else.

const ChargeResponse = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(
      z.object({
        payments: z
          .object({
            captures: z.array(z.object({ id: z.string(), status: z.string(), amount: PayPalMoney })).default([]),
          })
          .optional(),
      }),
    )
    .default([]),
});

export interface VaultCharge {
  orderId: string;
  captureId?: string;
  status: string; // COMPLETED when the money moved
}

// Charge the saved wallet with nobody present. PayPal refuses it if the payment token was deleted (kill switch).
export async function chargeVaultedWallet(
  client: PayPalClient,
  input: { referenceId: string; paymentTokenId: string; amountMinor: number; currency: string },
): Promise<VaultCharge> {
  const res = await client.request({
    method: 'POST',
    path: '/v2/checkout/orders',
    schema: ChargeResponse,
    // Derived from our own record id: a retry of the same cart can never charge twice.
    requestId: `charge-${input.referenceId}`,
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.referenceId,
          amount: toPayPalMoney(input.amountMinor, input.currency),
        },
      ],
      payment_source: { paypal: { vault_id: input.paymentTokenId } },
    },
  });
  const capture = res.purchase_units[0]?.payments?.captures[0];
  return { orderId: res.id, captureId: capture?.id, status: capture?.status ?? res.status };
}
