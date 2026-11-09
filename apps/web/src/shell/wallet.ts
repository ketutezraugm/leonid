import type { WalletState } from '@quartermaster/shared';

// What the agent can do in each state, in the words the screens use.
export function walletConsequence(status: WalletState): string {
  if (status === 'active') return 'The agent can pay carts within your rules.';
  if (status === 'revoked') return 'The agent can no longer spend. Connect a new wallet to resume.';
  return "The agent can't buy anything until you connect a wallet.";
}
