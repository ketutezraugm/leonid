import { z } from 'zod';
import { CurrencyCode, IsoDateTime, MinorUnits } from './common.js';

// GET /api/approvals (treasurer only): spends the rules sent to the treasurer, oldest first.
// Each one has a PayPal order that only the treasurer can approve in the PayPal popup; the browser then calls
// POST /api/approvals/:id/capture. The webhook can capture first, so capture answering 409 with status 'paid' on the
// next list is a success, not an error. `reasons` is why the rules sent it here; `agentReason` is the agent's own summary.
export const ApprovalStatus = z.enum(['pending', 'rejected', 'paid']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalItem = z.object({
  id: z.string(),
  status: ApprovalStatus,
  createdAt: IsoDateTime,
  referenceId: z.string(),
  amountMinor: MinorUnits,
  currency: CurrencyCode,
  actor: z.string(),
  agentReason: z.string(),
  reasons: z.array(z.string()),
  category: z.string().optional(),
  vendor: z.string().optional(),
  paypalOrderId: z.string().optional(),
});
export type ApprovalItem = z.infer<typeof ApprovalItem>;

export const ApprovalsResponse = z.object({ approvals: z.array(ApprovalItem) });
export type ApprovalsResponse = z.infer<typeof ApprovalsResponse>;

// POST /api/approvals/:id/reject. The reason is optional and goes to the audit log.
export const REJECT_REASON_MAX_LENGTH = 200;
export const RejectApprovalRequest = z.object({ reason: z.string().trim().max(REJECT_REASON_MAX_LENGTH).optional() });
export type RejectApprovalRequest = z.infer<typeof RejectApprovalRequest>;
