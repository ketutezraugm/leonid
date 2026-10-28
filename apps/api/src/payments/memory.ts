import type { ApprovalStatus, ApprovalsPort, AuditPort, CheckResult, ReferencePort, Spend, WalletPort } from './ports.js';

// ponytail: in-memory adapters, so a restart forgets the wallet, approvals, audit rows and used reference ids.
// Replace each with a DB-backed version (unique constraint on the reference id) once the schema is agreed.

export interface SavedWallet {
  paymentTokenId: string;
  customerId?: string;
  payerEmail?: string;
}

export interface WalletStore extends WalletPort {
  queueDeletion(paymentTokenId: string): Promise<void>; // a token that must be deleted at PayPal and was never made active
  beginSetup(setupTokenId: string): void; // remember a setup token we created
  takeSetup(setupTokenId: string): boolean; // true once, only for a setup token we created
  activate(wallet: SavedWallet): void;
  snapshot(): { status: 'none' | 'active' | 'revoked'; payerEmail?: string };
}

export function createMemoryWalletStore(): WalletStore {
  let active: SavedWallet | null = null;
  let revoked = false;
  const pending = new Set<string>(); // setup tokens we created
  const toDelete = new Set<string>(); // payment tokens revoked locally but not yet confirmed deleted at PayPal
  return {
    async getActive() {
      return active ? { paymentTokenId: active.paymentTokenId } : null;
    },
    async markRevoked() {
      if (active) toDelete.add(active.paymentTokenId);
      active = null;
      revoked = true;
    },
    async pendingDeletions() {
      return [...toDelete];
    },
    async confirmDeleted(id) {
      toDelete.delete(id);
    },
    async queueDeletion(id) {
      toDelete.add(id);
    },
    beginSetup: (id) => void pending.add(id),
    takeSetup: (id) => pending.delete(id),
    activate(wallet) {
      // Never overwrite a live token: it would stay chargeable at PayPal with nothing left that can delete it.
      if (active) throw new Error('a wallet is already active; revoke it first');
      active = wallet;
      revoked = false;
    },
    snapshot: () => (active ? { status: 'active', payerEmail: active.payerEmail } : { status: revoked ? 'revoked' : 'none' }),
  };
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  input: unknown;
  reason: string;
  ruleResult?: CheckResult;
  outcome?: string;
  paypalId?: string;
  detail?: string;
}

export function createMemoryAudit(): AuditPort & { rows: AuditRow[] } {
  const rows: AuditRow[] = [];
  return {
    rows,
    async record(entry) {
      const id = `audit-${rows.length + 1}`;
      rows.push({ id, at: new Date().toISOString(), ...entry });
      return id;
    },
    async update(id, patch) {
      Object.assign(rows.find((r) => r.id === id) ?? {}, patch);
    },
  };
}

export function createMemoryReferences(): ReferencePort {
  const used = new Map<string, string>();
  return {
    async claim(referenceId, fingerprint) {
      const existing = used.get(referenceId);
      if (existing === undefined) {
        used.set(referenceId, fingerprint);
        return 'new';
      }
      return existing === fingerprint ? 'same' : 'conflict';
    },
  };
}

export interface ApprovalView {
  id: string;
  spend: Spend;
  status: ApprovalStatus;
  reasons: string[];
  paypalOrderId?: string;
}

export function createMemoryApprovals(): ApprovalsPort & { list(): ApprovalView[] } {
  const rows = new Map<string, Omit<ApprovalView, 'id'> & { rejectedBy?: string }>();
  return {
    async create(spend, result) {
      const id = `approval-${rows.size + 1}`;
      rows.set(id, { spend, status: 'pending', reasons: result.reasons });
      return id;
    },
    async attachOrder(id, paypalOrderId) {
      const row = rows.get(id);
      if (row) row.paypalOrderId = paypalOrderId;
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async reject(id, by) {
      const row = rows.get(id);
      if (row) Object.assign(row, { status: 'rejected', rejectedBy: by });
    },
    async markPaid(id) {
      const row = rows.get(id);
      if (row) row.status = 'paid';
    },
    list: () => [...rows].map(([id, r]) => ({ id, spend: r.spend, status: r.status, reasons: r.reasons, paypalOrderId: r.paypalOrderId })),
  };
}
