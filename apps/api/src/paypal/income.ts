import { z } from 'zod';
import type { PayPalClient } from './client.js';

// Money IN. A buyer approved a Treasury order (a ticket or a donation) with PayPal's button, and this collects it into
// the treasury. It is not a spend, so it has no rules check; the ledger entry still comes only from the
// PAYMENT.CAPTURE.COMPLETED webhook (AGENTS.md invariant 5), never from this call. The spend path (spend.ts) stays
// reachable only through the executor.

const CaptureResponse = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(z.object({ payments: z.object({ captures: z.array(z.object({ id: z.string(), status: z.string() })).default([]) }).optional() }))
    .default([]),
});

export interface IncomeCapture {
  orderStatus: string; // COMPLETED once PayPal took the money
  captureStatus?: string; // COMPLETED, or PENDING while PayPal still reviews it
}

export async function captureIncomeOrder(client: PayPalClient, orderId: string): Promise<IncomeCapture> {
  if (client.app !== 'treasury') throw new Error('Ticket and donation income is collected by the Treasury app only');
  const res = await client.request({
    method: 'POST',
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    schema: CaptureResponse,
    // Derived from the order id: a double click or a retry can never collect it twice.
    requestId: `capture-${orderId}`,
    body: {},
  });
  return { orderStatus: res.status, captureStatus: res.purchase_units[0]?.payments?.captures[0]?.status };
}
