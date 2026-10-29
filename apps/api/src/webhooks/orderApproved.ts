import { z } from 'zod';
import type { PaymentsContext } from '../payments/context.js';
import type { WebhookHandler } from './registry.js';

const Resource = z.object({ id: z.string().min(1) });

// CHECKOUT.ORDER.APPROVED is the backup for the treasurer's approval: if the browser never reaches
// POST /api/approvals/:id/capture (tab closed after the PayPal popup), this captures the order instead.
// It adds no trust of its own: the executor still asks PayPal whether the order is APPROVED, for the amount we asked,
// with an active wallet, and captures with the same PayPal-Request-Id as the browser path, so both together cannot charge twice.
// Only the Procurement app's orders are spends; orders from other apps, or not in our approvals, are ignored.
// ponytail: a failed capture is logged and acknowledged, not retried by PayPal (a mismatch would retry for days);
// the treasurer can still capture from the Approvals page. Throw for transient PayPal errors if that backup matters more.
export function orderApprovedHandler(payments: () => Pick<PaymentsContext, 'approvals' | 'executor'>): WebhookHandler {
  return async (event, { app }) => {
    if (app !== 'procurement') return;
    const resource = Resource.safeParse(event.resource);
    if (!resource.success) return;
    const { approvals, executor } = payments();
    const approvalId = await approvals.findByOrder(resource.data.id);
    if (!approvalId) return;
    const outcome = await executor.captureApproved(approvalId, 'paypal-webhook');
    if (outcome.status !== 'paid') console.warn(`order ${resource.data.id} approved but not captured: ${outcome.status}`);
  };
}
