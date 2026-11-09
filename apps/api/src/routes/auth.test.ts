import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { isAllowed } from '../auth/paypalLogin.js';
import { sign, verify, type Session } from '../auth/session.js';
import { authRouter, demoLoginEnabled } from './auth.js';
import { createRateLimiter } from './rateLimit.js';

const SECRET = 's'.repeat(40);
const env = {
  SESSION_SECRET: SECRET,
  APP_BASE_URL: 'https://leonid.example.com',
  PAYPAL_TREASURY_CLIENT_ID: 'cid',
  PAYPAL_TREASURY_CLIENT_SECRET: 'csecret',
  TREASURER_ALLOWLIST: 'Treasurer@Example.com, USERID123',
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function build(e: NodeJS.ProcessEnv = env, profile: unknown = { user_id: 'USERID999', email: 'treasurer@example.com', email_verified: 'true' }) {
  const calls: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === '/v1/oauth2/token') return json(200, { access_token: 'user-token', token_type: 'Bearer' });
    if (path === '/v1/identity/openidconnect/userinfo') return json(200, profile);
    throw new Error(`unexpected PayPal call ${path}`);
  });
  const app = express();
  app.use('/api/auth', authRouter({ env: e, fetch }));
  const guard = requireTreasurer(e);
  app.get('/api/secret', guard, (_req, res) => void res.json({ actor: treasurerActor(res) }));
  app.post('/api/secret', guard, (_req, res) => void res.json({ actor: treasurerActor(res) }));
  return { app, calls, fetch };
}

const cookieOf = (res: request.Response, name: string) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)?.map((c) => c.split(';')[0]).find((c) => c?.startsWith(`${name}=`));

// Runs /login and returns the state PayPal would send back plus the cookie that proves we started it.
async function startLogin(app: express.Express) {
  const res = await request(app).get('/api/auth/paypal/login');
  const url = new URL(res.headers.location!);
  return { res, url, state: url.searchParams.get('state')!, stateCookie: cookieOf(res, 'qm_oauth_state')! };
}

