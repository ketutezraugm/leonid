import { describe, expect, it, vi } from 'vitest';
import { createPayPalClient } from '../paypal/client.js';
import { createExecutor } from './executor.js';
import type { ApprovalStatus, ApprovalsPort, AuditPort, ReferencePort, Spend, WalletPort } from './ports.js';
import { stubCheck } from './stub-check.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const paid = (amount: string) =>
  json(201, {
    id: 'ORDER1',
    status: 'COMPLETED',
    purchase_units: [{ payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'USD', value: amount } }] } }],
  });
const orderCreated = () =>
  json(201, { id: 'ORD-1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD-1' }] });
const orderState = (status: string, amount: string) =>
  json(200, { id: 'ORD-1', status, purchase_units: [{ amount: { currency_code: 'USD', value: amount } }], links: [] });

type SeededApproval = { spend: Spend; status: ApprovalStatus; paypalOrderId?: string };

// One shared timeline so tests can assert ordering (audit before PayPal, flag before delete, check before capture).
function setup(opts: { routes?: Record<string, () => Response>; wallet?: boolean; approvals?: Record<string, SeededApproval> } = {}) {
  const events: string[] = [];
  const routes = opts.routes ?? {};
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/oauth2/token') return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
    const key = `${init?.method} ${path}`;
    events.push(`paypal ${key}`);
    const route = Object.entries(routes).find(([k]) => key === k);
    if (!route) throw new Error(`unexpected PayPal call: ${key}`);
    return route[1]();
  });
  const client = createPayPalClient({ app: 'procurement', clientId: 'i', clientSecret: 's', fetch });

  const auditRows: { id: string; entry: Parameters<AuditPort['record']>[0]; patch?: Parameters<AuditPort['update']>[1] }[] = [];
  const audit: AuditPort = {
    async record(entry) {
      events.push(`audit.record ${entry.action}`);
      const id = `A${auditRows.length + 1}`;
      auditRows.push({ id, entry });
      return id;
    },
    async update(id, patch) {
      events.push(`audit.update ${patch.outcome}`);
      auditRows.find((r) => r.id === id)!.patch = patch;
    },
  };

  let active = opts.wallet === false ? null : { paymentTokenId: 'pt_1' };
  const toDelete = new Set<string>();
  const wallet: WalletPort = {
    async getActive() {
      return active;
    },
    async markRevoked() {
      events.push('wallet.markRevoked');
      if (active) toDelete.add(active.paymentTokenId);
      active = null;
    },
    async pendingDeletions() {
      return [...toDelete];
    },
    async confirmDeleted(id) {
      toDelete.delete(id);
    },
  };

  // copies, so one test marking an approval paid cannot leak into the next
  const approvalRows = new Map<string, SeededApproval>(Object.entries(opts.approvals ?? {}).map(([id, a]) => [id, { ...a }]));
  const approvals: ApprovalsPort = {
    async create(spend) {
      const id = `AP${approvalRows.size + 1}`;
      approvalRows.set(id, { spend, status: 'pending' });
      return id;
    },
    async attachOrder(id, paypalOrderId) {
      approvalRows.get(id)!.paypalOrderId = paypalOrderId;
    },
    async get(id) {
      return approvalRows.get(id) ?? null;
    },
    async reject(id) {
      approvalRows.get(id)!.status = 'rejected';
    },
    async markPaid(id) {
      approvalRows.get(id)!.status = 'paid';
    },
  };

  const used = new Map<string, string>();
  const references: ReferencePort = {
    async claim(referenceId, fingerprint) {
      const existing = used.get(referenceId);
      if (existing === undefined) {
        used.set(referenceId, fingerprint);
        return 'new';
      }
      return existing === fingerprint ? 'same' : 'conflict';
    },
  };

  const executor = createExecutor({ client, check: stubCheck, audit, wallet, approvals, references });
  return { executor, events, fetch, auditRows, approvalRows };
}

