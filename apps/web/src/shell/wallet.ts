import type { Parser } from './api';

// GET /api/wallet (treasurer only): the agent's PayPal wallet. It is a PayPal account, not a card,
// so the only identifier is the payer's email.
export type WalletStatus = 'none' | 'active' | 'revoked';

export interface WalletSnapshot {
  status: WalletStatus;
  payerEmail?: string;
}

export const parseWallet: Parser<WalletSnapshot> = {
  parse(value) {
    const v = value as { status?: unknown; payerEmail?: unknown } | null;
    if (!v || (v.status !== 'none' && v.status !== 'active' && v.status !== 'revoked')) {
      throw new Error('Unexpected /api/wallet response');
    }
    return { status: v.status, payerEmail: typeof v.payerEmail === 'string' ? v.payerEmail : undefined };
  },
};

export function walletLabel(status: WalletStatus): string {
  return status === 'active' ? 'Agent wallet · Active' : status === 'revoked' ? 'Agent wallet · Revoked' : 'Agent wallet · Not connected';
}

// What the agent can do in each state, in the words the screens use.
export function walletConsequence(status: WalletStatus): string {
  if (status === 'active') return 'The agent can pay carts within your rules.';
  if (status === 'revoked') return 'The agent can no longer spend. Connect a new wallet to resume.';
  return "The agent can't buy anything until you connect a wallet.";
}
