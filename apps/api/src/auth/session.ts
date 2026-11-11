import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

// Stateless signed cookie: base64url(JSON payload) + '.' + HMAC-SHA256. No session table and no cookie library.
// ponytail: a session cannot be revoked before it expires (8 hours); add a sessions table if logout must be server-side.

export const SESSION_COOKIE = 'leonid_session';
export const STATE_COOKIE = 'leonid_oauth_state';
export const SESSION_TTL_S = 8 * 60 * 60;
export const STATE_TTL_S = 10 * 60;

export const MIN_SECRET_LENGTH = 32;

export interface Session {
  sub: string; // PayPal user_id, or a random id per demo login
  via: 'paypal' | 'demo'; // how the session was obtained; goes into the audit actor
  email?: string;
}

// A secret shorter than MIN_SECRET_LENGTH is treated as unset, so a weak value fails closed (503) instead of signing.
export function sessionSecret(env: NodeJS.ProcessEnv): string | undefined {
  const secret = env.SESSION_SECRET;
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : undefined;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const mac = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');

// Every cookie carries a type, and verify() demands it: the unauthenticated /login hands out validly signed
// 'state' cookies, which must never be accepted as a 'session'.
export type CookieType = 'session' | 'state';

export function sign(typ: CookieType, payload: object, secret: string, ttlS: number, now = Date.now()): string {
  const body = b64(JSON.stringify({ ...payload, typ, exp: Math.floor(now / 1000) + ttlS }));
  return `${body}.${mac(body, secret)}`;
}

// Returns the payload only for an untampered, unexpired value.
export function verify<T extends object>(typ: CookieType, value: string | undefined, secret: string, now = Date.now()): T | null {
  const [body, tag, extra] = (value ?? '').split('.');
  if (!body || !tag || extra !== undefined) return null;
  const expected = Buffer.from(mac(body, secret));
  const got = Buffer.from(tag);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp?: unknown; typ?: unknown };
    return parsed.typ === typ && typeof parsed.exp === 'number' && parsed.exp > now / 1000 ? parsed : null;
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

export function readSession(req: Request, secret: string): Session | null {
  const session = verify<Session>('session', readCookie(req, SESSION_COOKIE), secret);
  if (!session || typeof session.sub !== 'string' || !session.sub) return null;
  return session.via === 'paypal' || session.via === 'demo' ? session : null;
}

// Lax, not Strict: the browser comes back from PayPal on a cross-site redirect and must still send the state cookie.
export function setCookie(res: Response, name: string, value: string, maxAgeS: number, secure: boolean): void {
  res.append('Set-Cookie', `${name}=${value}; Max-Age=${maxAgeS}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
}

export function clearCookie(res: Response, name: string, secure: boolean): void {
  setCookie(res, name, '', 0, secure);
}
