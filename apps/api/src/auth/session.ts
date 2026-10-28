import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

// Stateless signed cookie: base64url(JSON payload) + '.' + HMAC-SHA256. No session table and no cookie library.
// ponytail: a session cannot be revoked before it expires (8 hours); add a sessions table if logout must be server-side.

export const SESSION_COOKIE = 'qm_session';
export const STATE_COOKIE = 'qm_oauth_state';
export const SESSION_TTL_S = 8 * 60 * 60;
export const STATE_TTL_S = 10 * 60;

export interface Session {
  sub: string; // PayPal user_id, or 'demo'
  email?: string;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const mac = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');

export function sign(payload: object, secret: string, ttlS: number, now = Date.now()): string {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlS }));
  return `${body}.${mac(body, secret)}`;
}

// Returns the payload only for an untampered, unexpired value.
export function verify<T extends object>(value: string | undefined, secret: string, now = Date.now()): T | null {
  const [body, tag, extra] = (value ?? '').split('.');
  if (!body || !tag || extra !== undefined) return null;
  const expected = Buffer.from(mac(body, secret));
  const got = Buffer.from(tag);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp?: unknown };
    return typeof parsed.exp === 'number' && parsed.exp > now / 1000 ? parsed : null;
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
  return verify<Session>(readCookie(req, SESSION_COOKIE), secret);
}

// Lax, not Strict: the browser comes back from PayPal on a cross-site redirect and must still send the state cookie.
export function setCookie(res: Response, name: string, value: string, maxAgeS: number, secure: boolean): void {
  res.append('Set-Cookie', `${name}=${value}; Max-Age=${maxAgeS}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
}

export function clearCookie(res: Response, name: string, secure: boolean): void {
  setCookie(res, name, '', 0, secure);
}
