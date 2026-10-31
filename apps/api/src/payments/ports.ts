// What the executor needs from the rest of the system. Each port is implemented once the owner's piece lands:
// check() by the rules engine (P1), audit by the audit_log table (P1), wallet and approvals by the DB layer.

export interface Spend {
  // Our own record id (cart, claim, payout). Becomes PayPal's idempotency key, so one spend can only ever be charged once.
  referenceId: string;
  amountMinor: number;
  currency: string;
  actor: string; // who asked: an agent id, or a user
  reason: string; // the agent's reasoning summary, shown on the Approvals screen
  category?: string;
  vendor?: string;
  // The event this spend belongs to. Optional so existing callers keep working; it lands in the audit row's input,
  // which the rules-health widget reads to scope its counts per event. Not part of the retry fingerprint on purpose,
  // so a retry that adds it is not refused as a different spend. Callers that know their event should set it.
  eventId?: string;
}

// Same shape as money-safety.md: { decision, reasons, ruleIds }.
export interface CheckResult {
  decision: 'allow' | 'needs_approval' | 'block';
  reasons: string[];
  ruleIds: string[];
}
export type CheckSpend = (spend: Spend) => CheckResult | Promise<CheckResult>;

export interface AuditPort {
  record(entry: { actor: string; action: string; input: unknown; reason: string; ruleResult?: CheckResult }): Promise<string>;
  update(id: string, patch: { outcome: string; paypalId?: string; detail?: string }): Promise<void>;
}

export interface WalletPort {
  getActive(): Promise<{ paymentTokenId: string } | null>;
  // Stops our own spending at once AND remembers the token as "still to delete at PayPal" until confirmDeleted.
  markRevoked(): Promise<void>;
  pendingDeletions(): Promise<string[]>;
  confirmDeleted(paymentTokenId: string): Promise<void>;
}

// One referenceId = one spend. PayPal's idempotency key is derived from it, so reusing an id for a different
// spend would silently return the first spend's order. Back this with a unique constraint in the DB.
export interface ReferencePort {
  // 'same': an identical spend is being retried (safe, PayPal returns the same order); 'conflict': id used for something else
  claim(referenceId: string, fingerprint: string): Promise<'new' | 'same' | 'conflict'>;
}

// The treasurer's approval is the PayPal popup: the approval row points at a PayPal order that only the treasurer
// can approve. We never mark anything approved ourselves; the executor asks PayPal whether the order is APPROVED.
//
// Status only moves along these edges, each one a single conditional write that says whether it applied, so a capture
// and a reject (or two captures) racing on one approval can never both win:
//   pending -> capturing   claimCapture: taken before PayPal is asked to capture
//   capturing -> paid      markPaid: PayPal captured the spend's exact amount
//   capturing -> pending   releaseCapture: PayPal did not capture, so it can be retried or rejected
//   pending -> rejected    reject
// A row left in 'capturing' means money may have moved but we could not confirm it: it needs a human, never a reject.
export type ApprovalStatus = 'pending' | 'capturing' | 'rejected' | 'paid';
export interface ApprovalRecord {
  id: string;
  spend: Spend;
  status: ApprovalStatus;
  reasons: string[];
  paypalOrderId?: string;
}
export interface ApprovalsPort {
  create(spend: Spend, result: CheckResult, auditId: string): Promise<string>;
  attachOrder(id: string, paypalOrderId: string): Promise<void>; // one approval per PayPal order: throws if another has it
  findByOrder(paypalOrderId: string): Promise<string | null>; // the approval id for a PayPal order, if it is ours
  get(id: string): Promise<{ spend: Spend; status: ApprovalStatus; paypalOrderId?: string } | null>;
  findByReference(referenceId: string): Promise<ApprovalRecord | null>; // the approval already made for this spend, if any
  claimCapture(id: string): Promise<boolean>;
  releaseCapture(id: string): Promise<boolean>;
  markPaid(id: string): Promise<boolean>;
  reject(id: string, by: string): Promise<boolean>;
}
