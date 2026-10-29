import { z } from 'zod';
import type { PaymentsContext } from '../payments/context.js';
import type { WebhookHandler } from './registry.js';

const Resource = z.object({ id: z.string().min(1) });

// CHECKOUT.ORDER.APPROVED is the backup for the treasurer's approval: if the browser never reaches
// POST /api/approvals/:id/capture (tab closed after the PayPal popup), this captures the order instead.
// It adds no trust of its own: the executor still asks PayPal whether the order is APPROVED, for the amount we asked,
// with an active wallet, and captures with the same PayPal-Request-Id as the browser path, so both together cannot charge twice.
// Nobody is signed in on this path, so it also requires that the treasurer's own PayPal account approved the order
// (TREASURY_PAYPAL_PAYER_ID). Without that setting it captures nothing: the treasurer captures from the Approvals page.
// Only the Procurement app's orders are spends; orders from other apps, or not in our approvals, are ignored.
// A PayPal 5xx or 429 throws, so the delivery fails and PayPal sends it again. Refusals and mismatches are acknowledged:
// retrying would not change them, and the treasurer can still capture from the Approvals page.
export function orderApprovedHandler(
  payments: () => Pick<PaymentsContext, 'approvals' | 'executor'>,
  env: NodeJS.ProcessEnv = process.env,
): WebhookHandler {
  let warnedUnconfigured = false;
  return async (event, { app }) => {
    if (app !== 'procurement') return;
    const resource = Resource.safeParse(event.resource);
    if (!resource.success) return;
    const treasurerPayerId = env.TREASURY_PAYPAL_PAYER_ID;
    if (!treasurerPayerId) {
      if (!warnedUnconfigured) console.warn('TREASURY_PAYPAL_PAYER_ID is not set: approved orders are not captured from the webhook');
      warnedUnconfigured = true;
      return;
    }
    const { approvals, executor } = payments();
    const orderId = resource.data.id;
    const approvalId = await approvals.findByOrder(orderId);
    if (!approvalId) return;
    const outcome = await executor.captureApproved(approvalId, 'paypal-webhook', { requirePayerId: treasurerPayerId });
    if (outcome.status === 'paid') return;
    if (outcome.status === 'refused' && (outcome.reason === 'already_paid' || outcome.reason === 'in_progress')) {
      // The browser got there first (or is capturing right now). Nothing went wrong.
      console.info(`order ${orderId}: ${outcome.reason}, nothing to capture from the webhook`);
      return;
    }
    if (outcome.status === 'failed' && outcome.retryable) throw new Error(`order ${orderId} capture failed, PayPal will retry: ${outcome.detail}`);
    const why = outcome.status === 'refused' ? outcome.reason : outcome.status === 'failed' ? outcome.detail : outcome.status;
    console.warn(`order ${orderId} approved but not captured: ${why}`);
  };
}
