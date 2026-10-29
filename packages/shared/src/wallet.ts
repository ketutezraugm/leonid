import { z } from 'zod';

// The agent's PayPal wallet: a saved PayPal payment method (a Vault token) the agent may charge within the rules.
// The kill switch deletes that token at PayPal, so a revoked wallet is refused by PayPal itself. Treasurer only.
//   GET  /api/wallet         -> WalletStatus
//   POST /api/wallet/connect -> WalletConnectResponse (409 when a wallet is already active). Open approveUrl in the browser:
//                               the payer approves at PayPal, which returns to `${APP_BASE_URL}/?wallet=<WalletResult>`.
//   POST /api/wallet/revoke  -> WalletRevokeResponse
export const WalletState = z.enum(['none', 'active', 'revoked']);
export type WalletState = z.infer<typeof WalletState>;

export const WalletStatus = z.object({
  status: WalletState,
  payerEmail: z.string().optional(), // the PayPal account the agent charges; only while active
});
export type WalletStatus = z.infer<typeof WalletStatus>;

export const WalletConnectResponse = z.object({ approveUrl: z.url() });
export type WalletConnectResponse = z.infer<typeof WalletConnectResponse>;

// revoked: false means there was nothing to revoke. The request can also fail (502) after our own spending is already
// stopped, when PayPal could not delete the token yet: GET /api/wallet then shows 'revoked', and calling revoke again
// retries the deletion. Show that as "Agent stopped, PayPal deletion pending" with a retry, not as a plain failure.
export const WalletRevokeResponse = z.object({ revoked: z.boolean() });
export type WalletRevokeResponse = z.infer<typeof WalletRevokeResponse>;

export const WalletResult = z.enum(['connected', 'cancelled', 'error']);
export type WalletResult = z.infer<typeof WalletResult>;
