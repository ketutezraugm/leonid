import type { PayPalClient } from '../paypal/client.js';
import { sendPayout } from '../paypal/payouts.js';
import type { PayoutSender } from './ports.js';

// The executor's PayoutSender, backed by P3's sendPayout on the Treasury app. The client is fetched at call time, so the
// server still starts when the Treasury credentials are missing (payments/context.ts then offers no sender at all).
// Payouts go to a PayPal email only; the reference id is PayPal's sender_batch_id, so a retry can never pay twice.
export function createPayoutSender(treasuryClient: () => PayPalClient): PayoutSender {
  return {
    async send(input) {
      const sent = await sendPayout(treasuryClient(), {
        recipientType: 'EMAIL',
        receiver: input.recipientEmail,
        referenceId: input.referenceId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        note: input.note,
      });
      return { batchId: sent.payoutBatchId };
    },
  };
}
