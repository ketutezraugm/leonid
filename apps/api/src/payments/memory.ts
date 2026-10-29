import type { ApprovalRecord, ApprovalStatus, ApprovalsPort, AuditPort, CheckResult, ReferencePort, WalletPort } from './ports.js';

// In-memory adapters for tests and for local runs without DATABASE_URL: a restart forgets everything.
// The server uses the DB-backed versions in db.ts.

export interface SavedWallet {
  paymentTokenId: string;
  customerId?: string;
  payerEmail?: string;
}

export interface WalletStore extends WalletPort {
  queueDeletion(paymentTokenId: string): Promise<void>; // a token that must be deleted at PayPal and was never made active
  beginSetup(setupTokenId: string): Promise<void>; // remember a setup token we created
  takeSetup(setupTokenId: string): Promise<boolean>; // true once, only for a setup token we created
  activate(wallet: SavedWallet): Promise<void>; // throws while another wallet is active
  snapshot(): Promise<{ status: 'none' | 'active' | 'revoked'; payerEmail?: string }>;
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
    beginSetup: async (id) => void pending.add(id),
    takeSetup: async (id) => pending.delete(id),
    async activate(wallet) {
      // Never overwrite a live token: it would stay chargeable at PayPal with nothing left that can delete it.
      if (active) throw new Error('a wallet is already active; revoke it first');
      active = wallet;
      revoked = false;
    },
    snapshot: async () => (active ? { status: 'active', payerEmail: active.payerEmail } : { status: revoked ? 'revoked' : 'none' }),
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

export type ApprovalView = ApprovalRecord;

export function createMemoryApprovals(): ApprovalsPort & { list(): Promise<ApprovalView[]> } {
  const rows = new Map<string, Omit<ApprovalView, 'id'> & { rejectedBy?: string }>();
  // Same contract as the DB version: a transition applies only from the expected status, and says whether it did.
  const move = (id: string, from: ApprovalStatus, to: ApprovalStatus, extra: { rejectedBy?: string } = {}) => {
    const row = rows.get(id);
    if (row?.status !== from) return false;
    Object.assign(row, { status: to, ...extra });
    return true;
  };
  const view = ([id, r]: [string, Omit<ApprovalView, 'id'>]): ApprovalView =>
    ({ id, spend: r.spend, status: r.status, reasons: r.reasons, paypalOrderId: r.paypalOrderId });
  return {
    async create(spend, result) {
      const id = `approval-${rows.size + 1}`;
      rows.set(id, { spend, status: 'pending', reasons: result.reasons });
      return id;
    },
    async attachOrder(id, paypalOrderId) {
      if ([...rows].some(([other, r]) => other !== id && r.paypalOrderId === paypalOrderId)) {
        throw new Error(`PayPal order ${paypalOrderId} already belongs to another approval`);
      }
      const row = rows.get(id);
      if (row) row.paypalOrderId = paypalOrderId;
    },
    async findByOrder(paypalOrderId) {
      return [...rows].find(([, r]) => r.paypalOrderId === paypalOrderId)?.[0] ?? null;
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async findByReference(referenceId) {
      const found = [...rows].find(([, r]) => r.spend.referenceId === referenceId);
      return found ? view(found) : null;
    },
    claimCapture: async (id) => move(id, 'pending', 'capturing'),
    releaseCapture: async (id) => move(id, 'capturing', 'pending'),
    markPaid: async (id) => move(id, 'capturing', 'paid'),
    reject: async (id, by) => move(id, 'pending', 'rejected', { rejectedBy: by }),
    list: async () => [...rows].map(view),
  };
}
