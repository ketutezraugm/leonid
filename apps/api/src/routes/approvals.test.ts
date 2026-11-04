import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalsResponse } from '@quartermaster/shared';
import { createExecutor } from '../payments/executor.js';
import { createMemoryApprovals, createMemoryAudit, createMemoryReferences, createMemoryWalletStore } from '../payments/memory.js';
import { stubCheck } from '../payments/stub-check.js';
import { createPayPalClient } from '../paypal/client.js';
import { approvalsRouter } from './approvals.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const env = { TREASURER_TOKEN: 'letmein', PAYPAL_PROCUREMENT_CLIENT_ID: 'public-client-id' };
const treasurer = { 'x-treasurer-token': 'letmein' };

async function build(orderStatus: () => Response) {
  const calls: string[] = [];
  let orders = 0; // each spend gets its own PayPal order (ORD-1, ORD-2, ...): one approval per order
  const routes: Record<string, () => Response> = {
    'POST /v2/checkout/orders': () => {
      const id = `ORD-${++orders}`;
      return json(201, { id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] });
    },
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
  await wallet.activate({ paymentTokenId: 'pt_1' }); // the executor refuses every spend while no wallet is active (kill switch)
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
  app.use(express.json()); // as in the real app
  app.use('/api/approvals', approvalsRouter({ env, payments: () => ({ client, wallet, executor, approvals }) }));
  return { app, calls, executor, audit, approvals };
}

const approved = () => json(200, { id: 'ORD-1', status: 'APPROVED', purchase_units: [{ amount: { currency_code: 'USD', value: '420.00' } }], links: [] });
const notYet = () => json(200, { id: 'ORD-1', status: 'PAYER_ACTION_REQUIRED', purchase_units: [{ amount: { currency_code: 'USD', value: '420.00' } }], links: [] });
const prizeSpend = { referenceId: 'prizes-1', amountMinor: 42000, currency: 'USD', actor: 'procurement-agent', reason: 'prize cart', eventId: '11111111-1111-4111-8111-111111111111' };