const spend = (amountMinor: number, referenceId = 'cart-1'): Spend => ({
  referenceId,
  amountMinor,
  currency: 'USD',
  actor: 'procurement-agent',
  reason: 'lanyards for 200 attendees',
});
const callsTo = (fetch: ReturnType<typeof setup>['fetch'], method: string, pathEnd: string) =>
  fetch.mock.calls.filter(([u, init]) => init?.method === method && new URL(String(u)).pathname.endsWith(pathEnd));
const orderPosts = (fetch: ReturnType<typeof setup>['fetch']) => callsTo(fetch, 'POST', '/v2/checkout/orders');
const captures = (fetch: ReturnType<typeof setup>['fetch']) => callsTo(fetch, 'POST', '/capture');

describe('requestSpend', () => {
  it('pays a spend the rules allow, and writes the audit row before calling PayPal', async () => {
    const { executor, events, auditRows } = setup({ routes: { 'POST /v2/checkout/orders': () => paid('140.00') } });
    const out = await executor.requestSpend(spend(14000));
    expect(out).toEqual({ status: 'paid', orderId: 'ORDER1', captureId: 'CAP1' });
    expect(events).toEqual(['audit.record spend.check', 'paypal POST /v2/checkout/orders', 'audit.update paid']);
    expect(auditRows[0]!.patch).toMatchObject({ outcome: 'paid', paypalId: 'CAP1' });
    expect(auditRows[0]!.entry.ruleResult?.decision).toBe('allow');
  });

  it('turns a spend over the threshold into a PayPal order for the treasurer, and moves no money', async () => {
    const { executor, fetch, approvalRows, auditRows } = setup({ routes: { 'POST /v2/checkout/orders': orderCreated } });
    const out = await executor.requestSpend(spend(42000, 'prizes-1'));
    expect(out).toMatchObject({ status: 'needs_approval', paypalOrderId: 'ORD-1', reasons: ['over the $200 approval threshold'] });
    expect(captures(fetch)).toHaveLength(0);
    const body = JSON.parse(String(orderPosts(fetch)[0]![1]!.body));
    expect(body.payment_source.paypal.vault_id).toBeUndefined(); // the saved wallet is not used for this one
    expect(approvalRows.get('AP1')).toMatchObject({ status: 'pending', paypalOrderId: 'ORD-1' });
    expect(auditRows[0]!.patch).toMatchObject({ outcome: 'needs_approval', paypalId: 'ORD-1' });
  });

  it('reports a failure, not an approval, if PayPal cannot create the order', async () => {
    const { executor, approvalRows } = setup({ routes: { 'POST /v2/checkout/orders': () => json(422, { name: 'UNPROCESSABLE_ENTITY' }) } });
    expect((await executor.requestSpend(spend(42000, 'prizes-2'))).status).toBe('failed');
    expect(approvalRows.get('AP1')?.paypalOrderId).toBeUndefined(); // nothing for the treasurer to approve or capture
  });

  it('blocks a spend the rules block, still audited', async () => {
    const { fetch, auditRows } = setup();
    const blocking = createExecutor({
      client: createPayPalClient({ app: 'procurement', clientId: 'i', clientSecret: 's', fetch }),
      check: () => ({ decision: 'block', reasons: ['vendor not on the approved list'], ruleIds: ['approved-vendors'] }),
      audit: { record: async (e) => { auditRows.push({ id: 'B1', entry: e }); return 'B1'; }, update: async () => {} },
      wallet: {
        getActive: async () => ({ paymentTokenId: 'pt_1' }),
        markRevoked: async () => {},
        pendingDeletions: async () => [],
        confirmDeleted: async () => {},
      },
      approvals: { create: async () => 'x', attachOrder: async () => {}, get: async () => null, reject: async () => {}, markPaid: async () => {} },
      references: { claim: async () => 'new' },
    });
    expect(await blocking.requestSpend(spend(5000))).toEqual({ status: 'blocked', reasons: ['vendor not on the approved list'] });
    expect(orderPosts(fetch)).toHaveLength(0);
    expect(auditRows).toHaveLength(1);
  });

  it('refuses when there is no active wallet and never tries another payment path', async () => {
    const { executor, fetch } = setup({ wallet: false });
    expect(await executor.requestSpend(spend(14000))).toEqual({ status: 'refused', reason: 'no_wallet' });
    expect(orderPosts(fetch)).toHaveLength(0);
  });

  it('treats PayPal refusing the token (403) as a revoked wallet', async () => {
    const { executor } = setup({
      routes: { 'POST /v2/checkout/orders': () => json(403, { name: 'NOT_AUTHORIZED', details: [{ issue: 'PERMISSION_DENIED' }] }) },
    });
    expect(await executor.requestSpend(spend(14000))).toEqual({ status: 'refused', reason: 'paypal_refused' });
    // our own state now agrees with PayPal: the next attempt does not even reach PayPal
    expect(await executor.requestSpend(spend(14000, 'cart-2'))).toEqual({ status: 'refused', reason: 'no_wallet' });
  });

  it('reports a retryable failure without revoking the wallet', async () => {
    const { executor, events } = setup({
      routes: { 'POST /v2/checkout/orders': () => json(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] }) },
    });
    expect((await executor.requestSpend(spend(14000))).status).toBe('failed');
    expect(events).not.toContain('wallet.markRevoked');
  });

  it('refuses a reference id that was already used for a different spend, without calling PayPal', async () => {
    const { executor, fetch, auditRows } = setup({ routes: { 'POST /v2/checkout/orders': () => paid('140.00') } });
    expect((await executor.requestSpend(spend(14000, 'cart-7'))).status).toBe('paid');
    expect(await executor.requestSpend(spend(900, 'cart-7'))).toEqual({ status: 'refused', reason: 'reference_reused' });
    expect(orderPosts(fetch)).toHaveLength(1);
    expect(auditRows.at(-1)!.patch).toMatchObject({ outcome: 'refused' });
  });

  it('treats the same id and amount with a different vendor, category or actor as a different spend', async () => {
    const { executor, fetch } = setup({ routes: { 'POST /v2/checkout/orders': () => paid('140.00') } });
    await executor.requestSpend({ ...spend(14000, 'cart-5'), vendor: 'merch-co', category: 'swag' });
    for (const changed of [{ vendor: 'other-co' }, { category: 'prizes' }, { actor: 'treasury-agent' }]) {
      const out = await executor.requestSpend({ ...spend(14000, 'cart-5'), vendor: 'merch-co', category: 'swag', ...changed });
      expect(out).toEqual({ status: 'refused', reason: 'reference_reused' });
    }
    expect(orderPosts(fetch)).toHaveLength(1);
  });

  it('lets an identical spend be retried under the same reference id', async () => {
    const { executor, fetch } = setup({ routes: { 'POST /v2/checkout/orders': () => paid('140.00') } });
    await executor.requestSpend(spend(14000, 'cart-8'));
    expect((await executor.requestSpend(spend(14000, 'cart-8'))).status).toBe('paid');
    // PayPal's idempotency key (charge-cart-8) makes both calls resolve to the same order
    const keys = orderPosts(fetch).map(([, init]) => (init?.headers as Record<string, string>)['PayPal-Request-Id']);
    expect(keys).toEqual(['charge-cart-8', 'charge-cart-8']);
  });

  it('never records paid when PayPal captured a different amount than was asked', async () => {
    const { executor, auditRows } = setup({ routes: { 'POST /v2/checkout/orders': () => paid('10.00') } });
    expect((await executor.requestSpend(spend(14000, 'cart-9'))).status).toBe('failed');
    expect(auditRows[0]!.patch).toMatchObject({ outcome: 'mismatch', paypalId: 'CAP1' });
    expect(auditRows[0]!.patch?.detail).toContain('asked 14000 USD');
  });

  it('records the audit outcome even when the call blows up unexpectedly', async () => {
    const { executor, auditRows } = setup({
      routes: {
        'POST /v2/checkout/orders': () => {
          throw new Error('socket hang up');
        },
      },
    });
    await expect(executor.requestSpend(spend(14000))).rejects.toThrow('socket hang up');
    expect(auditRows[0]!.patch).toMatchObject({ outcome: 'error', detail: 'socket hang up' });
  });
});

