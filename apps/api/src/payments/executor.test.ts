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

// One shared timeline so tests can assert ordering (audit before PayPal, flag before delete).
function setup(opts: { routes?: Record<string, () => Response>; wallet?: boolean; approvals?: Record<string, { spend: Spend; status: ApprovalStatus; decidedBy?: string }> } = {}) {
  const events: string[] = [];
  const routes = opts.routes ?? {};
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/oauth2/token') return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
    const key = `${init?.method} ${path}`;
    events.push(`paypal ${key}`);
    const route = Object.entries(routes).find(([k]) => key.startsWith(k));
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
  const wallet: WalletPort = {
    async getActive() {
      return active;
    },
    async markRevoked() {
      events.push('wallet.markRevoked');
      active = null;
    },
  };

  const approvalRows = new Map(Object.entries(opts.approvals ?? {}));
  const approvals: ApprovalsPort = {
    async create(spend) {
      const id = `AP${approvalRows.size + 1}`;
      approvalRows.set(id, { spend, status: 'pending' });
      return id;
    },
    async get(id) {
      return approvalRows.get(id) ?? null;
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
const chargeCalls = (fetch: ReturnType<typeof setup>['fetch']) => fetch.mock.calls.filter(([u]) => String(u).includes('/v2/checkout/orders'));

describe('requestSpend', () => {
  it('pays a spend the rules allow, and writes the audit row before calling PayPal', async () => {
    const { executor, events, auditRows } = setup({ routes: { 'POST /v2/checkout/orders': () => paid('140.00') } });
    const out = await executor.requestSpend(spend(14000));
    expect(out).toEqual({ status: 'paid', orderId: 'ORDER1', captureId: 'CAP1' });
    expect(events).toEqual(['audit.record spend.check', 'paypal POST /v2/checkout/orders', 'audit.update paid']);
    expect(auditRows[0]!.patch).toMatchObject({ outcome: 'paid', paypalId: 'CAP1' });
    expect(auditRows[0]!.entry.ruleResult?.decision).toBe('allow');
  });

  it('sends a spend over the threshold to approval and moves no money', async () => {
    const { executor, fetch, approvalRows } = setup();
    const out = await executor.requestSpend(spend(42000, 'prizes-1'));
    expect(out).toMatchObject({ status: 'needs_approval', reasons: ['over the $200 approval threshold'] });
    expect(chargeCalls(fetch)).toHaveLength(0);
    expect(approvalRows.get('AP1')?.status).toBe('pending');
  });

  it('blocks a spend the rules block, still audited', async () => {
    const { fetch, auditRows } = setup();
    const blocking = createExecutor({
      client: createPayPalClient({ app: 'procurement', clientId: 'i', clientSecret: 's', fetch }),
      check: () => ({ decision: 'block', reasons: ['vendor not on the approved list'], ruleIds: ['approved-vendors'] }),
      audit: { record: async (e) => { auditRows.push({ id: 'B1', entry: e }); return 'B1'; }, update: async () => {} },
      wallet: { getActive: async () => ({ paymentTokenId: 'pt_1' }), markRevoked: async () => {} },
      approvals: { create: async () => 'x', get: async () => null, markPaid: async () => {} },
      references: { claim: async () => 'new' },
    });
    expect(await blocking.requestSpend(spend(5000))).toEqual({ status: 'blocked', reasons: ['vendor not on the approved list'] });
    expect(chargeCalls(fetch)).toHaveLength(0);
    expect(auditRows).toHaveLength(1);
  });

  it('refuses when there is no active wallet and never tries another payment path', async () => {
    const { executor, fetch } = setup({ wallet: false });
    expect(await executor.requestSpend(spend(14000))).toEqual({ status: 'refused', reason: 'no_wallet' });
    expect(chargeCalls(fetch)).toHaveLength(0);
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
    const out = await executor.requestSpend(spend(14000));
    expect(out.status).toBe('failed');
    expect(events).not.toContain('wallet.markRevoked');
  });

  it('refuses a reference id that was already used for a different spend, without calling PayPal', async () => {
    const { executor, fetch, auditRows } = setup({ routes: { 'POST /v2/checkout/orders': () => paid('140.00') } });
    expect((await executor.requestSpend(spend(14000, 'cart-7'))).status).toBe('paid');
    const out = await executor.requestSpend(spend(900, 'cart-7')); // same id, different amount
    expect(out).toEqual({ status: 'refused', reason: 'reference_reused' });
    expect(chargeCalls(fetch)).toHaveLength(1);
    expect(auditRows.at(-1)!.patch).toMatchObject({ outcome: 'refused' });
  });

  it('lets an identical spend be retried under the same reference id', async () => {
    const { executor, fetch } = setup({ routes: { 'POST /v2/checkout/orders': () => paid('140.00') } });
    await executor.requestSpend(spend(14000, 'cart-8'));
    expect((await executor.requestSpend(spend(14000, 'cart-8'))).status).toBe('paid');
    // PayPal's idempotency key (charge-cart-8) makes both calls resolve to the same order
    const keys = chargeCalls(fetch).map(([, init]) => (init?.headers as Record<string, string>)['PayPal-Request-Id']);
    expect(keys).toEqual(['charge-cart-8', 'charge-cart-8']);
  });

  it('never records paid when PayPal captured a different amount than was asked', async () => {
    const { executor, auditRows } = setup({ routes: { 'POST /v2/checkout/orders': () => paid('10.00') } });
    const out = await executor.requestSpend(spend(14000, 'cart-9'));
    expect(out.status).toBe('failed');
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

describe('executeApproved', () => {
  const approved = { spend: spend(42000, 'prizes-1'), status: 'approved' as const, decidedBy: 'treasurer' };

  it('charges once a treasurer approved, and marks the approval paid', async () => {
    const { executor, approvalRows, auditRows } = setup({
      routes: { 'POST /v2/checkout/orders': () => paid('420.00') },
      approvals: { AP1: approved },
    });
    expect(await executor.executeApproved('AP1')).toMatchObject({ status: 'paid' });
    expect(approvalRows.get('AP1')?.status).toBe('paid');
    expect(auditRows[0]!.entry).toMatchObject({ actor: 'treasurer', action: 'spend.approved' });
  });

  it.each([['pending'], ['rejected'], ['paid']] as const)('refuses a %s approval', async (status) => {
    const { executor, fetch } = setup({ approvals: { AP1: { ...approved, status } } });
    expect(await executor.executeApproved('AP1')).toEqual({ status: 'refused', reason: 'not_approved' });
    expect(chargeCalls(fetch)).toHaveLength(0);
  });

  it('refuses an approval nobody decided or that does not exist', async () => {
    const { executor } = setup({ approvals: { AP1: { ...approved, decidedBy: undefined } } });
    expect(await executor.executeApproved('AP1')).toMatchObject({ status: 'refused' });
    expect(await executor.executeApproved('nope')).toMatchObject({ status: 'refused' });
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
    expect(chargeCalls(fetch)).toHaveLength(0);
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

  it('does nothing when there is no active wallet', async () => {
    const { executor } = setup({ wallet: false });
    expect(await executor.revokeWallet('treasurer')).toEqual({ revoked: false });
  });
});
