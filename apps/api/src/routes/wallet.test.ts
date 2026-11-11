import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { sign } from '../auth/session.js';
import { createExecutor } from '../payments/executor.js';
import { createMemoryApprovals, createMemoryAudit, createMemoryReferences, createMemoryWalletStore } from '../payments/memory.js';
import { stubCheck } from '../payments/stub-check.js';
import { createPayPalClient } from '../paypal/client.js';
import { walletRouter } from './wallet.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const env = { TREASURER_TOKEN: 'letmein', APP_BASE_URL: 'https://leonid.example.com' };
const treasurer = { 'x-treasurer-token': 'letmein' };

function build(routes: Record<string, () => Response> = {}, envOverride: NodeJS.ProcessEnv = env) {
  const calls: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/oauth2/token') return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
    const key = `${init?.method} ${path}`;
    calls.push(key);
    const route = Object.entries(routes).find(([k]) => key === k);
    if (!route) throw new Error(`unexpected PayPal call: ${key}`);
    return route[1]();
  });
  const client = createPayPalClient({ app: 'procurement', clientId: 'i', clientSecret: 's', fetch });
  const wallet = createMemoryWalletStore();
  const approvals = createMemoryApprovals();
  const audit = createMemoryAudit();
  const executor = createExecutor({
    client,
    check: stubCheck,
    audit,
    wallet,
    approvals,
    references: createMemoryReferences(),
  });
  const app = express();
  app.use('/api/wallet', walletRouter({ env: envOverride, payments: () => ({ client, wallet, executor, approvals }) }));
  return { app, calls, fetch, wallet, audit };
}

const setupToken = () =>
  json(201, { id: 'ST1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/agreements/approve?approval_session_id=ST1' }] });
const paymentToken = () => json(201, { id: 'pt_1', customer: { id: 'c1' }, payment_source: { paypal: { email_address: 'payer@example.com' } } });

describe('treasurer guard', () => {
  it('rejects a missing or wrong token, and fails closed when none is configured', async () => {
    const { app } = build();
    expect((await request(app).get('/api/wallet')).status).toBe(401);
    expect((await request(app).get('/api/wallet').set('x-treasurer-token', 'nope')).status).toBe(401);
    expect((await request(app).post('/api/wallet/revoke')).status).toBe(401);
    expect((await request(app).post('/api/wallet/connect')).status).toBe(401);
    const unconfigured = build({}, { APP_BASE_URL: 'https://leonid.example.com' });
    expect((await request(unconfigured.app).get('/api/wallet').set(treasurer)).status).toBe(503);
  });
});