describe('captureApproved (the treasurer approved in the PayPal popup)', () => {
  const pending: SeededApproval = { spend: spend(42000, 'prizes-1'), status: 'pending', paypalOrderId: 'ORD-1' };
  const approvedAtPayPal = {
    'GET /v2/checkout/orders/ORD-1': () => orderState('APPROVED', '420.00'),
    'POST /v2/checkout/orders/ORD-1/capture': () => paid('420.00'),
  };

  it('asks PayPal if the order is approved, then captures it, and marks the approval paid', async () => {
    const { executor, events, approvalRows, auditRows } = setup({ routes: approvedAtPayPal, approvals: { AP1: pending } });
    expect(await executor.captureApproved('AP1', 'treasurer')).toMatchObject({ status: 'paid', captureId: 'CAP1' });
    expect(events.indexOf('paypal GET /v2/checkout/orders/ORD-1')).toBeLessThan(events.indexOf('paypal POST /v2/checkout/orders/ORD-1/capture'));
    expect(approvalRows.get('AP1')?.status).toBe('paid');
    expect(auditRows[0]!.entry).toMatchObject({ actor: 'treasurer', action: 'spend.capture' });
    expect(auditRows[0]!.patch).toMatchObject({ outcome: 'paid' });
  });

  it('does not capture an order the payer has not approved at PayPal, whatever the browser says', async () => {
    const { executor, fetch, approvalRows } = setup({
      routes: { 'GET /v2/checkout/orders/ORD-1': () => orderState('PAYER_ACTION_REQUIRED', '420.00') },
      approvals: { AP1: pending },
    });
    expect(await executor.captureApproved('AP1', 'treasurer')).toEqual({ status: 'refused', reason: 'not_approved' });
    expect(captures(fetch)).toHaveLength(0);
    expect(approvalRows.get('AP1')?.status).toBe('pending');
  });

  it('does not capture an approved order whose amount differs from the spend', async () => {
    const { executor, fetch, auditRows } = setup({
      routes: { 'GET /v2/checkout/orders/ORD-1': () => orderState('APPROVED', '4.20') },
      approvals: { AP1: pending },
    });
    expect((await executor.captureApproved('AP1', 'treasurer')).status).toBe('failed');
    expect(captures(fetch)).toHaveLength(0);
    expect(auditRows[0]!.patch).toMatchObject({ outcome: 'mismatch' });
  });

  it('refuses a second capture of the same approval', async () => {
    const { executor, fetch } = setup({ routes: approvedAtPayPal, approvals: { AP1: pending } });
    await executor.captureApproved('AP1', 'treasurer');
    expect(await executor.captureApproved('AP1', 'treasurer')).toEqual({ status: 'refused', reason: 'not_approved' });
    expect(captures(fetch)).toHaveLength(1);
  });

  it.each([['rejected'], ['paid']] as const)('refuses a %s approval', async (status) => {
    const { executor, fetch } = setup({ approvals: { AP1: { ...pending, status } } });
    expect(await executor.captureApproved('AP1', 'treasurer')).toEqual({ status: 'refused', reason: 'not_approved' });
    expect(fetch.mock.calls.filter(([u]) => !String(u).includes('oauth2'))).toHaveLength(0);
  });

  it('refuses an approval with no PayPal order, or one that does not exist', async () => {
    const { executor } = setup({ approvals: { AP1: { ...pending, paypalOrderId: undefined } } });
    expect((await executor.captureApproved('AP1', 'treasurer')).status).toBe('refused');
    expect((await executor.captureApproved('nope', 'treasurer')).status).toBe('refused');
  });

  it('reports a PayPal failure on capture and leaves the approval pending so it can be retried', async () => {
    const { executor, approvalRows, auditRows } = setup({
      routes: { ...approvedAtPayPal, 'POST /v2/checkout/orders/ORD-1/capture': () => json(422, { name: 'UNPROCESSABLE_ENTITY' }) },
      approvals: { AP1: pending },
    });
    expect((await executor.captureApproved('AP1', 'treasurer')).status).toBe('failed');
    expect(approvalRows.get('AP1')?.status).toBe('pending');
    expect(auditRows[0]!.patch).toMatchObject({ outcome: 'error' });
  });
});

