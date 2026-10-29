import type { PayPalClient } from '../paypal/client.js';
import { getPayPalClient, isPayPalAppConfigured } from '../paypal/client.js';
import { getDb } from '../db/client.js';
import { createDbApprovals, createDbAudit, createDbReferences, createDbWalletStore } from './db.js';
import { createExecutor, type Executor } from './executor.js';
import {
  createMemoryApprovals,
  createMemoryAudit,
  createMemoryReferences,
  createMemoryWalletStore,
  type ApprovalView,
  type WalletStore,
} from './memory.js';
import { stubCheck } from './stub-check.js';

export interface PaymentsContext {
  client: PayPalClient; // Procurement app
  wallet: WalletStore;
  executor: Executor;
  approvals: { list(): Promise<ApprovalView[]> };
}

let context: PaymentsContext | undefined;

// Money state must survive a redeploy. With in-memory stores a restart forgets the agent wallet, so the kill switch would
// find nothing to delete and leave the payment token live at PayPal. Production therefore refuses to run without a DB.
export function assertDurableMoneyState(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set in production: wallet, approvals and audit cannot be kept in memory');
  }
}

// Built on first use, so the server still boots when the Procurement credentials are not set (routes answer 503).
export function getPayments(): PaymentsContext {
  if (!isPayPalAppConfigured('procurement')) throw new Error('PayPal Procurement app is not configured');
  if (!context) {
    assertDurableMoneyState();
    const client = getPayPalClient('procurement');
    // Money state lives in the DB. Without DATABASE_URL (local runs only) it falls back to memory and a restart forgets it.
    const db = process.env.DATABASE_URL ? getDb() : undefined;
    if (!db) console.warn('DATABASE_URL is not set: wallet, approvals and audit are kept in memory only');
    const wallet = db ? createDbWalletStore(db) : createMemoryWalletStore();
    const approvals = db ? createDbApprovals(db) : createMemoryApprovals();
    const executor = createExecutor({
      client,
      // ponytail: swap for an adapter around the rules engine's check() when P1's rules/ lands
      check: stubCheck,
      audit: db ? createDbAudit(db) : createMemoryAudit(),
      wallet,
      approvals,
      references: db ? createDbReferences(db) : createMemoryReferences(),
    });
    context = { client, wallet, executor, approvals };
  }
  return context;
}
