import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { agentWallet, auditLog, demoTokenPool } from '../db/schema.js';
import { createTestDb } from '../db/testing.js';
import { createDbAudit, createDbWalletStore } from '../payments/db.js';
import { createExecutor } from '../payments/executor.js';
import { createMemoryApprovals, createMemoryReferences } from '../payments/memory.js';
import { promoteNextStandby, poolCounts } from '../payments/pool.js';
import { stubCheck } from '../payments/stub-check.js';
import { createPayPalClient } from '../paypal/client.js';
import { walletPoolRouter } from './walletPool.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const env = { TREASURER_TOKEN: 'letmein', APP_BASE_URL: 'https://leonid.example.com' };
const treasurer = { 'x-treasurer-token': 'letmein' };

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

// A PayPal that hands out setup tokens ST-1, ST-2..., exchanges setup ST-n into payment token pt_ST-n, and deletes tokens
// unless `deleteStatus` says otherwise. `calls` records every request, in order.
function build() {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  let n = 0;
  let deleteStatus = 204;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/oauth2/token') return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    if (method === 'POST' && path === '/v3/vault/setup-tokens') {
      n += 1;
      return json(201, { id: `ST-${n}`, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/agreements/approve?approval_session_id=ST-${n}` }] });
    }
    if (method === 'POST' && path === '/v3/vault/payment-tokens') {
      const setup = (JSON.parse(String(init?.body)) as { payment_source: { token: { id: string } } }).payment_source.token.id;
      return json(201, { id: `pt_${setup}`, customer: { id: `c_${setup}` }, payment_source: { paypal: { email_address: 'payer@example.com' } } });
    }
    if (method === 'DELETE' && path.startsWith('/v3/vault/payment-tokens/')) {
      return deleteStatus === 204 ? new Response(null, { status: 204 }) : json(deleteStatus, { name: 'X', message: 'x' });
    }
    throw new Error(`unexpected PayPal call: ${method} ${path}`);
  });
  const client = createPayPalClient({ app: 'procurement', clientId: 'i', clientSecret: 's', fetch });
  const wallet = createDbWalletStore(db);
  const approvals = createMemoryApprovals();
  const executor = createExecutor({ client, check: stubCheck, audit: createDbAudit(db), wallet, approvals, references: createMemoryReferences() });
  const app = express();
  app.use(express.json());
  app.use('/api/wallet/pool', walletPoolRouter({ env, db: () => db, payments: () => ({ client, wallet, executor, approvals }) }));
  return { app, calls, bodies, wallet, setDeleteStatus: (s: number) => (deleteStatus = s) };
}

// Fills the pool with `count` links and approves them all (the payer's browser coming back to /return).
async function fillAndApprove(h: ReturnType<typeof build>, count: number) {
  await request(h.app).post('/api/wallet/pool/fill').set(treasurer).send({ count }).expect(200);
  for (let i = 1; i <= count; i += 1) {
    await request(h.app).get(`/api/wallet/pool/return?approval_session_id=ST-${i}`).expect(302);
  }
}

describe('the wallet pool', () => {
  it('is treasurer-only (except the PayPal return), and fails closed without APP_BASE_URL', async () => {
    const { app } = build();
    for (const [method, path] of [['get', ''], ['post', '/fill'], ['post', '/reset'], ['post', '/end']] as const) {
      expect((await request(app)[method](`/api/wallet/pool${path}`)).status).toBe(401);
    }
    const noBase = express();
    noBase.use('/api/wallet/pool', walletPoolRouter({ env: { TREASURER_TOKEN: 'letmein' }, db: () => db, payments: () => ({}) as never }));
    expect((await request(noBase).get('/api/wallet/pool').set(treasurer)).status).toBe(503);
  });

  it('fill: asks PayPal for setups that allow several tokens and return to the pool, and caps the pool', async () => {
    const h = build();
    const res = await request(h.app).post('/api/wallet/pool/fill').set(treasurer).send({ count: 2 }).expect(200);
    expect(res.body.links).toHaveLength(2);
    const setup = h.bodies[0] as { payment_source: { paypal: Record<string, unknown> } };
    expect(setup.payment_source.paypal).toMatchObject({
      permit_multiple_payment_tokens: true,
      experience_context: { return_url: 'https://leonid.example.com/api/wallet/pool/return', cancel_url: 'https://leonid.example.com/api/wallet/cancel' },
    });
    expect(await poolCounts(db)).toEqual({ waiting: 2, standby: 0 });
    const before = h.calls.length;
    await request(h.app).post('/api/wallet/pool/fill').set(treasurer).send({ count: 4 }).expect(409);
    await request(h.app).post('/api/wallet/pool/fill').set(treasurer).send({ count: 0 }).expect(422);
    expect(h.calls.length).toBe(before);
  });

  it('return: keeps an approved link as a standby token, once; unknown or replayed setups are refused', async () => {
    const h = build();
    await request(h.app).post('/api/wallet/pool/fill').set(treasurer).send({ count: 1 }).expect(200);
    const bad = await request(h.app).get('/api/wallet/pool/return?approval_session_id=NOPE').expect(302);
    expect(bad.headers.location).toBe('https://leonid.example.com/?pool=error');
    expect(h.calls).not.toContain('POST /v3/vault/payment-tokens');
    const ok = await request(h.app).get('/api/wallet/pool/return?approval_session_id=ST-1').expect(302);
    expect(ok.headers.location).toBe('https://leonid.example.com/?pool=added');
    expect(await poolCounts(db)).toEqual({ waiting: 0, standby: 1 });
    const again = await request(h.app).get('/api/wallet/pool/return?approval_session_id=ST-1').expect(302);
    expect(again.headers.location).toBe('https://leonid.example.com/?pool=error');
    expect(h.calls.filter((c) => c === 'POST /v3/vault/payment-tokens')).toHaveLength(1);
    // A standby token is not a wallet: nothing can spend from it.
    expect(await h.wallet.getActive()).toBeNull();
  });

  it('reset with an empty pool refuses and leaves the current wallet alone', async () => {
    const h = build();
    await h.wallet.activate({ paymentTokenId: 'pt_current', customerId: 'c', payerEmail: 'p@example.com' });
    await request(h.app).post('/api/wallet/pool/reset').set(treasurer).expect(409);
    expect(await h.wallet.getActive()).toEqual({ paymentTokenId: 'pt_current' });
    expect(h.calls.filter((c) => c.startsWith('DELETE'))).toEqual([]);
  });

  it('reset: the kill switch deletes the current token at PayPal first, then the oldest standby becomes the wallet', async () => {
    const h = build();
    await fillAndApprove(h, 2);
    await h.wallet.activate({ paymentTokenId: 'pt_current', customerId: 'c', payerEmail: 'p@example.com' });
    const res = await request(h.app).post('/api/wallet/pool/reset').set(treasurer).expect(200);
    expect(res.body).toMatchObject({ status: 'active', standby: 1, waiting: 0 });
    expect(h.calls.filter((c) => c.startsWith('DELETE'))).toEqual(['DELETE /v3/vault/payment-tokens/pt_current']);
    expect(await h.wallet.getActive()).toEqual({ paymentTokenId: 'pt_ST-1' });
    expect(await db.select().from(demoTokenPool).where(eq(demoTokenPool.paymentTokenId, 'pt_ST-1'))).toHaveLength(0);
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'wallet.pool_reset'));
    expect(row).toMatchObject({ actor: 'treasurer:ops-token', paypalId: 'pt_ST-1' });
    // A second reset deletes the token the first one activated, then activates the last standby.
    await request(h.app).post('/api/wallet/pool/reset').set(treasurer).expect(200);
    expect(await h.wallet.getActive()).toEqual({ paymentTokenId: 'pt_ST-2' });
    await request(h.app).post('/api/wallet/pool/reset').set(treasurer).expect(409);
  });

  it('reset when PayPal cannot delete the current token: nothing is activated', async () => {
    const h = build();
    await fillAndApprove(h, 1);
    await h.wallet.activate({ paymentTokenId: 'pt_current', customerId: 'c', payerEmail: 'p@example.com' });
    h.setDeleteStatus(500);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await request(h.app).post('/api/wallet/pool/reset').set(treasurer).expect(502);
    expect(await h.wallet.getActive()).toBeNull();
    expect(await poolCounts(db)).toEqual({ waiting: 0, standby: 1 });
  });

  it('promotion never replaces a live wallet: the pool row survives the refusal', async () => {
    const h = build();
    await fillAndApprove(h, 1);
    await h.wallet.activate({ paymentTokenId: 'pt_current', customerId: 'c', payerEmail: 'p@example.com' });
    await expect(promoteNextStandby(db)).rejects.toThrow();
    expect(await poolCounts(db)).toEqual({ waiting: 0, standby: 1 });
    expect(await db.select().from(agentWallet).where(eq(agentWallet.status, 'active'))).toHaveLength(1);
  });

  it('end: deletes every standby token at PayPal and forgets waiting links; a failed delete stays for a retry', async () => {
    const h = build();
    await fillAndApprove(h, 2);
    await request(h.app).post('/api/wallet/pool/fill').set(treasurer).send({ count: 1 }).expect(200); // one link stays waiting
    h.setDeleteStatus(500);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await request(h.app).post('/api/wallet/pool/end').set(treasurer).expect(502);
    expect(failed.body).toEqual({ deleted: 0, failed: 2 });
    expect(await poolCounts(db)).toEqual({ waiting: 0, standby: 2 });
    h.setDeleteStatus(404); // already gone at PayPal counts as deleted
    const done = await request(h.app).post('/api/wallet/pool/end').set(treasurer).expect(200);
    expect(done.body).toEqual({ deleted: 2, failed: 0 });
    expect(await poolCounts(db)).toEqual({ waiting: 0, standby: 0 });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'wallet.pool_end'))).toHaveLength(2);
  });
});
