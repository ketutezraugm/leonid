import { z } from 'zod';
import { CurrencyCode, Id, IsoDate, IsoDateTime, MinorUnits, RuleResult } from './common.js';
import { PayoutDestination } from './payout.js';

const Confidence = z.number().min(0).max(1);

export const ReceiptLineItem = z.object({
  description: z.string(),
  amount: MinorUnits,
});
export type ReceiptLineItem = z.infer<typeof ReceiptLineItem>;

// Fixed schema for the vision model. A field below the review threshold goes to a human, never to auto-payout.
export const ReceiptExtraction = z.object({
  merchant: z.string().min(1),
  date: IsoDate,
  total: MinorUnits,
  currency: CurrencyCode,
  lineItems: z.array(ReceiptLineItem),
  confidence: z.object({
    merchant: Confidence,
    date: Confidence,
    total: Confidence,
    currency: Confidence,
    lineItems: Confidence,
  }),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtraction>;

export const ClaimStatus = z.enum([
  'submitted',
  'needs_review',
  'pending_approval',
  'approved',
  'paid',
  'rejected',
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const Claim = z.object({
  id: Id,
  eventId: Id,
  personId: Id,
  personName: z.string().min(1),
  destination: PayoutDestination,
  receiptUrl: z.string().min(1),
  // Null until extraction has run.
  extracted: ReceiptExtraction.nullable(),
  category: z.string().min(1),
  amount: MinorUnits,
  currency: CurrencyCode,
  status: ClaimStatus,
  // Null until the rules engine has checked the claim.
  ruleResult: RuleResult.nullable(),
  payoutItemId: Id.nullable(),
  submittedAt: IsoDateTime,
});
export type Claim = z.infer<typeof Claim>;
