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
  markRevoked(): Promise<void>;
}

// One referenceId = one spend. PayPal's idempotency key is derived from it, so reusing an id for a different
// spend would silently return the first spend's order. Back this with a unique constraint in the DB.
export interface ReferencePort {
  // 'same': an identical spend is being retried (safe, PayPal returns the same order); 'conflict': id used for something else
  claim(referenceId: string, fingerprint: string): Promise<'new' | 'same' | 'conflict'>;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export interface ApprovalsPort {
  create(spend: Spend, result: CheckResult, auditId: string): Promise<string>;
  get(id: string): Promise<{ spend: Spend; status: ApprovalStatus; decidedBy?: string } | null>;
  markPaid(id: string): Promise<void>;
}
