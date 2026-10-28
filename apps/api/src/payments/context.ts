import type { PayPalClient } from '../paypal/client.js';
import { getPayPalClient, isPayPalAppConfigured } from '../paypal/client.js';
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
  approvals: { list(): ApprovalView[] };
}

let context: PaymentsContext | undefined;

// Built on first use, so the server still boots when the Procurement credentials are not set (routes answer 503).
export function getPayments(): PaymentsContext {
  if (!isPayPalAppConfigured('procurement')) throw new Error('PayPal Procurement app is not configured');
  if (!context) {
    const client = getPayPalClient('procurement');
    const wallet = createMemoryWalletStore();
    const approvals = createMemoryApprovals();
    const executor = createExecutor({
      client,
      // ponytail: swap for an adapter around the rules engine's check() when P1's rules/ lands
      check: stubCheck,
      audit: createMemoryAudit(),
      wallet,
      approvals,
      references: createMemoryReferences(),
    });
    context = { client, wallet, executor, approvals };
  }
  return context;
}
