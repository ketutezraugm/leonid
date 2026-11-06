import { PayoutRecipientType } from '@quartermaster/shared';
import { z } from 'zod';
import type { PayPalClient } from './client.js';
import { toPayPalMoney } from './money.js';

// MONEY MOVES HERE. Import this file only from payments/executor.ts, after the rules engine said "allow" or the
// treasurer approved (money-safety.md). ESLint blocks imports from anywhere else. Reading a batch back moves nothing,
// so it lives in payout-status.ts.
//
// Payouts v1, Treasury app. Limits are from PayPal's spec: sender_batch_id 256 characters, sender_item_id 63, receiver
// 127, item note 4000, email_subject 255, email_message 1000; PayPal keeps a PayPal-Request-Id for 30 days.
// Payouts are PayPal-only: recipient_wallet is never sent (it defaults to PAYPAL), so there is no other wallet to pay.

// Our own record id (the claim or payout). Used for sender_batch_id, sender_item_id and the request id, so a retry of
// the same payout is the same payout to PayPal and can never pay twice. 63 is the tightest limit of the three.
const ReferenceId = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[A-Za-z0-9._:-]+$/, 'reference ids use letters, digits and . _ : - only');

const Receiver = z.discriminatedUnion('recipientType', [
  z.object({
    recipientType: z.literal('EMAIL' satisfies PayoutRecipientType),
    receiver: z.email().max(127),
  }),
  z.object({
    recipientType: z.literal('PAYPAL_ID' satisfies PayoutRecipientType),
    receiver: z.string().regex(/^[A-Za-z0-9]{1,127}$/),
  }),
]);

const PayoutInput = z.intersection(
  Receiver,
  z.object({
    referenceId: ReferenceId,
    amountMinor: z.number().int().positive(),
    currency: z.string(),
    // What the person reads in PayPal's email and on the payment. Never copy untrusted text into these.
    note: z.string().max(4000).optional(),
    emailSubject: z.string().max(255).optional(),
    emailMessage: z.string().max(1000).optional(),
  }),
);
export type PayoutInput = z.input<typeof PayoutInput>;

export function buildPayoutBody(input: PayoutInput) {
  const p = PayoutInput.parse(input);
  return {
    sender_batch_header: {
      sender_batch_id: p.referenceId,
      email_subject: p.emailSubject,
      email_message: p.emailMessage,
    },
    // One item per batch: every claim or payout is its own spend with its own reference, so a retry or a failure
    // never touches anyone else's money.
    items: [
      {
        recipient_type: p.recipientType,
        receiver: p.receiver,
        amount: toPayPalMoney(p.amountMinor, p.currency),
        note: p.note,
        sender_item_id: p.referenceId,
      },
    ],
  };
}

const CreatePayoutResponse = z.object({
  batch_header: z.object({
    payout_batch_id: z.string(),
    // Left as a string: PayPal creating the batch is the fact that matters, and an unlisted status must not turn a
    // payout that went out into a parse error.
    batch_status: z.string(),
    sender_batch_header: z.object({ sender_batch_id: z.string().optional() }).optional(),
  }),
});

export interface PayoutBatchResult {
  payoutBatchId: string;
  // PENDING, PROCESSING, SUCCESS, DENIED or CANCELED. Creating is asynchronous: PENDING or PROCESSING is normal, and
  // the final word comes by webhook (PAYMENT.PAYOUTS-ITEM.*), with a read-back as the fallback.
  batchStatus: string;
}

// Pays one person from the Treasury app. Throws PayPalApiError when PayPal refuses. A PayPalTimeoutError means the
// outcome is unknown: the payout may have gone out, so the caller must retry with the same referenceId (which returns
// the original result) and must not treat it as failed.
export async function sendPayout(
  client: PayPalClient,
  input: PayoutInput,
): Promise<PayoutBatchResult> {
  // Money in lands in the Treasury and people are paid from it (paypal.md). The Procurement app never pays people.
  if (client.app !== 'treasury') throw new Error('Payouts are sent from the Treasury app only');
  const body = buildPayoutBody(input);
  const res = await client.request({
    method: 'POST',
    path: '/v1/payments/payouts',
    schema: CreatePayoutResponse,
    requestId: `payout-${input.referenceId}`,
    body,
  });
  const { payout_batch_id, batch_status, sender_batch_header } = res.batch_header;
  const echoed = sender_batch_header?.sender_batch_id;
  if (echoed !== undefined && echoed !== input.referenceId) {
    throw new Error(
      `PayPal answered with batch ${payout_batch_id} for another sender_batch_id than ${input.referenceId}`,
    );
  }
  return { payoutBatchId: payout_batch_id, batchStatus: batch_status };
}
