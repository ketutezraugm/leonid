import { z } from 'zod';
import { writeAudit } from '../../db/audit.js';
import type { Db } from '../../db/client.js';
import { applyPayoutItem } from '../../payouts/service.js';
import type { WebhookHandler } from '../registry.js';

// PayPal's payout item events (Treasury app). Each carries one payout item, the same object a batch read-back
// lists (paypal/payout-status.ts): its transaction_status says what happened to that one person's money.
// This is the live source of truth for claims, prizes and speaker fees (invariant 5).
export const PAYOUT_ITEM_EVENTS = [
  'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
  'PAYMENT.PAYOUTS-ITEM.FAILED',
  'PAYMENT.PAYOUTS-ITEM.BLOCKED',
  'PAYMENT.PAYOUTS-ITEM.CANCELED',
  'PAYMENT.PAYOUTS-ITEM.DENIED',
  'PAYMENT.PAYOUTS-ITEM.HELD',
  'PAYMENT.PAYOUTS-ITEM.REFUNDED',
  'PAYMENT.PAYOUTS-ITEM.RETURNED',
  'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
] as const;

const PayoutItemResource = z.object({
  payout_item_id: z.string().min(1),
  transaction_status: z.string().optional(),
  payout_batch_id: z.string().optional(),
  payout_item: z.object({ sender_item_id: z.string().min(1) }),
});

export function createPayoutItemHandler(getDb: () => Db): WebhookHandler {
  return async (event, { app }) => {
    if (app !== 'treasury') return; // payouts are sent from the Treasury app only
    const db = getDb();
    const parsed = PayoutItemResource.safeParse(event.resource);
    if (!parsed.success) {
      await writeAudit(db, {
        actor: 'paypal-webhook',
        action: 'payout.status_ignored',
        input: { webhookEventId: event.id },
        reason: `${event.event_type} resource is not a payout item`,
      });
      return;
    }
    await applyPayoutItem(db, {
      senderItemId: parsed.data.payout_item.sender_item_id,
      transactionStatus: parsed.data.transaction_status ?? null,
      paypalItemId: parsed.data.payout_item_id,
      webhookEventId: event.id,
    });
  };
}
