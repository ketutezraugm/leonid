import { z } from 'zod';
import type { PayPalClient } from './client.js';
import { PayPalLink } from './orders.js';

// Vault v3 on the Procurement app: connecting and revoking the agent's wallet. Nothing here moves money.
// Charging a saved wallet is in spend.ts and is reachable only through the rules-engine executor.

const SetupTokenResponse = z.object({
  id: z.string(),
  status: z.string(),
  links: z.array(PayPalLink).default([]),
});

const PaymentTokenResponse = z.object({
  id: z.string(),
  customer: z.object({ id: z.string() }).optional(),
  payment_source: z
    .object({
      paypal: z.object({ email_address: z.string().optional(), payer_id: z.string().optional() }).optional(),
    })
    .optional(),
});

export interface WalletSetup {
  setupTokenId: string;
  approveUrl: string;
}

export interface SavedWallet {
  paymentTokenId: string;
  customerId?: string;
  payerEmail?: string;
}

// Step 1: ask PayPal for a setup token. The treasurer opens approveUrl and logs in to let the agent charge later.
export async function createWalletSetup(
  client: PayPalClient,
  input: {
    referenceId: string;
    returnUrl: string;
    cancelUrl: string;
    // Default false: one token per payer, so deleting it really ends the agent's spending.
    // Only the hosted demo's token pool opts in. Extra tokens survive a kill switch that deletes one, so never use it for a real wallet.
    permitMultipleTokens?: boolean;
  },
): Promise<WalletSetup> {
  const res = await client.request({
    method: 'POST',
    path: '/v3/vault/setup-tokens',
    schema: SetupTokenResponse,
    requestId: `wallet-setup-${input.referenceId}`,
    body: {
      payment_source: {
        paypal: {
          usage_type: 'MERCHANT',
          customer_type: 'CONSUMER',
          permit_multiple_payment_tokens: input.permitMultipleTokens ?? false,
          experience_context: { return_url: input.returnUrl, cancel_url: input.cancelUrl },
        },
      },
    },
  });
  const approve = res.links.find((l) => l.rel === 'approve');
  if (!approve) throw new Error(`PayPal setup token ${res.id} has no approve link`);
  return { setupTokenId: res.id, approveUrl: approve.href };
}

// Step 2: after the payer approved, turn the setup token into the reusable payment token.
export async function createPaymentToken(
  client: PayPalClient,
  input: { setupTokenId: string },
): Promise<SavedWallet> {
  const res = await client.request({
    method: 'POST',
    path: '/v3/vault/payment-tokens',
    schema: PaymentTokenResponse,
    requestId: `wallet-token-${input.setupTokenId}`,
    body: { payment_source: { token: { id: input.setupTokenId, type: 'SETUP_TOKEN' } } },
  });
  return {
    paymentTokenId: res.id,
    customerId: res.customer?.id,
    payerEmail: res.payment_source?.paypal?.email_address,
  };
}

// The kill switch. PayPal enforces it: once deleted, the next charge is refused with 403 (tested in sandbox).
export async function deletePaymentToken(client: PayPalClient, paymentTokenId: string): Promise<void> {
  await client.request({
    method: 'DELETE',
    path: `/v3/vault/payment-tokens/${encodeURIComponent(paymentTokenId)}`,
    schema: z.undefined(),
  });
}