describe('connecting the wallet', () => {
  it('starts a setup and sends PayPal our return urls', async () => {
    const { app, fetch } = build({ 'POST /v3/vault/setup-tokens': setupToken });
    const res = await request(app).post('/api/wallet/connect').set(treasurer);
    expect(res.status).toBe(200);
    expect(res.body.approveUrl).toContain('agreements/approve');
    const body = JSON.parse(String(fetch.mock.calls.find(([u]) => String(u).includes('setup-tokens'))![1]!.body));
    expect(body.payment_source.paypal.experience_context).toEqual({
      return_url: 'https://leonid.example.com/api/wallet/return',
      cancel_url: 'https://leonid.example.com/api/wallet/cancel',
    });
  });

  it('activates the wallet after the payer approved, and redirects to a fixed address', async () => {
    const { app } = build({ 'POST /v3/vault/setup-tokens': setupToken, 'POST /v3/vault/payment-tokens': paymentToken });
    await request(app).post('/api/wallet/connect').set(treasurer);
    const res = await request(app).get('/api/wallet/return?approval_session_id=ST1');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://leonid.example.com/?wallet=connected');
    expect((await request(app).get('/api/wallet').set(treasurer)).body).toEqual({ status: 'active', payerEmail: 'payer@example.com' });
  });

  it('accepts a setup token only once, and only if we created it', async () => {
    const { app, calls } = build({ 'POST /v3/vault/setup-tokens': setupToken, 'POST /v3/vault/payment-tokens': paymentToken });
    const stranger = await request(app).get('/api/wallet/return?approval_session_id=NOT-OURS');
    expect(stranger.headers.location).toBe('https://leonid.example.com/?wallet=error');
    expect(calls).not.toContain('POST /v3/vault/payment-tokens');
    await request(app).post('/api/wallet/connect').set(treasurer);
    await request(app).get('/api/wallet/return?approval_session_id=ST1');
    const replay = await request(app).get('/api/wallet/return?approval_session_id=ST1');
    expect(replay.headers.location).toBe('https://leonid.example.com/?wallet=error');
    expect(calls.filter((c) => c === 'POST /v3/vault/payment-tokens')).toHaveLength(1);
  });

  it('reports an error redirect when the payer never approved', async () => {
    const { app, wallet } = build({
      'POST /v3/vault/setup-tokens': setupToken,
      'POST /v3/vault/payment-tokens': () => json(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'PAYER_ACTION_REQUIRED' }] }),
    });
    await request(app).post('/api/wallet/connect').set(treasurer);
    const res = await request(app).get('/api/wallet/return?approval_session_id=ST1');
    expect(res.headers.location).toBe('https://leonid.example.com/?wallet=error');
    expect((await wallet.snapshot()).status).toBe('none');
  });

  it('refuses to connect over a live wallet', async () => {
    const { app, calls } = build({ 'POST /v3/vault/setup-tokens': setupToken, 'POST /v3/vault/payment-tokens': paymentToken });
    await request(app).post('/api/wallet/connect').set(treasurer);
    await request(app).get('/api/wallet/return?approval_session_id=ST1');
    const res = await request(app).post('/api/wallet/connect').set(treasurer);
    expect(res.status).toBe(409);
    expect(calls.filter((c) => c === 'POST /v3/vault/setup-tokens')).toHaveLength(1);
  });

  it('deletes a token it just created if another wallet became active in the meantime', async () => {
    const { app, calls, wallet } = build({
      'POST /v3/vault/setup-tokens': setupToken,
      'POST /v3/vault/payment-tokens': () => json(201, { id: 'pt_new', customer: { id: 'c2' } }),
      'DELETE /v3/vault/payment-tokens/pt_new': () => new Response(null, { status: 204 }),
    });
    await request(app).post('/api/wallet/connect').set(treasurer);
    await wallet.activate({ paymentTokenId: 'pt_existing' }); // a second approval raced in
    const res = await request(app).get('/api/wallet/return?approval_session_id=ST1');
    expect(res.headers.location).toBe('https://leonid.example.com/?wallet=error');
    expect(calls).toContain('DELETE /v3/vault/payment-tokens/pt_new');
    expect((await wallet.snapshot()).status).toBe('active'); // the existing wallet is untouched
  });

  it('keeps a surplus token on the pending list if its cleanup fails, and the kill switch deletes it later', async () => {
    let attempts = 0;
    const { app, calls, wallet } = build({
      'POST /v3/vault/setup-tokens': setupToken,
      'POST /v3/vault/payment-tokens': () => json(201, { id: 'pt_new' }),
      'DELETE /v3/vault/payment-tokens/pt_new': () => (++attempts === 1 ? json(500, { name: 'INTERNAL_SERVER_ERROR' }) : new Response(null, { status: 204 })),
      'DELETE /v3/vault/payment-tokens/pt_existing': () => new Response(null, { status: 204 }),
    });
    await request(app).post('/api/wallet/connect').set(treasurer);
    await wallet.activate({ paymentTokenId: 'pt_existing' });
    await request(app).get('/api/wallet/return?approval_session_id=ST1');
    expect(await wallet.pendingDeletions()).toEqual(['pt_new']); // cleanup failed, nothing lost
    expect((await request(app).post('/api/wallet/revoke').set(treasurer)).body).toEqual({ revoked: true });
    expect(await wallet.pendingDeletions()).toEqual([]);
    expect(calls.filter((c) => c === 'DELETE /v3/vault/payment-tokens/pt_new')).toHaveLength(2);
  });

  it('sends a cancelled approval back to the app', async () => {
    const { app } = build();
    const res = await request(app).get('/api/wallet/cancel');
    expect(res.headers.location).toBe('https://leonid.example.com/?wallet=cancelled');
  });
});

