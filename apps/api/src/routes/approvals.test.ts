import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createExecutor } from '../payments/executor.js';
import { createMemoryApprovals, createMemoryAudit, createMemoryReferences, createMemoryWalletStore } from '../payments/memory.js';
import { stubCheck } from '../payments/stub-check.js';
import { createPayPalClient } from '../paypal/client.js';
import { approvalsRouter } from './approvals.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const env = { TREASURER_TOKEN: 'letmein', PAYPAL_PROCUREMENT_CLIENT_ID: 'public-client-id' };
const treasurer = { 'x-treasurer-token': 'letmein' };

function build(orderStatus: () => Response) {
  const calls: string[] = [];
  const routes: Record<string, () => Response> = {
    'POST /v2/checkout/orders': () =>
      json(201, { id: 'ORD-1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD-1' }] }),
    'GET /v2/checkout/orders/ORD-1': orderStatus,
    'POST /v2/checkout/orders/ORD-1/capture': () =>
      json(201, {
        id: 'ORD-1',
        status: 'COMPLETED',
        purchase_units: [{ payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '420.00' } }] } }],
      }),
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/oauth2/token') return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
    const key = `${init?.method} ${path}`;
    calls.push(key);
    const route = routes[key];
    if (!route) throw new Error(`unexpected PayPal call: ${key}`);
    return route();
  });
  const client = createPayPalClient({ app: 'procurement', clientId: 'i', clientSecret: 's', fetch });
  const wallet = createMemoryWalletStore();
  wallet.activate({ paymentTokenId: 'pt_1' }); // the executor refuses every spend while no wallet is active (kill switch)
  const approvals = createMemoryApprovals();
  const executor = createExecutor({
    client,
    check: stubCheck,
    audit: createMemoryAudit(),
    wallet,
    approvals,
    references: createMemoryReferences(),
  });
  const app = express();
  app.use('/api/approvals', approvalsRouter({ env, payments: () => ({ client, wallet, executor, approvals }) }));
  return { app, calls, executor };
}

const approved = () => json(200, { id: 'ORD-1', status: 'APPROVED', purchase_units: [{ amount: { currency_code: 'USD', value: '420.00' } }], links: [] });
const notYet = () => json(200, { id: 'ORD-1', status: 'PAYER_ACTION_REQUIRED', purchase_units: [{ amount: { currency_code: 'USD', value: '420.00' } }], links: [] });
const prizeSpend = { referenceId: 'prizes-1', amountMinor: 42000, currency: 'USD', actor: 'procurement-agent', reason: 'prize cart' };

describe('approvals routes', () => {
  it('serves the public PayPal client id without a token, and 503 when it is missing', async () => {
    const { app } = build(approved);
    const res = await request(app).get('/api/approvals/config');
    expect(res.body).toEqual({ clientId: 'public-client-id', environment: 'sandbox' });
    const bare = express();
    bare.use('/api/approvals', approvalsRouter({ env: { TREASURER_TOKEN: 'x' }, payments: () => { throw new Error('x'); } }));
    expect((await request(bare).get('/api/approvals/config')).status).toBe(503);
  });

  it('keeps list, capture and reject behind the treasurer guard', async () => {
    const { app } = build(approved);
    expect((await request(app).get('/api/approvals')).status).toBe(401);
    expect((await request(app).post('/api/approvals/approval-1/capture')).status).toBe(401);
    expect((await request(app).post('/api/approvals/approval-1/reject').set('x-treasurer-token', 'wrong')).status).toBe(401);
  });

  it('lists a pending approval with its PayPal order and the reasons', async () => {
    const { app, executor } = build(approved);
    await executor.requestSpend(prizeSpend);
    const res = await request(app).get('/api/approvals').set(treasurer);
    expect(res.body.approvals).toEqual([
      expect.objectContaining({ id: 'approval-1', status: 'pending', paypalOrderId: 'ORD-1', reasons: ['over the $200 approval threshold'] }),
    ]);
  });

  it('captures once PayPal says the order is approved', async () => {
    const { app, executor } = build(approved);
    await executor.requestSpend(prizeSpend);
    const res = await request(app).post('/api/approvals/approval-1/capture').set(treasurer);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'paid', captureId: 'CAP1' });
    expect((await request(app).post('/api/approvals/approval-1/capture').set(treasurer)).status).toBe(409); // not twice
  });

  it('answers 409 and captures nothing when the order is not approved at PayPal yet', async () => {
    const { app, executor, calls } = build(notYet);
    await executor.requestSpend(prizeSpend);
    const res = await request(app).post('/api/approvals/approval-1/capture').set(treasurer);
    expect(res.status).toBe(409);
    expect(calls).not.toContain('POST /v2/checkout/orders/ORD-1/capture');
  });

  it('rejects an approval, and a rejected one can no longer be captured', async () => {
    const { app, executor } = build(approved);
    await executor.requestSpend(prizeSpend);
    expect((await request(app).post('/api/approvals/approval-1/reject').set(treasurer)).body).toEqual({ rejected: true });
    expect((await request(app).post('/api/approvals/approval-1/capture').set(treasurer)).status).toBe(409);
    expect((await request(app).post('/api/approvals/approval-1/reject').set(treasurer)).status).toBe(409);
  });
});
