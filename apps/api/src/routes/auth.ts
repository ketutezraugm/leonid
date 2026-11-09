import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { SessionInfo } from '@leonid/shared';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { isAllowed, authorizeUrl, loginWithCode, type PayPalProfile } from '../auth/paypalLogin.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_S,
  STATE_COOKIE,
  STATE_TTL_S,
  clearCookie,
  readCookie,
  readSession,
  sessionSecret,
  setCookie,
  sign,
  verify,
} from '../auth/session.js';
import { createRateLimiter, type RateLimiter } from './rateLimit.js';

export interface AuthRouterOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  demoLimiter?: RateLimiter;
}

// Log in with PayPal for the treasurer (F1):
//   GET  /paypal/login     sends the browser to PayPal
//   GET  /paypal/callback  PayPal sends it back with ?code&state; only TREASURER_ALLOWLIST members get a session
//   GET  /me               { email?, via: 'paypal' | 'demo' } or 401
//   POST /logout
//   POST /demo-login       only when demoLoginEnabled(): a session for the hosted demo, for judges without PayPal access
// Every redirect target is fixed (APP_BASE_URL), never taken from the request.
export function authRouter(options: AuthRouterOptions = {}) {
  const env = options.env ?? process.env;
  const router = Router();
  const demoLogin = demoLoginEnabled(env);
  const demoLimiter = options.demoLimiter ?? createRateLimiter({ max: 20, windowMs: 10 * 60_000 });

  const handle =
    (fn: (req: Request, res: Response, c: { base: string; secret: string; secure: boolean }) => Promise<void> | void): RequestHandler =>
    async (req, res) => {
      const base = env.APP_BASE_URL?.replace(/\/$/, '');
      const secret = sessionSecret(env);
      if (!base || !secret) {
        res.status(503).json({ error: 'login is not configured' });
        return;
      }
      try {
        await fn(req, res, { base, secret, secure: base.startsWith('https://') });
      } catch (err) {
        console.error('login failed', err);
        res.redirect(`${base}/?login=error`);
      }
    };

  router.get(
    '/paypal/login',
    handle((_req, res, { base, secret, secure }) => {
      const clientId = env.PAYPAL_TREASURY_CLIENT_ID;
      if (!clientId) {
        res.status(503).json({ error: 'PayPal Treasury app is not configured' });
        return;
      }
      const state = randomBytes(16).toString('base64url');
      setCookie(res, STATE_COOKIE, sign('state', { state }, secret, STATE_TTL_S), STATE_TTL_S, secure);
      res.redirect(authorizeUrl({ clientId, redirectUri: `${base}/api/auth/paypal/callback`, state }));
    }),
  );

  router.get(
    '/paypal/callback',
    handle(async (req, res, { base, secret, secure }) => {
      const saved = verify<{ state: string }>('state', readCookie(req, STATE_COOKIE), secret);
      clearCookie(res, STATE_COOKIE, secure); // one attempt per state
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const sameState = saved && state.length === saved.state.length && timingSafeEqual(Buffer.from(state), Buffer.from(saved.state));
      if (!sameState || !code) {
        res.redirect(`${base}/?login=error`);
        return;
      }
      const clientId = env.PAYPAL_TREASURY_CLIENT_ID;
      const clientSecret = env.PAYPAL_TREASURY_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        res.redirect(`${base}/?login=error`);
        return;
      }
      const profile: PayPalProfile = await loginWithCode(code, { clientId, clientSecret, fetch: options.fetch });
      if (!isAllowed(profile, env.TREASURER_ALLOWLIST)) {
        // Sandbox only: the PayPal id is what to copy into TREASURER_ALLOWLIST (an id always matches; an email needs PayPal's verified flag).
        console.warn(
          `login refused: not on TREASURER_ALLOWLIST (user_id=${profile.user_id ?? '-'} sub=${profile.sub ?? '-'} email_present=${Boolean(profile.email)} email_verified=${profile.email_verified ?? 'not stated'})`,
        );
        res.redirect(`${base}/?login=denied`);
        return;
      }
      // The id owns this treasurer's events, so a profile without one is refused rather than given a shared fallback.
      const sub = profile.user_id ?? profile.sub ?? profile.email;
      if (!sub) {
        console.warn('login refused: PayPal profile has no user id or email');
        res.redirect(`${base}/?login=error`);
        return;
      }
      setCookie(res, SESSION_COOKIE, sign('session', { sub, via: 'paypal', email: profile.email }, secret, SESSION_TTL_S), SESSION_TTL_S, secure);
      res.redirect(`${base}/?login=ok`);
    }),
  );

  router.get(
    '/me',
    handle((req, res, { secret }) => {
      const session = readSession(req, secret);
      if (!session) {
        res.status(401).json({ error: 'not logged in' });
        return;
      }
      const info: SessionInfo = { email: session.email, via: session.via };
      res.json(info);
    }),
  );

  router.post(
    '/logout',
    handle((_req, res, { secure }) => {
      clearCookie(res, SESSION_COOKIE, secure);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/demo-login',
    handle((req, res, { secret, secure }) => {
      if (!demoLogin) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      if (!demoLimiter.take(req)) {
        res.status(429).json({ error: 'Too many demo logins. Wait a few minutes and try again.' });
        return;
      }
      // Each demo visitor is their own owner, so one judge never sees another's events. Entering again while still
      // signed in keeps the same id, so the events made in this visit stay visible.
      const current = readSession(req, secret);
      const sub = current?.via === 'demo' ? current.sub : randomUUID();
      setCookie(res, SESSION_COOKIE, sign('session', { sub, via: 'demo' }, secret, SESSION_TTL_S), SESSION_TTL_S, secure);
      res.json({ ok: true, demo: true });
    }),
  );

  return router;
}

// Demo login hands anyone a treasurer session, so production needs a second, deliberate opt-in
// (DEMO_LOGIN_ALLOW_PRODUCTION=true, for the hosted judges' demo). Checked once, when the router is built at startup.
export function demoLoginEnabled(env: NodeJS.ProcessEnv): boolean {
  if (env.DEMO_LOGIN !== 'true') return false;
  if (env.NODE_ENV !== 'production') return true;
  if (env.DEMO_LOGIN_ALLOW_PRODUCTION !== 'true') {
    console.error('DEMO_LOGIN=true is ignored in production: set DEMO_LOGIN_ALLOW_PRODUCTION=true as well to really enable it');
    return false;
  }
  console.warn(
    '!!! DEMO_LOGIN is ON in production: POST /api/auth/demo-login gives ANYONE a treasurer session. Hosted demo only; turn it off afterwards. !!!',
  );
  return true;
}