describe('Log in with PayPal', () => {
  it('sends the browser to PayPal with our client id, a fixed return url and a state', async () => {
    const { res, url, state } = await startLogin(build().app);
    expect(res.status).toBe(302);
    expect(url.origin + url.pathname).toBe('https://www.sandbox.paypal.com/connect');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://leonid.example.com/api/auth/paypal/callback');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(state.length).toBeGreaterThan(10);
  });

  it('gives an allowlisted account a session that the treasurer guard accepts', async () => {
    const { app, calls } = build();
    const { state, stateCookie } = await startLogin(app);
    const cb = await request(app).get(`/api/auth/paypal/callback?code=abc&state=${state}`).set('Cookie', stateCookie);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('https://leonid.example.com/?login=ok');
    expect(calls).toEqual(['/v1/oauth2/token', '/v1/identity/openidconnect/userinfo']);
    const session = cookieOf(cb, 'qm_session')!;
    expect((cb.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/HttpOnly.*SameSite=Lax.*Secure/);

    expect((await request(app).get('/api/secret')).status).toBe(401);
    expect((await request(app).get('/api/secret').set('Cookie', session)).body).toEqual({ actor: 'treasurer:paypal:USERID999' });
    expect((await request(app).get('/api/auth/me').set('Cookie', session)).body).toEqual({ email: 'treasurer@example.com', via: 'paypal' });
  });

  it('refuses a PayPal account that is not on the allowlist, without giving it a session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = build(env, { user_id: 'OTHER', email: 'stranger@example.com', email_verified: true });
    const { state, stateCookie } = await startLogin(app);
    const cb = await request(app).get(`/api/auth/paypal/callback?code=abc&state=${state}`).set('Cookie', stateCookie);
    expect(cb.headers.location).toBe('https://leonid.example.com/?login=denied');
    expect(cookieOf(cb, 'qm_session')).toBeUndefined();
    // the log names the PayPal id to copy into the allowlist, and never the email or a token
    const line = String(warn.mock.calls.at(-1)?.[0]);
    expect(line).toContain('user_id=OTHER');
    expect(line).toContain('email_verified=true');
    expect(line).not.toContain('stranger@example.com');
    warn.mockRestore();
  });

  it('refuses a callback whose state does not match, or that has no state cookie, before calling PayPal', async () => {
    const { app, fetch } = build();
    const { stateCookie } = await startLogin(app);
    const wrong = await request(app).get('/api/auth/paypal/callback?code=abc&state=forged').set('Cookie', stateCookie);
    const none = await request(app).get('/api/auth/paypal/callback?code=abc&state=forged');
    expect(wrong.headers.location).toBe('https://leonid.example.com/?login=error');
    expect(none.headers.location).toBe('https://leonid.example.com/?login=error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('redirects to an error when PayPal rejects the code', async () => {
    const { app, fetch } = build();
    fetch.mockResolvedValueOnce(json(400, { error: 'invalid_grant', error_description: 'bad code' }));
    const { state, stateCookie } = await startLogin(app);
    const cb = await request(app).get(`/api/auth/paypal/callback?code=abc&state=${state}`).set('Cookie', stateCookie);
    expect(cb.headers.location).toBe('https://leonid.example.com/?login=error');
  });

  it('rejects a tampered, foreign-signed or expired session cookie; the ops token works only while it is set', async () => {
    const { app } = build({ ...env, TREASURER_TOKEN: 'letmein' });
    const good = `qm_session=${sign('session', { sub: 'x', via: 'paypal' }, SECRET, 60)}`;
    expect((await request(app).get('/api/secret').set('Cookie', good)).status).toBe(200);
    expect((await request(app).get('/api/secret').set('Cookie', good.slice(0, -2) + 'xx')).status).toBe(401);
    expect((await request(app).get('/api/secret').set('Cookie', `qm_session=${sign('session', { sub: 'x', via: 'paypal' }, 'z'.repeat(40), 60)}`)).status).toBe(401);
    expect((await request(app).get('/api/secret').set('Cookie', `qm_session=${sign('session', { sub: 'x', via: 'paypal' }, SECRET, -1)}`)).status).toBe(401);
    expect((await request(app).get('/api/secret').set('x-treasurer-token', 'letmein')).body).toEqual({ actor: 'treasurer:ops-token' });
    // a session without a known `via` is not a session
    expect((await request(app).get('/api/secret').set('Cookie', `qm_session=${sign('session', { sub: 'x' }, SECRET, 60)}`)).status).toBe(401);
    // with no TREASURER_TOKEN configured the header means nothing
    expect((await request(build().app).get('/api/secret').set('x-treasurer-token', 'letmein')).status).toBe(401);
  });

  it('does not accept the state cookie that /login hands to anyone as a session', async () => {
    const { app } = build();
    const { stateCookie } = await startLogin(app);
    const asSession = stateCookie.replace('qm_oauth_state=', 'qm_session=');
    expect((await request(app).get('/api/secret').set('Cookie', asSession)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', asSession)).status).toBe(401);
    // and a session is not accepted as a state
    const sessionAsState = `qm_oauth_state=${sign('session', { state: 'forged' }, SECRET, 60)}`;
    const cb = await request(app).get('/api/auth/paypal/callback?code=abc&state=forged').set('Cookie', sessionAsState);
    expect(cb.headers.location).toBe('https://leonid.example.com/?login=error');
  });

  it('keeps demo login off unless DEMO_LOGIN=true, and answers 503 when login is not configured', async () => {
    expect((await request(build().app).post('/api/auth/demo-login')).status).toBe(404);
    const on = build({ ...env, DEMO_LOGIN: 'true' });
    const demo = await request(on.app).post('/api/auth/demo-login');
    expect(demo.status).toBe(200);
    const demoSession = cookieOf(demo, 'qm_session')!;
    expect((await request(on.app).get('/api/secret').set('Cookie', demoSession)).body).toEqual({ actor: 'treasurer:demo' });
    expect((await request(on.app).get('/api/auth/me').set('Cookie', demoSession)).body).toEqual({ via: 'demo' });
    expect((await request(build({ APP_BASE_URL: env.APP_BASE_URL, SESSION_SECRET: 'short' }).app).get('/api/auth/paypal/login')).status).toBe(503);
    expect((await request(build({}).app).get('/api/secret')).status).toBe(503);
  });

  it('gives each demo visitor their own id, and keeps it when the same visitor enters again', async () => {
    const on = build({ ...env, DEMO_LOGIN: 'true' });
    const subOf = (cookie: string) => verify<Session>('session', cookie.split('=')[1], SECRET)?.sub;
    const first = cookieOf(await request(on.app).post('/api/auth/demo-login'), 'qm_session')!;
    const other = cookieOf(await request(on.app).post('/api/auth/demo-login'), 'qm_session')!;
    expect(subOf(first)).toMatch(/^[0-9a-f-]{36}$/);
    expect(subOf(other)).not.toBe(subOf(first));
    const again = cookieOf(await request(on.app).post('/api/auth/demo-login').set('Cookie', first), 'qm_session')!;
    expect(subOf(again)).toBe(subOf(first));
  });

  it('refuses demo login in production unless DEMO_LOGIN_ALLOW_PRODUCTION=true, and warns loudly when it is on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const prod = { ...env, NODE_ENV: 'production', DEMO_LOGIN: 'true' };
      expect((await request(build(prod).app).post('/api/auth/demo-login')).status).toBe(404);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('DEMO_LOGIN_ALLOW_PRODUCTION'));
      expect(warn).not.toHaveBeenCalled();

      const optedIn = build({ ...prod, DEMO_LOGIN_ALLOW_PRODUCTION: 'true' });
      expect((await request(optedIn.app).post('/api/auth/demo-login')).status).toBe(200);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('DEMO_LOGIN is ON in production'));

      // the second opt-in alone enables nothing
      expect(demoLoginEnabled({ NODE_ENV: 'production', DEMO_LOGIN_ALLOW_PRODUCTION: 'true' })).toBe(false);
      expect(demoLoginEnabled({ DEMO_LOGIN: 'true' })).toBe(true);
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it('rate limits demo login, and a disabled demo login (404) never uses up the allowance', async () => {
    const app = (e: NodeJS.ProcessEnv, max: number) => {
      const a = express();
      a.use('/api/auth', authRouter({ env: e, demoLimiter: createRateLimiter({ max, windowMs: 60_000 }) }));
      return a;
    };
    const off = app(env, 1);
    expect((await request(off).post('/api/auth/demo-login')).status).toBe(404);
    expect((await request(off).post('/api/auth/demo-login')).status).toBe(404);

    const on = app({ ...env, DEMO_LOGIN: 'true' }, 2);
    expect((await request(on).post('/api/auth/demo-login')).status).toBe(200);
    expect((await request(on).post('/api/auth/demo-login')).status).toBe(200);
    const blocked = await request(on).post('/api/auth/demo-login');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['set-cookie']).toBeUndefined();
  });

  it('treats a SESSION_SECRET shorter than 32 characters as unset', async () => {
    const short = 's'.repeat(31);
    const cookie = `qm_session=${sign('session', { sub: 'x', via: 'paypal' }, short, 60)}`;
    const app = build({ APP_BASE_URL: env.APP_BASE_URL, SESSION_SECRET: short }).app;
    expect((await request(app).get('/api/secret').set('Cookie', cookie)).status).toBe(503);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(503);
    // with the ops token configured the guard still runs, but the short-secret cookie is not accepted
    const withToken = build({ APP_BASE_URL: env.APP_BASE_URL, SESSION_SECRET: short, TREASURER_TOKEN: 'letmein' }).app;
    expect((await request(withToken).get('/api/secret').set('Cookie', cookie)).status).toBe(401);
  });

  it('logs out by clearing the cookie', async () => {
    const res = await request(build().app).post('/api/auth/logout');
    expect(res.headers['set-cookie']?.[0]).toMatch(/qm_session=; Max-Age=0/);
  });
});

describe('allowlist', () => {
  it('matches user id or email case-insensitively, ignores an unverified email, and is closed when empty', () => {
    expect(isAllowed({ user_id: 'abc' }, 'ABC')).toBe(true);
    expect(isAllowed({ email: 'A@x.com', email_verified: true }, 'a@x.com')).toBe(true);
    expect(isAllowed({ email: 'a@x.com' }, 'a@x.com')).toBe(false); // PayPal did not say the email is verified
    expect(isAllowed({ email: 'a@x.com', email_verified: false }, 'a@x.com')).toBe(false);
    expect(isAllowed({ user_id: 'abc', email: 'a@x.com' }, '')).toBe(false);
    expect(isAllowed({}, 'a@x.com')).toBe(false);
  });
});

describe('CSRF on cookie sessions', () => {
  const session = `qm_session=${sign('session', { sub: 'USERID123', via: 'paypal' }, SECRET, 60)}`;
  const app = build({ ...env, TREASURER_TOKEN: 'letmein' }).app;

  it('accepts a state-changing cookie request from our own origin (Origin, or Referer when Origin is absent)', async () => {
    const ok = await request(app).post('/api/secret').set('Cookie', session).set('Origin', 'https://leonid.example.com');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ actor: 'treasurer:paypal:USERID123' });
    expect((await request(app).post('/api/secret').set('Cookie', session).set('Referer', 'https://leonid.example.com/approvals')).status).toBe(200);
  });

  it('refuses a cookie POST from another origin, or with no Origin and no Referer', async () => {
    expect((await request(app).post('/api/secret').set('Cookie', session).set('Origin', 'https://evil.example')).status).toBe(403);
    expect((await request(app).post('/api/secret').set('Cookie', session).set('Origin', 'null')).status).toBe(403);
    expect((await request(app).post('/api/secret').set('Cookie', session).set('Referer', 'https://evil.example/leonid.example.com')).status).toBe(403);
    expect((await request(app).post('/api/secret').set('Cookie', session)).status).toBe(403);
  });

  it('fails closed when APP_BASE_URL is not set', async () => {
    const noBase = build({ SESSION_SECRET: SECRET }).app;
    expect((await request(noBase).post('/api/secret').set('Cookie', session).set('Origin', 'https://leonid.example.com')).status).toBe(403);
  });

  it('does not check Origin on GET, or on a request authenticated with the ops token header', async () => {
    expect((await request(app).get('/api/secret').set('Cookie', session)).status).toBe(200);
    const ops = await request(app).post('/api/secret').set('x-treasurer-token', 'letmein');
    expect(ops.status).toBe(200);
    expect(ops.body).toEqual({ actor: 'treasurer:ops-token' });
  });
});
