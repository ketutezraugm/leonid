import { z } from 'zod';

// Log in with PayPal for the treasurer (F1). Login is a full-page redirect to PayPal and back, not a popup:
//   GET  /api/auth/paypal/login    -> 302 to PayPal
//   GET  /api/auth/paypal/callback -> 302 to `${APP_BASE_URL}/?login=<LoginResult>`
//   GET  /api/auth/me              -> SessionInfo, or 401 { error } when not logged in (also 503 when login is not configured)
//   POST /api/auth/logout          -> { ok: true }
//   POST /api/auth/demo-login      -> { ok: true, demo: true }, or 404 when demo login is off
// Any 401 from /api/* means the session is missing or expired: send the person to sign in again.
export const SessionInfo = z.object({
  email: z.string().optional(), // absent for a demo session
  via: z.enum(['paypal', 'demo']),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

// ok: signed in. denied: PayPal signed the person in but the account is not on the treasurer allowlist. error: anything else.
export const LoginResult = z.enum(['ok', 'denied', 'error']);
export type LoginResult = z.infer<typeof LoginResult>;
