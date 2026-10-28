import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { requireTreasurer } from '../auth/treasurer.js';
import { isAllowed } from '../auth/paypalLogin.js';
import { sign } from '../auth/session.js';
import { authRouter } from './auth.js';

const SECRET = 's'.repeat(40);
const env = {
  SESSION_SECRET: SECRET,
  APP_BASE_URL: 'https://qm.example.com',
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
  app.get('/api/secret', requireTreasurer(e), (_req, res) => void res.json({ ok: true }));
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
    expect(url.searchParams.get('redirect_uri')).toBe('https://qm.example.com/api/auth/paypal/callback');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(state.length).toBeGreaterThan(10);
  });

  it('gives an allowlisted account a session that the treasurer guard accepts', async () => {
    const { app, calls } = build();
    const { state, stateCookie } = await startLogin(app);
    const cb = await request(app).get(`/api/auth/paypal/callback?code=abc&state=${state}`).set('Cookie', stateCookie);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('https://qm.example.com/?login=ok');
    expect(calls).toEqual(['/v1/oauth2/token', '/v1/identity/openidconnect/userinfo']);
    const session = cookieOf(cb, 'qm_session')!;
    expect((cb.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/HttpOnly.*SameSite=Lax.*Secure/);

    expect((await request(app).get('/api/secret')).status).toBe(401);
    expect((await request(app).get('/api/secret').set('Cookie', session)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', session)).body).toEqual({ email: 'treasurer@example.com', demo: false });
  });

  it('refuses a PayPal account that is not on the allowlist, without giving it a session', async () => {
    const { app } = build(env, { user_id: 'OTHER', email: 'stranger@example.com', email_verified: true });
    const { state, stateCookie } = await startLogin(app);
    const cb = await request(app).get(`/api/auth/paypal/callback?code=abc&state=${state}`).set('Cookie', stateCookie);
    expect(cb.headers.location).toBe('https://qm.example.com/?login=denied');
    expect(cookieOf(cb, 'qm_session')).toBeUndefined();
  });

  it('refuses a callback whose state does not match, or that has no state cookie, before calling PayPal', async () => {
    const { app, fetch } = build();
    const { stateCookie } = await startLogin(app);
    const wrong = await request(app).get('/api/auth/paypal/callback?code=abc&state=forged').set('Cookie', stateCookie);
    const none = await request(app).get('/api/auth/paypal/callback?code=abc&state=forged');
    expect(wrong.headers.location).toBe('https://qm.example.com/?login=error');
    expect(none.headers.location).toBe('https://qm.example.com/?login=error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('redirects to an error when PayPal rejects the code', async () => {
    const { app, fetch } = build();
    fetch.mockResolvedValueOnce(json(400, { error: 'invalid_grant', error_description: 'bad code' }));
    const { state, stateCookie } = await startLogin(app);
    const cb = await request(app).get(`/api/auth/paypal/callback?code=abc&state=${state}`).set('Cookie', stateCookie);
    expect(cb.headers.location).toBe('https://qm.example.com/?login=error');
  });

  it('rejects a tampered, foreign-signed or expired session cookie; the ops token works only while it is set', async () => {
    const { app } = build({ ...env, TREASURER_TOKEN: 'letmein' });
    const good = `qm_session=${sign({ sub: 'x' }, SECRET, 60)}`;
    expect((await request(app).get('/api/secret').set('Cookie', good)).status).toBe(200);
    expect((await request(app).get('/api/secret').set('Cookie', good.slice(0, -2) + 'xx')).status).toBe(401);
    expect((await request(app).get('/api/secret').set('Cookie', `qm_session=${sign({ sub: 'x' }, 'z'.repeat(40), 60)}`)).status).toBe(401);
    expect((await request(app).get('/api/secret').set('Cookie', `qm_session=${sign({ sub: 'x' }, SECRET, -1)}`)).status).toBe(401);
    expect((await request(app).get('/api/secret').set('x-treasurer-token', 'letmein')).status).toBe(200);
    // with no TREASURER_TOKEN configured the header means nothing
    expect((await request(build().app).get('/api/secret').set('x-treasurer-token', 'letmein')).status).toBe(401);
  });

  it('keeps demo login off unless DEMO_LOGIN=true, and answers 503 when login is not configured', async () => {
    expect((await request(build().app).post('/api/auth/demo-login')).status).toBe(404);
    const on = build({ ...env, DEMO_LOGIN: 'true' });
    const demo = await request(on.app).post('/api/auth/demo-login');
    expect(demo.status).toBe(200);
    expect((await request(on.app).get('/api/secret').set('Cookie', cookieOf(demo, 'qm_session')!)).status).toBe(200);
    expect((await request(build({ APP_BASE_URL: env.APP_BASE_URL, SESSION_SECRET: 'short' }).app).get('/api/auth/paypal/login')).status).toBe(503);
    expect((await request(build({}).app).get('/api/secret')).status).toBe(503);
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
    expect(isAllowed({ email: 'a@x.com' }, 'a@x.com')).toBe(true);
    expect(isAllowed({ email: 'a@x.com', email_verified: false }, 'a@x.com')).toBe(false);
    expect(isAllowed({ user_id: 'abc', email: 'a@x.com' }, '')).toBe(false);
    expect(isAllowed({}, 'a@x.com')).toBe(false);
  });
});