describe('approvals routes', () => {
  it('serves the public PayPal client id without a token, and 503 when it is missing', async () => {
    const { app } = await build(approved);
    const res = await request(app).get('/api/approvals/config');
    expect(res.body).toEqual({ clientId: 'public-client-id', environment: 'sandbox' });
    const bare = express();
    bare.use('/api/approvals', approvalsRouter({ env: { TREASURER_TOKEN: 'x' }, payments: () => { throw new Error('x'); } }));
    expect((await request(bare).get('/api/approvals/config')).status).toBe(503);
  });

  it('keeps list, capture and reject behind the treasurer guard', async () => {
    const { app } = await build(approved);
    expect((await request(app).get('/api/approvals')).status).toBe(401);
    expect((await request(app).post('/api/approvals/approval-1/capture')).status).toBe(401);
    expect((await request(app).post('/api/approvals/approval-1/reject').set('x-treasurer-token', 'wrong')).status).toBe(401);
  });

  it('lists a pending approval with its PayPal order and the reasons', async () => {
    const { app, executor } = await build(approved);
    await executor.requestSpend(prizeSpend);
    const res = await request(app).get('/api/approvals').set(treasurer);
    expect(res.body.approvals).toEqual([
      expect.objectContaining({ id: 'approval-1', status: 'pending', paypalOrderId: 'ORD-1', reasons: ['over the $200 approval threshold'] }),
    ]);
    // the shape the web builds on: shared contract, flat amount, the agent's own reasoning, a created time
    expect(ApprovalsResponse.parse(res.body).approvals[0]).toMatchObject({
      amountMinor: 42000,
      currency: 'USD',
      agentReason: 'prize cart',
      referenceId: 'prizes-1',
      actor: 'procurement-agent',
    });
  });

  it("tells purchases from payouts with `kind`, and a payout has no PayPal order to approve", async () => {
    const { app, executor, approvals } = await build(approved);
    await executor.requestSpend(prizeSpend);
    await approvals.create(
      { ...prizeSpend, referenceId: 'claim-1', kind: 'claim', payee: 'Dana', payeeEmail: 'dana@example.com' },
      { decision: 'needs_approval', reasons: ['over the $200 approval threshold'], ruleIds: [] },
      'audit-1',
    );
    const items = ApprovalsResponse.parse((await request(app).get('/api/approvals').set(treasurer)).body).approvals;
    expect(items.map((a) => [a.referenceId, a.kind, a.paypalOrderId])).toEqual([
      ['prizes-1', 'purchase', 'ORD-1'],
      ['claim-1', 'payout', undefined],
    ]);
  });

  it('lists the oldest approval first', async () => {
    const { app, executor } = await build(approved);
    await executor.requestSpend(prizeSpend);
    await executor.requestSpend({ ...prizeSpend, referenceId: 'prizes-2' });
    const ids = (await request(app).get('/api/approvals').set(treasurer)).body.approvals.map((a: { referenceId: string }) => a.referenceId);
    expect(ids).toEqual(['prizes-1', 'prizes-2']);
  });

  it('captures once PayPal says the order is approved', async () => {
    const { app, executor, audit } = await build(approved);
    await executor.requestSpend(prizeSpend);
    const res = await request(app).post('/api/approvals/approval-1/capture').set(treasurer);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'paid', captureId: 'CAP1' });
    expect(audit.rows.find((r) => r.action === 'spend.capture')).toMatchObject({ actor: 'treasurer:ops-token' }); // who, from the guard
    expect((await request(app).post('/api/approvals/approval-1/capture').set(treasurer)).status).toBe(409); // not twice
  });

  it('answers 409 with already_paid or in_progress when another capture got there first', async () => {
    const { app, executor, approvals } = await build(approved);
    await executor.requestSpend(prizeSpend);
    await approvals.claimCapture('approval-1'); // e.g. the webhook is capturing right now
    const busy = await request(app).post('/api/approvals/approval-1/capture').set(treasurer);
    expect([busy.status, busy.body]).toEqual([409, { status: 'refused', reason: 'in_progress' }]);
    await approvals.markPaid('approval-1');
    const done = await request(app).post('/api/approvals/approval-1/capture').set(treasurer);
    expect([done.status, done.body]).toEqual([409, { status: 'refused', reason: 'already_paid' }]);
  });

  it('answers 409 and captures nothing when the order is not approved at PayPal yet', async () => {
    const { app, executor, calls } = await build(notYet);
    await executor.requestSpend(prizeSpend);
    const res = await request(app).post('/api/approvals/approval-1/capture').set(treasurer);
    expect(res.status).toBe(409);
    expect(calls).not.toContain('POST /v2/checkout/orders/ORD-1/capture');
  });

  it('records the decline reason in the audit log, and refuses an over-long or non-text reason', async () => {
    const { app, executor, audit } = await build(approved);
    await executor.requestSpend(prizeSpend);
    expect((await request(app).post('/api/approvals/approval-1/reject').set(treasurer).send({ reason: 'x'.repeat(201) })).status).toBe(400);
    expect((await request(app).post('/api/approvals/approval-1/reject').set(treasurer).send({ reason: 42 })).status).toBe(400);
    const ok = await request(app).post('/api/approvals/approval-1/reject').set(treasurer).send({ reason: ' wrong supplier ' });
    expect(ok.body).toEqual({ rejected: true });
    expect(audit.rows.at(-1)).toMatchObject({ actor: 'treasurer:ops-token', action: 'spend.rejected_by_treasurer', reason: 'treasurer rejected: wrong supplier' });
  });

  it('flattens newlines and control characters in the decline reason before it reaches the audit log', async () => {
    const { app, executor, audit } = await build(approved);
    await executor.requestSpend(prizeSpend);
    const reason = 'wrong supplier\r\n[audit] approved by treasurer\u0000\u202e\u2028done';
    expect((await request(app).post('/api/approvals/approval-1/reject').set(treasurer).send({ reason })).body).toEqual({ rejected: true });
    expect(audit.rows.at(-1)?.reason).toBe('treasurer rejected: wrong supplier [audit] approved by treasurer done');
  });

  it('records a reason made only of control characters as a plain rejection', async () => {
    const { app, executor, audit } = await build(approved);
    await executor.requestSpend(prizeSpend);
    await request(app).post('/api/approvals/approval-1/reject').set(treasurer).send({ reason: '\u0007\u0000' });
    expect(audit.rows.at(-1)?.reason).toBe('treasurer rejected');
  });

  it('lists an approval whose capture is in flight as capturing, and it fits the shared ApprovalItem', async () => {
    const { app, executor, approvals } = await build(approved);
    await executor.requestSpend(prizeSpend);
    await approvals.claimCapture('approval-1');
    const body = (await request(app).get('/api/approvals').set(treasurer)).body;
    expect(ApprovalsResponse.parse(body).approvals[0]?.status).toBe('capturing');
  });

  it('rejects an approval, and a rejected one can no longer be captured', async () => {
    const { app, executor } = await build(approved);
    await executor.requestSpend(prizeSpend);
    expect((await request(app).post('/api/approvals/approval-1/reject').set(treasurer)).body).toEqual({ rejected: true });
    expect((await request(app).post('/api/approvals/approval-1/capture').set(treasurer)).status).toBe(409);
    expect((await request(app).post('/api/approvals/approval-1/reject').set(treasurer)).status).toBe(409);
  });
});
