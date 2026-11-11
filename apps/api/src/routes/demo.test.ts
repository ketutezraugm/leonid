import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createExecutor } from '../payments/executor.js';
import { createMemoryApprovals, createMemoryAudit, createMemoryReferences, createMemoryWalletStore } from '../payments/memory.js';
import { stubCheck } from '../payments/stub-check.js';
import { createPayPalClient } from '../paypal/client.js';
import { demoRouter } from './demo.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const on = { DEMO_SPEND: 'true', TREASURER_TOKEN: 'letmein' };
const treasurer = { 'x-treasurer-token': 'letmein' };

const captured = (value: string) => ({
  id: 'ORD-AUTO',
  status: 'COMPLETED',
  purchase_units: [{ payments: { captures: [{ id: 'CAP-AUTO', status: 'COMPLETED', amount: { currency_code: 'USD', value } }] } }],
});

async function build(env: NodeJS.ProcessEnv = on, { wallet: withWallet = true, hangFirstCharge = false } = {}) {
  const orderPosts: unknown[] = [];
  const requestIds: Array<string | null> = [];
  let hangs = hangFirstCharge;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/oauth2/token') return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
    if (init?.method === 'POST' && path === '/v2/checkout/orders') {
      const body = JSON.parse(String(init.body));
      orderPosts.push(body);
      requestIds.push(new Headers(init.headers).get('PayPal-Request-Id'));
      if (hangs && body.payment_source?.paypal?.vault_id) {
        hangs = false; // only the first charge hangs: PayPal never answers, the client's deadline fires
        return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
      }
      if (body.payment_source?.paypal?.vault_id) return json(201, captured(body.purchase_units[0].amount.value));
      return json(201, { id: 'ORD-APPROVE', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD-APPROVE' }] });
    }
    throw new Error(`unexpected PayPal call: ${init?.method} ${path}`);
  });
  const client = createPayPalClient({ app: 'procurement', clientId: 'i', clientSecret: 's', fetch, timeoutMs: 50 });
  const wallet = createMemoryWalletStore();
  if (withWallet) await wallet.activate({ paymentTokenId: 'pt_1' });
  const approvals = createMemoryApprovals();
  const audit = createMemoryAudit();
  const executor = createExecutor({ client, check: stubCheck, audit, wallet, approvals, references: createMemoryReferences() });
  const app = express();
  app.use(express.json());
  app.use('/api/demo', demoRouter({ env, payments: () => ({ client, wallet, executor, approvals }) }));
  return { app, orderPosts, requestIds, wallet, approvals, audit };
}

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const spend = (amountMinor: number, extra: object = {}) => ({ amountMinor, label: 'Lanyards (200)', eventId: EVENT_ID, ...extra });

