import { z } from 'zod';
import type { PayPalClient } from './client.js';
import { fromPayPalMoney, PayPalMoney, toPayPalMoney } from './money.js';

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

export interface Charge {
  orderId: string;
  captureId?: string;
  status: string; // COMPLETED when the money moved; NO_CAPTURE if PayPal returned no capture
  amount?: { amountMinor: number; currency: string }; // what PayPal actually captured, for the caller to verify
}

function toCharge(res: z.infer<typeof ChargeResponse>): Charge {
  const capture = res.purchase_units[0]?.payments?.captures[0];
  return {
    orderId: res.id,
    captureId: capture?.id,
    status: capture?.status ?? 'NO_CAPTURE',
    amount: capture ? fromPayPalMoney(capture.amount) : undefined,
  };
}

// Capture an order the treasurer approved in the PayPal popup. The caller must already have checked at PayPal that the
// order is APPROVED and that its amount is the spend's amount (the executor does both).
export async function captureApprovedOrder(
  client: PayPalClient,
  input: { referenceId: string; orderId: string },
): Promise<Charge> {
  const res = await client.request({
    method: 'POST',
    path: `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
    schema: ChargeResponse,
    requestId: `capture-${input.referenceId}`,
    body: {},
  });
  return toCharge(res);
}

// Charge the saved wallet with nobody present. PayPal refuses it if the payment token was deleted (kill switch).
export async function chargeVaultedWallet(
  client: PayPalClient,
  input: { referenceId: string; paymentTokenId: string; amountMinor: number; currency: string; customId?: string },
): Promise<Charge> {
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
          custom_id: input.customId,
          amount: toPayPalMoney(input.amountMinor, input.currency),
        },
      ],
      payment_source: { paypal: { vault_id: input.paymentTokenId } },
    },
  });
  return toCharge(res);
}
