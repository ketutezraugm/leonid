import type { PayoutItemStatus } from '@quartermaster/shared';
import { z } from 'zod';
import type { PayPalClient } from './client.js';

// Reading a payout batch back moves no money, so unlike payouts.ts this file may be imported anywhere (the webhook
// handlers, the reconciliation job). Webhooks are the live source of truth for payout state; this is the fallback for
// what they do not carry: PayPal's batch events have no item details, and an item can end up REVERSED with no webhook
// at all.

const BatchResponse = z.object({
  batch_header: z.object({ payout_batch_id: z.string(), batch_status: z.string() }),
  items: z
    .array(
      z.object({
        payout_item_id: z.string(),
        // Left as strings: a status we do not know yet must be reported, not turned into a parse error.
        transaction_status: z.string().optional(),
        payout_item: z.object({ sender_item_id: z.string().optional() }).optional(),
        errors: z
          .object({
            name: z.string(),
            message: z.string().optional(),
            debug_id: z.string().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

export interface PayoutItemState {
  payoutItemId: string;
  // Our reference id: what we sent as sender_item_id.
  senderItemId: string | null;
  transactionStatus: string | null;
  // PayPal's error name when the item failed or was blocked, for the audit row.
  error: string | null;
}

export interface PayoutBatchState {
  payoutBatchId: string;
  batchStatus: string;
  items: PayoutItemState[];
}

// GET /v1/payments/payouts/{id}. One page is enough: we send one item per batch.
export async function getPayoutBatch(
  client: PayPalClient,
  payoutBatchId: string,
): Promise<PayoutBatchState> {
  const res = await client.request({
    method: 'GET',
    path: `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}?page_size=100`,
    schema: BatchResponse,
  });
  return {
    payoutBatchId: res.batch_header.payout_batch_id,
    batchStatus: res.batch_header.batch_status,
    items: res.items.map((item) => ({
      payoutItemId: item.payout_item_id,
      senderItemId: item.payout_item?.sender_item_id ?? null,
      transactionStatus: item.transaction_status ?? null,
      error: item.errors?.name ?? null,
    })),
  };
}

// PayPal's transaction_status (from a batch read-back) onto our payout item status. Undefined for a status we have not
// heard of: the caller leaves the item as it is and reports it, because guessing could mark an unpaid person as paid.
// PayPal's list (spec): SUCCESS, FAILED, PENDING, UNCLAIMED, RETURNED, ONHOLD, BLOCKED, REFUNDED, REVERSED.
//  - ONHOLD is PayPal reviewing the payment: not paid, not failed, so it stays processing.
//  - RETURNED, REFUNDED and REVERSED all mean the money came back to the Treasury account.
// A Map, not an object: a status string from outside must never find an inherited property like "constructor".
const BY_TRANSACTION_STATUS = new Map<string, PayoutItemStatus>([
  ['SUCCESS', 'paid'],
  ['FAILED', 'failed'],
  ['PENDING', 'processing'],
  ['ONHOLD', 'processing'],
  ['UNCLAIMED', 'unclaimed'],
  ['BLOCKED', 'blocked'],
  ['RETURNED', 'returned'],
  ['REFUNDED', 'returned'],
  ['REVERSED', 'returned'],
]);

export function payoutItemStatusOf(transactionStatus: string | null): PayoutItemStatus | undefined {
  return transactionStatus === null ? undefined : BY_TRANSACTION_STATUS.get(transactionStatus);
}
