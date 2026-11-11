import { z } from 'zod';
import { CurrencyCode, Id, IsoDateTime, MinorUnits, RuleResult } from './common.js';

// PayPal Payouts recipient_type. PHONE is left out because the sandbox does not support it.
export const PayoutRecipientType = z.enum(['EMAIL', 'PAYPAL_ID']);
export type PayoutRecipientType = z.infer<typeof PayoutRecipientType>;

// Where a person gets paid: their PayPal account, found by email or PayPal ID.
export const PayoutDestination = z.object({
  recipientType: PayoutRecipientType,
  receiver: z.string().min(1).max(127),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
});
export type PayoutDestination = z.infer<typeof PayoutDestination>;

export const PayoutKind = z.enum(['claim', 'speaker', 'prize']);
export type PayoutKind = z.infer<typeof PayoutKind>;

export const PayoutItemStatus = z.enum([
  'pending_approval',
  'queued',
  'processing',
  'paid',
  'failed',
  'unclaimed',
  'returned',
  'blocked',
]);
export type PayoutItemStatus = z.infer<typeof PayoutItemStatus>;

export const PayoutItem = z.object({
  id: Id,
  eventId: Id,
  // Null until the item is grouped into a batch.
  payoutId: Id.nullable(),
  kind: PayoutKind,
  recipientName: z.string().min(1),
  destination: PayoutDestination,
  amount: MinorUnits.positive(),
  currency: CurrencyCode,
  // Budget category, used by the dashboard's category cross-filter.
  category: z.string().min(1),
  sponsorId: Id.nullable(),
  claimId: Id.nullable(),
  note: z.string().max(4000),
  // PayPal sender_item_id (max 63 characters). Stable, so retries never double-pay.
  senderItemId: z.string().min(1).max(63),
  paypalItemId: z.string().nullable(),
  status: PayoutItemStatus,
  ruleResult: RuleResult.nullable(),
  updatedAt: IsoDateTime,
});
export type PayoutItem = z.infer<typeof PayoutItem>;

export const PayoutBatchStatus = z.enum([
  'draft',
  'pending_approval',
  'processing',
  'success',
  'denied',
  'canceled',
]);
export type PayoutBatchStatus = z.infer<typeof PayoutBatchStatus>;

export const PayoutBatch = z.object({
  id: Id,
  eventId: Id,
  // PayPal sender_batch_id (max 256 characters). Stable, since PayPal rejects a repeat for 30 days.
  senderBatchId: z.string().min(1).max(256),
  paypalBatchId: z.string().nullable(),
  status: PayoutBatchStatus,
  items: z.array(PayoutItem).min(1),
  total: MinorUnits,
  currency: CurrencyCode,
  ruleResult: RuleResult.nullable(),
  createdAt: IsoDateTime,
});
export type PayoutBatch = z.infer<typeof PayoutBatch>;

// POST /api/payouts (treasurer): pay a prize winner or a speaker. It goes through the rules engine like any
// spend; above the payout approval threshold it waits on the Approvals screen. No eventId: the demo event.
export const CreatePayoutRequest = z.object({
  eventId: Id.optional(),
  kind: z.enum(['prize', 'speaker']),
  recipientName: z.string().trim().min(1).max(80),
  recipientEmail: z.email().max(127),
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  amount: MinorUnits.positive(),
  category: z.string().trim().min(1).max(40).default('prizes'),
  // The sponsor whose money pays it: it then also needs that sponsor's invoice paid.
  sponsorId: Id.optional(),
  note: z.string().trim().max(200).default(''),
});
export type CreatePayoutRequest = z.infer<typeof CreatePayoutRequest>;

// GET /api/payouts[?eventId=] and the answer to POST: payout items in the shared shape.
export const PayoutsResponse = z.object({ payouts: z.array(PayoutItem) });
export type PayoutsResponse = z.infer<typeof PayoutsResponse>;
