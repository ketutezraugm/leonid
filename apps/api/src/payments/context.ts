import type { PayPalClient } from '../paypal/client.js';
import { getPayPalClient, isPayPalAppConfigured } from '../paypal/client.js';
import { getDb, type Db } from '../db/client.js';
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
import { createPayoutSender } from './payoutSender.js';
import { createRulesCheck } from './rulesCheck.js';
import type { ApprovalsPort, CheckSpend } from './ports.js';
import { stubCheck } from './stub-check.js';

// The real rules engine whenever there is a database to read today's spend and the category totals from. The stand-in
// ("nothing over $200") only serves local runs without DATABASE_URL. Cleared income is not a gate: the organizer's
// own PayPal account pays.
export const pickCheck = (db: Db | undefined): CheckSpend => (db ? createRulesCheck(db) : stubCheck);

export interface PaymentsContext {
  client: PayPalClient; // Procurement app
  wallet: WalletStore;
  executor: Executor;
  approvals: Pick<ApprovalsPort, 'findByOrder' | 'get'> & { list(): Promise<ApprovalView[]> };
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
      check: pickCheck(db),
      audit: db ? createDbAudit(db) : createMemoryAudit(),
      wallet,
      approvals,
      references: db ? createDbReferences(db) : createMemoryReferences(),
      // Claims and payouts are paid from the Treasury app. Without its credentials there is no sender and every payout is refused.
      payouts: isPayPalAppConfigured('treasury') ? createPayoutSender(() => getPayPalClient('treasury')) : undefined,
    });
    context = { client, wallet, executor, approvals };
  }
  return context;
}