describe('POST /api/demo/spend', () => {
  it('is off unless DEMO_SPEND=true, and treasurer only when on', async () => {
    const off = await build({ TREASURER_TOKEN: 'letmein' });
    expect((await request(off.app).post('/api/demo/spend').set(treasurer).send(spend(14_000))).status).toBe(404);
    expect(off.orderPosts).toHaveLength(0);

    const { app, orderPosts } = await build();
    expect((await request(app).post('/api/demo/spend').send(spend(14_000))).status).toBe(401);
    expect((await request(app).post('/api/demo/spend').set('x-treasurer-token', 'nope').send(spend(14_000))).status).toBe(401);
    expect(orderPosts).toHaveLength(0);
  });

  it('pays a $140 spend automatically with the saved wallet', async () => {
    const { app, orderPosts, audit } = await build();
    const res = await request(app).post('/api/demo/spend').set(treasurer).send(spend(14_000, { category: 'swag', vendor: 'Lanyard Co' }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'paid', orderId: 'ORD-AUTO', captureId: 'CAP-AUTO' });
    expect(orderPosts).toHaveLength(1);
    expect(JSON.stringify(orderPosts[0])).toContain('"vault_id":"pt_1"');
    expect(audit.rows.at(-1)).toMatchObject({ outcome: 'paid', paypalId: 'CAP-AUTO' });
    expect(audit.rows[0]?.actor).toMatch(/^demo:/);
  });

  it('opens an approval for a $420 spend instead of paying it, and charges nothing', async () => {
    const { app, orderPosts, approvals } = await build();
    const res = await request(app).post('/api/demo/spend').set(treasurer).send(spend(42_000, { label: 'Prize cart' }));
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'needs_approval', paypalOrderId: 'ORD-APPROVE', reasons: ['over the $200 approval threshold'] });
    expect(JSON.stringify(orderPosts[0])).not.toContain('vault_id');
    expect((await approvals.list())[0]).toMatchObject({ status: 'pending', paypalOrderId: 'ORD-APPROVE' });
  });

  it('refuses every spend once the wallet is revoked (kill switch), and never calls PayPal', async () => {
    const { app, orderPosts, wallet } = await build();
    await wallet.markRevoked();
    for (const amountMinor of [14_000, 42_000]) {
      const res = await request(app).post('/api/demo/spend').set(treasurer).send(spend(amountMinor));
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ status: 'refused', reason: 'no_wallet' });
    }
    expect(orderPosts).toHaveLength(0);
  });

  it('charges only once when the same referenceId is sent again, and refuses it for a different amount', async () => {
    const { app, orderPosts } = await build();
    const first = await request(app).post('/api/demo/spend').set(treasurer).send(spend(14_000, { referenceId: 'demo-1' }));
    expect(first.status).toBe(200);
    const different = await request(app).post('/api/demo/spend').set(treasurer).send(spend(9_900, { referenceId: 'demo-1' }));
    expect(different.status).toBe(409);
    expect(different.body).toEqual({ status: 'refused', reason: 'reference_reused' });
    expect(orderPosts).toHaveLength(1);
  });

  it('records the event on the audit row when the caller sends one, and refuses an eventId that is not a UUID', async () => {
    const { app, audit, orderPosts } = await build();
    const eventId = '3bbd0ba2-ed6c-41d4-a8f0-719e60f44a13';
    expect((await request(app).post('/api/demo/spend').set(treasurer).send(spend(14_000, { eventId, category: 'swag' }))).status).toBe(200);
    expect(audit.rows.find((r) => r.action === 'spend.check')?.input).toMatchObject({ eventId, amountMinor: 14_000, currency: 'USD', category: 'swag' });
    expect((await request(app).post('/api/demo/spend').set(treasurer).send(spend(14_000, { eventId: 'not-a-uuid' }))).status).toBe(422);
    expect((await request(app).post('/api/demo/spend').set(treasurer).send(spend(14_000, { eventId: undefined }))).status).toBe(422);
    expect(orderPosts).toHaveLength(1);
  });

  it('a PayPal call that never answers is recorded as an error, and a retry reuses the same PayPal-Request-Id so it cannot charge twice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, audit, requestIds } = await build(on, { hangFirstCharge: true });
    const first = await request(app).post('/api/demo/spend').set(treasurer).send(spend(14_000, { referenceId: 'demo-slow' }));
    expect(first.status).toBe(500);
    expect(audit.rows.find((r) => r.action === 'spend.check')).toMatchObject({ outcome: 'error', detail: expect.stringContaining('did not answer') });

    const retry = await request(app).post('/api/demo/spend').set(treasurer).send(spend(14_000, { referenceId: 'demo-slow' }));
    expect(retry.status).toBe(200);
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).toBe(requestIds[1]);
    expect(requestIds[0]).toBe('charge-demo-slow');
  });

  it('rejects an invalid or oversized body before touching PayPal', async () => {
    const { app, orderPosts } = await build();
    for (const bad of [{}, spend(0), spend(-5), spend(14.5), spend(100_001), { amountMinor: 100, label: '' }, { amountMinor: '100', label: 'x' }]) {
      expect((await request(app).post('/api/demo/spend').set(treasurer).send(bad)).status).toBe(422);
    }
    expect(orderPosts).toHaveLength(0);
  });

  it('answers 503 when the PayPal Procurement app is not configured', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/demo', demoRouter({ env: on, payments: () => { throw new Error('x'); } }));
    expect((await request(app).post('/api/demo/spend').set(treasurer).send(spend(14_000))).status).toBe(503);
  });
});
