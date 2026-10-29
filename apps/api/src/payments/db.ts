import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agentWallet, approvals as approvalsTable, auditLog, spendReferences, walletSetups } from '../db/schema.js';
import type { ApprovalView, SavedWallet, WalletStore } from './memory.js';
import type { ApprovalRecord, ApprovalStatus, ApprovalsPort, AuditPort, ReferencePort, Spend } from './ports.js';

// DB-backed versions of the adapters in memory.ts: wallet, approvals, audit and used reference ids survive a restart.

export function createDbWalletStore(db: Db): WalletStore {
  return {
    async getActive() {
      const [row] = await db.select().from(agentWallet).where(eq(agentWallet.status, 'active'));
      return row ? { paymentTokenId: row.paymentTokenId } : null;
    },
    // The row stays, with deleted_at null, until PayPal confirms the delete.
    async markRevoked() {
      await db.update(agentWallet).set({ status: 'revoked' }).where(eq(agentWallet.status, 'active'));
    },
    async pendingDeletions() {
      const rows = await db
        .select({ id: agentWallet.paymentTokenId })
        .from(agentWallet)
        .where(and(eq(agentWallet.status, 'revoked'), isNull(agentWallet.deletedAt)));
      return rows.map((r) => r.id);
    },
    async confirmDeleted(paymentTokenId) {
      await db.update(agentWallet).set({ deletedAt: new Date() }).where(eq(agentWallet.paymentTokenId, paymentTokenId));
    },
    async queueDeletion(paymentTokenId) {
      await db.insert(agentWallet).values({ paymentTokenId, status: 'revoked' }).onConflictDoNothing();
    },
    async beginSetup(setupTokenId) {
      await db.insert(walletSetups).values({ setupTokenId }).onConflictDoNothing();
    },
    async takeSetup(setupTokenId) {
      const taken = await db.delete(walletSetups).where(eq(walletSetups.setupTokenId, setupTokenId)).returning();
      return taken.length > 0;
    },
    // The partial unique index refuses a second active token, so this throws instead of overwriting a live one.
    async activate(wallet: SavedWallet) {
      await db.insert(agentWallet).values({ ...wallet, status: 'active' });
    },
    async snapshot() {
      const [active] = await db.select().from(agentWallet).where(eq(agentWallet.status, 'active'));
      if (active) return { status: 'active', payerEmail: active.payerEmail ?? undefined };
      const [revoked] = await db.select({ id: agentWallet.id }).from(agentWallet).limit(1);
      return { status: revoked ? 'revoked' : 'none' };
    },
  };
}

export function createDbAudit(db: Db): AuditPort {
  return {
    async record(entry) {
      const [row] = await db
        .insert(auditLog)
        .values({
          actor: entry.actor,
          action: entry.action,
          input: entry.input ?? null,
          reason: entry.reason,
          ruleResult: entry.ruleResult ? JSON.stringify(entry.ruleResult) : null,
        })
        .returning({ id: auditLog.id });
      return row!.id;
    },
    async update(id, patch) {
      await db.update(auditLog).set(patch).where(eq(auditLog.id, id));
    },
  };
}

export function createDbReferences(db: Db): ReferencePort {
  return {
    async claim(referenceId, fingerprint) {
      const inserted = await db.insert(spendReferences).values({ referenceId, fingerprint }).onConflictDoNothing().returning();
      if (inserted.length > 0) return 'new';
      const [existing] = await db.select().from(spendReferences).where(eq(spendReferences.referenceId, referenceId));
      return existing?.fingerprint === fingerprint ? 'same' : 'conflict';
    },
  };
}

export function createDbApprovals(db: Db): ApprovalsPort & { list(): Promise<ApprovalView[]> } {
  const pick = (id: string) => eq(approvalsTable.id, id);
  const record = (r: typeof approvalsTable.$inferSelect): ApprovalRecord => ({
    id: r.id,
    spend: r.spend as Spend,
    status: r.status,
    reasons: r.reasons,
    paypalOrderId: r.paypalOrderId ?? undefined,
  });
  const view = (r: typeof approvalsTable.$inferSelect): ApprovalView => ({ ...record(r), createdAt: r.createdAt.toISOString() });
  // One conditional UPDATE: of two callers racing on the same row, only one sees its WHERE match.
  const move = async (id: string, from: ApprovalStatus, to: ApprovalStatus, extra: { rejectedBy?: string } = {}) => {
    const moved = await db
      .update(approvalsTable)
      .set({ status: to, ...extra })
      .where(and(pick(id), eq(approvalsTable.status, from)))
      .returning({ id: approvalsTable.id });
    return moved.length > 0;
  };
  return {
    async create(spend, result, auditId) {
      const [row] = await db
        .insert(approvalsTable)
        .values({ spend, reasons: result.reasons, auditId })
        .returning({ id: approvalsTable.id });
      return row!.id;
    },
    // approvals_paypal_order_unique makes this throw if another approval already has the order.
    async attachOrder(id, paypalOrderId) {
      await db.update(approvalsTable).set({ paypalOrderId }).where(pick(id));
    },
    async findByOrder(paypalOrderId) {
      const [row] = await db.select({ id: approvalsTable.id }).from(approvalsTable).where(eq(approvalsTable.paypalOrderId, paypalOrderId));
      return row?.id ?? null;
    },
    async get(id) {
      // A malformed id is just "not found", not a 500.
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const [row] = await db.select().from(approvalsTable).where(pick(id));
      return row ? { spend: row.spend as Spend, status: row.status, paypalOrderId: row.paypalOrderId ?? undefined } : null;
    },
    async findByReference(referenceId) {
      const [row] = await db
        .select()
        .from(approvalsTable)
        .where(sql`${approvalsTable.spend}->>'referenceId' = ${referenceId}`)
        .orderBy(approvalsTable.createdAt)
        .limit(1);
      return row ? record(row) : null;
    },
    claimCapture: (id) => move(id, 'pending', 'capturing'),
    releaseCapture: (id) => move(id, 'capturing', 'pending'),
    markPaid: (id) => move(id, 'capturing', 'paid'),
    reject: (id, by) => move(id, 'pending', 'rejected', { rejectedBy: by }),
    async list() {
      // Oldest first; id breaks ties between rows created in the same instant, so the order is stable.
      const rows = await db.select().from(approvalsTable).orderBy(asc(approvalsTable.createdAt), asc(approvalsTable.id));
      return rows.map(view);
    },
  };
}
