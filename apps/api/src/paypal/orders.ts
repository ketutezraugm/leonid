import { z } from 'zod';
import type { PayPalClient } from './client.js';
import { PayPalMoney, toPayPalMoney } from './money.js';

// Orders v2: create and read only. Capture moves money, so it lives with the rules-engine
// executor (money-safety.md), not here.

export const PayPalLink = z.object({
  href: z.string(),
  rel: z.string(),
  method: z.string().optional(),
});

export const PayPalOrder = z.object({
  id: z.string(),
  status: z.enum(['CREATED', 'SAVED', 'APPROVED', 'VOIDED', 'COMPLETED', 'PAYER_ACTION_REQUIRED']),
  purchase_units: z
    .array(z.object({ reference_id: z.string().optional(), custom_id: z.string().optional(), amount: PayPalMoney.optional() }))
    .optional(),
  links: z.array(PayPalLink).default([]),
  // Who approved the order. Orders v2 spec (2.32): payment_source.paypal.account_id is the current field; payer.payer_id
  // is deprecated since 2.9 but still returned. Both are the 13-character PayPal payer id.
  payment_source: z.object({ paypal: z.object({ account_id: z.string().optional() }).optional() }).optional(),
  payer: z.object({ payer_id: z.string().optional() }).optional(),
});
export type PayPalOrder = z.infer<typeof PayPalOrder>;

// Which event a spend order belongs to, in the same qm:<eventId>:<kind> style as the income tags (buildCaptureTag).
// The Procurement app's captures are spend, which the executor records, so the capture webhook never reads this one.
export const spendTag = (eventId: string) => `qm:${eventId}:spend`;

export interface CreateOrderInput {
  // Our own record ID (ticket, donation, cart). Doubles as the idempotency key.
  referenceId: string;
  amountMinor: number;
  currency: string;
  description?: string;
  customId?: string; // purchase_units[].custom_id, up to 255 characters; PayPal returns it on the order and its capture
  returnUrl?: string;
  cancelUrl?: string;
  mockApplicationCode?: string;
}

export interface CreatedOrder {
  id: string;
  status: PayPalOrder['status'];
  approveUrl: string;
}

export async function createOrder(
  client: PayPalClient,
  input: CreateOrderInput,
): Promise<CreatedOrder> {
  const order = await client.request({
    method: 'POST',
    path: '/v2/checkout/orders',
    schema: PayPalOrder,
    requestId: `order-${input.referenceId}`,
    mockApplicationCode: input.mockApplicationCode,
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.referenceId,
          description: input.description,
          custom_id: input.customId,
          amount: toPayPalMoney(input.amountMinor, input.currency),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
  });
  return { id: order.id, status: order.status, approveUrl: approveUrlOf(order) };
}

// The PayPal account that approved the order, if PayPal says.
export const payerIdOf = (order: PayPalOrder): string | undefined =>
  order.payment_source?.paypal?.account_id ?? order.payer?.payer_id;

export function getOrder(client: PayPalClient, orderId: string): Promise<PayPalOrder> {
  return client.request({
    method: 'GET',
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    schema: PayPalOrder,
  });
}

// PayPal names the buyer link `payer-action` when payment_source.paypal is sent, `approve` otherwise.
export function approveUrlOf(order: PayPalOrder): string {
  const link = order.links.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  if (!link) throw new Error(`PayPal order ${order.id} has no approval link`);
  return link.href;
}