describe('rejectApproval', () => {
  it('rejects a pending approval, after which it can no longer be captured', async () => {
    const { executor, approvalRows } = setup({
      approvals: { AP1: { spend: spend(42000, 'prizes-1'), status: 'pending', paypalOrderId: 'ORD-1' } },
    });
    expect(await executor.rejectApproval('AP1', 'treasurer')).toEqual({ rejected: true });
    expect(approvalRows.get('AP1')?.status).toBe('rejected');
    expect(await executor.captureApproved('AP1', 'treasurer')).toEqual({ status: 'refused', reason: 'not_approved' });
    expect(await executor.rejectApproval('AP1', 'treasurer')).toEqual({ rejected: false });
  });
});

describe('revokeWallet (kill switch)', () => {
  it('flips our flag first, then deletes the token at PayPal, and spending stops with no fallback', async () => {
    const { executor, events, fetch } = setup({
      routes: { 'DELETE /v3/vault/payment-tokens/pt_1': () => new Response(null, { status: 204 }) },
    });
    expect(await executor.revokeWallet('treasurer')).toEqual({ revoked: true });
    expect(events.indexOf('wallet.markRevoked')).toBeLessThan(events.indexOf('paypal DELETE /v3/vault/payment-tokens/pt_1'));
    expect(await executor.requestSpend(spend(14000))).toEqual({ status: 'refused', reason: 'no_wallet' });
    expect(orderPosts(fetch)).toHaveLength(0);
  });

  it('tolerates a token PayPal already deleted (404)', async () => {
    const { executor } = setup({
      routes: { 'DELETE /v3/vault/payment-tokens/pt_1': () => json(404, { name: 'RESOURCE_NOT_FOUND' }) },
    });
    expect(await executor.revokeWallet('treasurer')).toEqual({ revoked: true });
  });

  it('keeps the wallet revoked locally if the PayPal call fails, and reports the error', async () => {
    const { executor, events } = setup({
      routes: { 'DELETE /v3/vault/payment-tokens/pt_1': () => json(500, { name: 'INTERNAL_SERVER_ERROR' }) },
    });
    await expect(executor.revokeWallet('treasurer')).rejects.toThrow();
    expect(events).toContain('wallet.markRevoked');
    expect(await executor.requestSpend(spend(14000))).toEqual({ status: 'refused', reason: 'no_wallet' });
  });

  it('retries the PayPal delete on a second call, so a failed delete never leaves a live token behind', async () => {
    let attempts = 0;
    const { executor, fetch } = setup({
      routes: {
        'DELETE /v3/vault/payment-tokens/pt_1': () => (++attempts === 1 ? json(500, { name: 'INTERNAL_SERVER_ERROR' }) : new Response(null, { status: 204 })),
      },
    });
    await expect(executor.revokeWallet('treasurer')).rejects.toThrow();
    // our side is already revoked, but the token still counts as "to delete"
    expect(await executor.revokeWallet('treasurer')).toEqual({ revoked: true });
    expect(attempts).toBe(2);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(2);
    expect(await executor.revokeWallet('treasurer')).toEqual({ revoked: false }); // nothing left to delete
  });

  it('does nothing when there is no active wallet', async () => {
    const { executor } = setup({ wallet: false });
    expect(await executor.revokeWallet('treasurer')).toEqual({ revoked: false });
  });
});
