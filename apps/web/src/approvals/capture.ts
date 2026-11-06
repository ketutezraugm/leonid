import type { ApprovalItem } from '@quartermaster/shared';
import { ApiFailure, sendJson } from '../shell/api';

export type CaptureResult =
  | { kind: 'paid'; paypalId?: string }
  // A payout PayPal accepted: the money is on its way and the payout webhooks finish it.
  | { kind: 'sent'; batchId?: string }
  | { kind: 'failed'; message: string };

const anything = { parse: (value: unknown) => value as Record<string, unknown> };

// POST /api/approvals/:id/capture. The CHECKOUT.ORDER.APPROVED webhook can capture first; the API then answers
// 409 refused with reason already_paid (captured) or in_progress (being captured right now). Both are a
// success for the treasurer, not an error. Every other 409 reason is a real refusal and is shown as one.
// A payout (claims, prizes) has no PayPal order: the same call sends it, and PayPal's acceptance comes back as 200
// { status: 'submitted', batchId }, which is "sent", not yet "paid".
export async function captureApproval(id: string): Promise<CaptureResult> {
  try {
    const body = await sendJson(`/api/approvals/${encodeURIComponent(id)}/capture`, anything);
    if (body.status === 'submitted') {
      return { kind: 'sent', batchId: typeof body.batchId === 'string' ? body.batchId : undefined };
    }
    return { kind: 'paid', paypalId: typeof body.captureId === 'string' ? body.captureId : undefined };
  } catch (err) {
    if (err instanceof ApiFailure && err.status === 409) {
      const body = err.body as { reason?: string } | null;
      if (body?.reason === 'already_paid' || body?.reason === 'in_progress') return { kind: 'paid' };
      return { kind: 'failed', message: refusalMessage(body?.reason) };
    }
    return { kind: 'failed', message: "PayPal couldn't complete the payment. Nothing was charged twice; try again." };
  }
}

export function refusalMessage(reason: string | undefined): string {
  switch (reason) {
    case 'no_wallet':
      return "The agent can't buy anything until you connect a wallet.";
    case 'not_approved':
      return 'PayPal has not recorded your approval yet. Approve in the PayPal window first.';
    // PayPal refused the charge, which after the kill switch means the vault token is gone.
    case 'paypal_refused':
      return 'The agent wallet is revoked, so this spend is refused.';
    case 'no_recipient':
      return 'This payout has no PayPal email to send it to. Nothing was paid.';
    case 'invalid_reference':
      return 'PayPal won’t accept this payout’s reference. Nothing was paid; ask the agent to raise it again.';
    case 'payouts_unavailable':
      return 'Payouts aren’t set up on this server. Nothing was paid.';
    case 'payer_mismatch':
      return 'A different PayPal account approved it. Approve with the treasury account.';
    default:
      return 'The payment was refused. Nothing was charged.';
  }
}

export async function rejectApproval(id: string, reason: string): Promise<boolean> {
  try {
    await sendJson(`/api/approvals/${encodeURIComponent(id)}/reject`, anything, reason.trim() ? { reason: reason.trim() } : {});
    return true;
  } catch {
    return false;
  }
}

// What an approval is called in the queue and the detail: the person for a payout, the vendor or category for a purchase.
export function approvalTitle(item: ApprovalItem): string {
  if (item.kind === 'payout') return item.payee ?? item.payeeEmail ?? 'Payout';
  return item.vendor ?? item.category ?? item.referenceId;
}

// The queue shows oldest first; a capture in flight still counts as waiting.
export function waitingItems(items: ApprovalItem[]): ApprovalItem[] {
  return items
    .filter((item) => item.status === 'pending' || item.status === 'capturing')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
