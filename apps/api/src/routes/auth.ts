import { randomBytes, timingSafeEqual } from 'node:crypto';
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
  setCookie,
  sign,
  verify,
} from '../auth/session.js';

export interface AuthRouterOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

// Log in with PayPal for the treasurer (F1):
//   GET  /paypal/login     sends the browser to PayPal
//   GET  /paypal/callback  PayPal sends it back with ?code&state; only TREASURER_ALLOWLIST members get a session
//   GET  /me               { email?, demo } or 401
//   POST /logout
//   POST /demo-login       only when DEMO_LOGIN=true: a session for the hosted demo, for judges without PayPal access
// Every redirect target is fixed (APP_BASE_URL), never taken from the request.
export function authRouter(options: AuthRouterOptions = {}) {
  const env = options.env ?? process.env;
  const router = Router();

  const handle =
    (fn: (req: Request, res: Response, c: { base: string; secret: string; secure: boolean }) => Promise<void> | void): RequestHandler =>
    async (req, res) => {
      const base = env.APP_BASE_URL?.replace(/\/$/, '');
      const secret = env.SESSION_SECRET;
      if (!base || !secret || secret.length < 32) {
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
      setCookie(res, STATE_COOKIE, sign({ state }, secret, STATE_TTL_S), STATE_TTL_S, secure);
      res.redirect(authorizeUrl({ clientId, redirectUri: `${base}/api/auth/paypal/callback`, state }));
    }),
  );

  router.get(
    '/paypal/callback',
    handle(async (req, res, { base, secret, secure }) => {
      const saved = verify<{ state: string }>(readCookie(req, STATE_COOKIE), secret);
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
      const profile: PayPalProfile = await loginWithCode(code, `${base}/api/auth/paypal/callback`, { clientId, clientSecret, fetch: options.fetch });
      if (!isAllowed(profile, env.TREASURER_ALLOWLIST)) {
        console.warn('login refused: PayPal account is not on TREASURER_ALLOWLIST');
        res.redirect(`${base}/?login=denied`);
        return;
      }
      const sub = profile.user_id ?? profile.sub ?? profile.email ?? 'paypal';
      setCookie(res, SESSION_COOKIE, sign({ sub, email: profile.email }, secret, SESSION_TTL_S), SESSION_TTL_S, secure);
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
      res.json({ email: session.email, demo: session.sub === 'demo' });
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
    handle((_req, res, { secret, secure }) => {
      if (env.DEMO_LOGIN !== 'true') {
        res.status(404).json({ error: 'not found' });
        return;
      }
      setCookie(res, SESSION_COOKIE, sign({ sub: 'demo' }, secret, SESSION_TTL_S), SESSION_TTL_S, secure);
      res.json({ ok: true, demo: true });
    }),
  );

  return router;
}