describe('kill switch', () => {
  it('deletes the token at PayPal and the wallet shows as revoked', async () => {
    const { app, calls } = build({
      'POST /v3/vault/setup-tokens': setupToken,
      'POST /v3/vault/payment-tokens': paymentToken,
      'DELETE /v3/vault/payment-tokens/pt_1': () => new Response(null, { status: 204 }),
    });
    await request(app).post('/api/wallet/connect').set(treasurer);
    await request(app).get('/api/wallet/return?approval_session_id=ST1');
    const res = await request(app).post('/api/wallet/revoke').set(treasurer);
    expect(res.body).toEqual({ revoked: true });
    expect(calls).toContain('DELETE /v3/vault/payment-tokens/pt_1');
    expect((await request(app).get('/api/wallet').set(treasurer)).body).toEqual({ status: 'revoked' });
    expect((await request(app).post('/api/wallet/revoke').set(treasurer)).body).toEqual({ revoked: false });
  });

  it('works with a Log in with PayPal session from our own page, and audits that treasurer as the actor', async () => {
    const SECRET = 's'.repeat(40);
    const { app, audit, calls, wallet } = build(
      { 'DELETE /v3/vault/payment-tokens/pt_1': () => new Response(null, { status: 204 }) },
      { ...env, SESSION_SECRET: SECRET },
    );
    await wallet.activate({ paymentTokenId: 'pt_1' });
    const cookie = `leonid_session=${sign('session', { sub: 'USERID123', via: 'paypal' }, SECRET, 60)}`;
    expect((await request(app).post('/api/wallet/revoke').set('Cookie', cookie).set('Origin', 'https://evil.example')).status).toBe(403);
    expect(calls).toEqual([]); // refused before PayPal was asked anything

    const res = await request(app).post('/api/wallet/revoke').set('Cookie', cookie).set('Origin', 'https://leonid.example.com');
    expect(res.body).toEqual({ revoked: true });
    expect(calls).toEqual(['DELETE /v3/vault/payment-tokens/pt_1']);
    expect(audit.rows.find((r) => r.action === 'wallet.revoke')).toMatchObject({ actor: 'treasurer:paypal:USERID123' });
  });

  it('answers 502 if PayPal fails, while the wallet stays revoked on our side', async () => {
    const { app } = build({
      'POST /v3/vault/setup-tokens': setupToken,
      'POST /v3/vault/payment-tokens': paymentToken,
      'DELETE /v3/vault/payment-tokens/pt_1': () => json(500, { name: 'INTERNAL_SERVER_ERROR' }),
    });
    await request(app).post('/api/wallet/connect').set(treasurer);
    await request(app).get('/api/wallet/return?approval_session_id=ST1');
    expect((await request(app).post('/api/wallet/revoke').set(treasurer)).status).toBe(502);
    expect((await request(app).get('/api/wallet').set(treasurer)).body).toEqual({ status: 'revoked' });
  });
});

describe('configuration', () => {
  it('answers 503 when APP_BASE_URL or the PayPal app is missing', async () => {
    const noBase = build({}, { TREASURER_TOKEN: 'letmein' });
    expect((await request(noBase.app).get('/api/wallet').set(treasurer)).status).toBe(503);
    const app = express();
    app.use(
      '/api/wallet',
      walletRouter({
        env,
        payments: () => {
          throw new Error('not configured');
        },
      }),
    );
    expect((await request(app).get('/api/wallet').set(treasurer)).status).toBe(503);
  });
});
