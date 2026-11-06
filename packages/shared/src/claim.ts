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

// --- Receipt claims API (F16)

// A volunteer the treasurer registered. Money for their claims only ever goes to the PayPal email given here,
// so the person holding the claim link cannot send it anywhere else. The email is shown masked.
export const ClaimVolunteer = z.object({
  id: Id,
  eventId: Id,
  name: z.string().min(1).max(80),
  payoutEmailHint: z.string(),
});
export type ClaimVolunteer = z.infer<typeof ClaimVolunteer>;

// POST /api/claims/volunteers (treasurer). No eventId: the seeded demo event.
export const CreateVolunteerRequest = z.object({
  eventId: Id.optional(),
  name: z.string().trim().min(1).max(80),
  payoutEmail: z.email().max(127),
});
export type CreateVolunteerRequest = z.infer<typeof CreateVolunteerRequest>;

// The claim token is shown once, inside the volunteer's link. Only its hash is stored.
export const CreateVolunteerResponse = z.object({ volunteer: ClaimVolunteer, claimToken: z.string().min(1) });
export type CreateVolunteerResponse = z.infer<typeof CreateVolunteerResponse>;

export const ReceiptMimeType = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export type ReceiptMimeType = z.infer<typeof ReceiptMimeType>;

// The most a receipt photo may weigh, decoded.
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

// POST /api/claims/mine (the volunteer's x-claim-token). The amount is what the receipt says, never typed.
export const SubmitClaimRequest = z.object({
  category: z.string().trim().min(1).max(40).default('volunteer'),
  mimeType: ReceiptMimeType,
  // Base64 of the photo; ~4/3 of RECEIPT_MAX_BYTES at most.
  imageBase64: z.string().min(1).max(Math.ceil((RECEIPT_MAX_BYTES * 4) / 3) + 4),
});
export type SubmitClaimRequest = z.infer<typeof SubmitClaimRequest>;

// One claim as both screens show it. reasons: why it waits or was declined (rule reasons, review reasons).
export const ClaimView = z.object({
  id: Id,
  eventId: Id,
  volunteerName: z.string().min(1),
  category: z.string().min(1),
  amount: MinorUnits.nullable(),
  currency: CurrencyCode,
  status: ClaimStatus,
  reasons: z.array(z.string()),
  extracted: ReceiptExtraction.nullable(),
  paypalBatchId: z.string().nullable(),
  submittedAt: IsoDateTime,
});
export type ClaimView = z.infer<typeof ClaimView>;

// GET /api/claims/mine
export const VolunteerClaimsResponse = z.object({
  volunteer: z.object({ name: z.string(), eventName: z.string() }),
  claims: z.array(ClaimView),
});
export type VolunteerClaimsResponse = z.infer<typeof VolunteerClaimsResponse>;

// GET /api/claims[?eventId=] (treasurer)
export const ClaimsResponse = z.object({ claims: z.array(ClaimView), volunteers: z.array(ClaimVolunteer) });
export type ClaimsResponse = z.infer<typeof ClaimsResponse>;

// POST /api/claims/:id/review (treasurer): the amount the treasurer read off the receipt. It still goes
// through the rules engine like any claim.
export const ReviewClaimRequest = z.object({ amount: MinorUnits.positive() });
export type ReviewClaimRequest = z.infer<typeof ReviewClaimRequest>;
