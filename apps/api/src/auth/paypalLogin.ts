import { z } from 'zod';
import { toPayPalApiError } from '../paypal/errors.js';
import { PAYPAL_SANDBOX_BASE_URL } from '../paypal/client.js';

// Log in with PayPal (Identity) on the Treasury app, sandbox only. The APIMatic plugin does not cover Identity
// (see README, APIMatic), so these shapes come from PayPal's developer docs:
//   https://developer.paypal.com/docs/log-in-with-paypal/integrate/  (authorize URL, token exchange)
//   https://developer.paypal.com/docs/api/identity/v1/                (userinfo)
// Unverified against a real login: the userinfo path and which of user_id / sub / email_verified the sandbox returns.

const SANDBOX_CONNECT_URL = 'https://www.sandbox.paypal.com/connect';
const USERINFO_PATH = '/v1/identity/openidconnect/userinfo?schema=openid';

export function authorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    flowEntry: 'static',
    client_id: input.clientId,
    scope: 'openid email',
    redirect_uri: input.redirectUri,
    response_type: 'code',
    state: input.state,
    fullPage: 'true',
  });
  return `${SANDBOX_CONNECT_URL}?${q}`;
}

const TokenResponse = z.object({ access_token: z.string() });

// PayPal sends booleans as true/"true" depending on the field; anything else counts as not stated.
const loose = z.union([z.boolean(), z.string()]).transform((v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined));
const Profile = z.object({
  user_id: z.string().optional(),
  sub: z.string().optional(),
  email: z.string().optional(),
  email_verified: loose.optional(),
});
export type PayPalProfile = z.infer<typeof Profile>;

interface Deps {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}

async function json(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return text;
  }
}

export async function loginWithCode(code: string, redirectUri: string, deps: Deps): Promise<PayPalProfile> {
  const f = deps.fetch ?? fetch;
  const basic = Buffer.from(`${deps.clientId}:${deps.clientSecret}`).toString('base64');
  const tokenRes = await f(`${PAYPAL_SANDBOX_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    // redirect_uri is not in PayPal's documented request; sending only what the docs show.
    body: new URLSearchParams({ grant_type: 'authorization_code', code }).toString(),
  });
  const tokenBody = await json(tokenRes);
  if (!tokenRes.ok) throw toPayPalApiError(tokenRes.status, tokenBody, tokenRes.headers.get('paypal-debug-id'));
  const { access_token } = TokenResponse.parse(tokenBody);

  const infoRes = await f(`${PAYPAL_SANDBOX_BASE_URL}${USERINFO_PATH}`, {
    headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' },
  });
  const infoBody = await json(infoRes);
  if (!infoRes.ok) throw toPayPalApiError(infoRes.status, infoBody, infoRes.headers.get('paypal-debug-id'));
  return Profile.parse(infoBody);
}

// TREASURER_ALLOWLIST is a comma-separated list of PayPal user ids and/or emails. Empty list = nobody can log in.
// An email only counts when PayPal says it is verified; a user id always counts (and is the safer entry).
export function isAllowed(profile: PayPalProfile, allowlist: string | undefined): boolean {
  const entries = (allowlist ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (entries.length === 0) return false;
  const ids = [profile.user_id, profile.sub].filter((v): v is string => Boolean(v)).map((v) => v.toLowerCase());
  const email = profile.email_verified === true ? profile.email?.toLowerCase() : undefined;
  return [...ids, ...(email ? [email] : [])].some((v) => entries.includes(v));
}
