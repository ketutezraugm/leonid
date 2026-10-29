import { describe, expect, it, vi } from 'vitest';
import { createExecutor } from '../payments/executor.js';
import { createMemoryApprovals, createMemoryAudit, createMemoryReferences, createMemoryWalletStore } from '../payments/memory.js';
import { stubCheck } from '../payments/stub-check.js';
import { createPayPalClient } from '../paypal/client.js';
import { orderApprovedHandler } from './orderApproved.js';
import type { WebhookEvent } from './registry.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const order = (status: string) => () =>
  json(200, { id: 'ORD-1', status, purchase_units: [{ amount: { currency_code: 'USD', value: '420.00' } }], links: [] });
const spend = { referenceId: 'prizes-1', amountMinor: 42000, currency: 'USD', actor: 'procurement-agent', reason: 'prize cart' };
const event = (orderId = 'ORD-1'): WebhookEvent => ({ id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: orderId } });

async function build(orderState: () => Response) {
  const calls: string[] = [];
  const routes: Record<string, () => Response> = {
    'POST /v2/checkout/orders': () =>
      json(201, { id: 'ORD-1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD-1' }] }),
    'GET /v2/checkout/orders/ORD-1': orderState,
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
  await wallet.activate({ paymentTokenId: 'pt_1' });
  const approvals = createMemoryApprovals();
  const executor = createExecutor({ client, check: stubCheck, audit: createMemoryAudit(), wallet, approvals, references: createMemoryReferences() });
  await executor.requestSpend(spend); // opens approval-1 with order ORD-1
  const handler = orderApprovedHandler(() => ({ approvals, executor }));
  return { handler, calls, approvals, wallet };
}

const captured = (calls: string[]) => calls.includes('POST /v2/checkout/orders/ORD-1/capture');

describe('CHECKOUT.ORDER.APPROVED backup capture', () => {
  it('captures the order of a pending approval, and a repeat of the event captures nothing more', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handler, calls, approvals } = await build(order('APPROVED'));
    await handler(event(), { app: 'procurement' });
    expect(captured(calls)).toBe(true);
    expect((await approvals.get('approval-1'))?.status).toBe('paid');

    calls.length = 0;
    await handler(event(), { app: 'procurement' });
    expect(calls).toEqual([]);
  });

  it('ignores other apps, orders that are not ours, and malformed events, without calling PayPal', async () => {
    const { handler, calls } = await build(order('APPROVED'));
    calls.length = 0;
    await handler(event(), { app: 'treasury' });
    await handler(event('SOMEONE-ELSES-ORDER'), { app: 'procurement' });
    await handler({ ...event(), resource: { nope: true } }, { app: 'procurement' });
    await handler({ ...event(), resource: null }, { app: 'procurement' });
    expect(calls).toEqual([]);
  });

  it('does not trust the event: if PayPal says the order is not approved, nothing is captured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handler, calls, approvals } = await build(order('PAYER_ACTION_REQUIRED'));
    await handler(event(), { app: 'procurement' });
    expect(captured(calls)).toBe(false);
    expect((await approvals.get('approval-1'))?.status).toBe('pending');
    expect(warn).toHaveBeenCalled();
  });

  it('captures nothing once the kill switch has been used after the approval was opened', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handler, calls, wallet, approvals } = await build(order('APPROVED'));
    await wallet.markRevoked();
    await handler(event(), { app: 'procurement' });
    expect(captured(calls)).toBe(false);
    expect((await approvals.get('approval-1'))?.status).toBe('pending');
  });
});
