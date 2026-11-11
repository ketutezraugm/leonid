import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildInvoiceBody, runInvoicing } from './invoicing.js';
import { buildPayoutBody, runPayouts } from './payouts.js';
import { runSearch } from './search.js';
import {
  PayPalError,
  createClient,
  loadTreasuryCredentials,
  parseArgs,
  searchWindow,
  toPayPalValue,
} from './lib.js';

type Call = { method: string; path: string; headers: Record<string, string>; body: unknown };
type Handler = (call: Call) => {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

// A stand-in for PayPal: routes are "METHOD /path", and an array answers each call in turn, repeating the last.
function fakePayPal(routes: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const counters = new Map<string, number>();
  let tokenCalls = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const key = `${method} ${url.pathname}`;
    if (key === 'POST /v1/oauth2/token') {
      tokenCalls++;
      return new Response(
        JSON.stringify({ access_token: `token-${tokenCalls}`, expires_in: 3600 }),
        { status: 200 },
      );
    }
    const entry = routes[key];
    if (!entry) throw new Error(`Unexpected call ${key}`);
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    const handler = Array.isArray(entry) ? entry[Math.min(n, entry.length - 1)]! : entry;
    const call: Call = {
      method,
      path: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const out = handler(call);
    return new Response(out.body === undefined ? '' : JSON.stringify(out.body), {
      status: out.status ?? 200,
      headers: { 'paypal-debug-id': 'dbg-1', ...out.headers },
    });
  }) as typeof fetch;
  const client = createClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  return { client, calls, tokenCalls: () => tokenCalls };
}

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

const statusOf = (results: { step: string; status: string }[], step: string) =>
  results.find((r) => r.step === step)?.status;

describe('money and dates', () => {
  it('converts integer cents to PayPal decimal strings', () => {
    expect(toPayPalValue(14000, 'USD')).toBe('140.00');
    expect(toPayPalValue(100, 'USD')).toBe('1.00');
    expect(toPayPalValue(5, 'USD')).toBe('0.05');
    expect(toPayPalValue(0, 'USD')).toBe('0.00');
    expect(toPayPalValue(500, 'JPY')).toBe('500');
  });

  it('rejects floats and negatives', () => {
    expect(() => toPayPalValue(1.5, 'USD')).toThrow();
    expect(() => toPayPalValue(-1, 'USD')).toThrow();
  });

  it('builds a Transaction Search window without fractional seconds', () => {
    const w = searchWindow(new Date('2026-10-27T10:00:00.789Z'), 7);
    expect(w).toEqual({ start: '2026-10-20T10:00:00Z', end: '2026-10-27T10:00:00Z' });
  });

  it('rejects windows over 31 days', () => {
    expect(() => searchWindow(new Date(), 32)).toThrow(/31/);
    expect(() => searchWindow(new Date(), 0)).toThrow();
  });
});

describe('config', () => {
  it('names the missing Treasury credential', () => {
    expect(() => loadTreasuryCredentials({})).toThrow(/PAYPAL_TREASURY_CLIENT_ID/);
  });

  it('reads Treasury credentials', () => {
    const env = { PAYPAL_TREASURY_CLIENT_ID: 'a', PAYPAL_TREASURY_CLIENT_SECRET: 'b' };
    expect(loadTreasuryCredentials(env)).toEqual({ clientId: 'a', clientSecret: 'b' });
  });

  it('parses flags with and without values', () => {
    expect(parseArgs(['--invoice-id', 'INV2-1', '--no-wait'])).toEqual({
      'invoice-id': 'INV2-1',
      'no-wait': true,
    });
  });
});

describe('client', () => {
  it('mints a fresh token once after a 401', async () => {
    const { client, tokenCalls } = fakePayPal({
      'GET /v1/ping': [
        () => ({ status: 401, body: { name: 'AUTHENTICATION_FAILURE' } }),
        () => ({ body: { ok: true } }),
      ],
    });
    const res = await client.request('GET', '/v1/ping', z.object({ ok: z.boolean() }));
    expect(res.data.ok).toBe(true);
    expect(tokenCalls()).toBe(2);
  });

  it('carries the debug id on errors', async () => {
    const { client } = fakePayPal({
      'GET /v1/ping': () => ({
        status: 403,
        body: { name: 'NOT_AUTHORIZED' },
        headers: { 'paypal-debug-id': 'abc123' },
      }),
    });
    const err = await client.request('GET', '/v1/ping', z.unknown()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect((err as PayPalError).debugId).toBe('abc123');
    expect((err as PayPalError).status).toBe(403);
  });
});

describe('invoicing', () => {
  const baseOpts = {
    recipientEmail: 'sponsor@example.com',
    amountCents: 100,
    waitMinutes: 10,
    now: new Date('2026-10-27T10:00:00Z'),
  };
  const hooks = {
    webhooks: [
      {
        id: 'WH-1',
        url: 'https://example.com/hook',
        event_types: [{ name: 'INVOICING.INVOICE.PAID' }],
      },
    ],
  };
  const invoice = (status: string) => () => ({
    body: {
      id: 'INV2-1',
      status,
      detail: {
        invoice_number: '0001',
        metadata: { recipient_view_url: 'https://sandbox.example/pay' },
      },
    },
  });

  it('builds a draft body that matches the Invoicing v2 schema', () => {
    const body = buildInvoiceBody('sponsor@example.com', 100, new Date('2026-10-27T10:00:00Z'));
    expect(body.detail.currency_code).toBe('USD');
    expect(body.detail.invoice_date).toBe('2026-10-27');
    expect(body.items[0]?.quantity).toBe('1');
    expect(body.items[0]?.unit_amount).toEqual({ currency_code: 'USD', value: '1.00' });
    expect(body.primary_recipients[0]?.billing_info.email_address).toBe('sponsor@example.com');
  });

  it('creates, sends, waits for payment and finds the webhook event', async () => {
    const { client, calls } = fakePayPal({
      'GET /v1/notifications/webhooks': () => ({ body: hooks }),
      'POST /v2/invoicing/invoices': () => ({ status: 201, body: { id: 'INV2-1' } }),
      'POST /v2/invoicing/invoices/INV2-1/send': () => ({
        status: 202,
        body: { rel: 'self', href: 'x' },
      }),
      'GET /v2/invoicing/invoices/INV2-1': [invoice('SENT'), invoice('SENT'), invoice('PAID')],
      'GET /v1/notifications/webhooks-events': () => ({
        body: {
          events: [
            {
              id: 'WH-EVT-1',
              event_type: 'INVOICING.INVOICE.PAID',
              create_time: '2026-10-27T10:05:00Z',
              resource: { invoice: { id: 'INV2-1' } },
            },
          ],
        },
      }),
    });
    const lines: string[] = [];
    const results = await runInvoicing(client, {
      ...baseOpts,
      log: (l) => lines.push(l),
      clock: fakeClock(),
    });

    expect(statusOf(results, 'invoicing.create')).toBe('PASS');
    expect(statusOf(results, 'invoicing.send')).toBe('PASS');
    expect(statusOf(results, 'invoicing.paid')).toBe('PASS');
    expect(statusOf(results, 'invoicing.webhook-event')).toBe('PASS');
    expect(
      calls.find((c) => c.method === 'POST' && c.path === '/v2/invoicing/invoices')?.headers.prefer,
    ).toBe('return=representation');
    expect(lines.join('\n')).toContain('https://sandbox.example/pay');
  });

  it('reads the invoice id from a self link when create returns only a link', async () => {
    const { client } = fakePayPal({
      'GET /v1/notifications/webhooks': () => ({ body: hooks }),
      'POST /v2/invoicing/invoices': () => ({
        status: 201,
        body: {
          rel: 'self',
          href: 'https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-1',
          method: 'GET',
        },
      }),
      'POST /v2/invoicing/invoices/INV2-1/send': () => ({ status: 200, body: {} }),
      'GET /v2/invoicing/invoices/INV2-1': invoice('SENT'),
    });
    const results = await runInvoicing(client, { ...baseOpts, waitMinutes: 0, log: () => {} });
    expect(results.find((r) => r.step === 'invoicing.create')?.detail).toContain('INV2-1');
  });

  it('resumes an existing invoice without creating another', async () => {
    const { client, calls } = fakePayPal({
      'GET /v1/notifications/webhooks': () => ({ body: hooks }),
      'GET /v2/invoicing/invoices/INV2-1': invoice('PAID'),
      'GET /v1/notifications/webhooks-events': () => ({
        body: {
          events: [
            {
              id: 'E',
              event_type: 'INVOICING.INVOICE.PAID',
              create_time: 't',
              resource: { id: 'INV2-1' },
            },
          ],
        },
      }),
    });
    const results = await runInvoicing(client, {
      ...baseOpts,
      invoiceId: 'INV2-1',
      log: () => {},
      clock: fakeClock(),
    });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(statusOf(results, 'invoicing.paid')).toBe('PASS');
  });

  it('warns when no webhook is subscribed to INVOICING.INVOICE.PAID', async () => {
    const { client } = fakePayPal({
      'GET /v1/notifications/webhooks': () => ({ body: { webhooks: [] } }),
      'GET /v2/invoicing/invoices/INV2-1': invoice('SENT'),
    });
    const results = await runInvoicing(client, {
      ...baseOpts,
      invoiceId: 'INV2-1',
      waitMinutes: 0,
      log: () => {},
    });
    expect(statusOf(results, 'invoicing.webhook-registered')).toBe('WARN');
  });

  it('skips the event check, without calling the events API, when no webhook is subscribed', async () => {
    const { client } = fakePayPal({
      'GET /v1/notifications/webhooks': () => ({ body: { webhooks: [] } }),
      'GET /v2/invoicing/invoices/INV2-1': invoice('PAID'),
    });
    const results = await runInvoicing(client, {
      ...baseOpts,
      invoiceId: 'INV2-1',
      log: () => {},
      clock: fakeClock(),
    });
    expect(statusOf(results, 'invoicing.paid')).toBe('PASS');
    expect(statusOf(results, 'invoicing.webhook-event')).toBe('SKIP');
  });

  it('fails with the invoice id to resume when payment never arrives', async () => {
    const { client } = fakePayPal({
      'GET /v1/notifications/webhooks': () => ({ body: hooks }),
      'GET /v2/invoicing/invoices/INV2-1': invoice('SENT'),
    });
    const results = await runInvoicing(client, {
      ...baseOpts,
      invoiceId: 'INV2-1',
      waitMinutes: 1,
      log: () => {},
      clock: fakeClock(),
    });
    const paid = results.find((r) => r.step === 'invoicing.paid');
    expect(paid?.status).toBe('FAIL');
    expect(paid?.detail).toContain('--invoice-id INV2-1');
  });

  it('fails the webhook step when PayPal generated no event', async () => {
    const { client } = fakePayPal({
      'GET /v1/notifications/webhooks': () => ({ body: hooks }),
      'GET /v2/invoicing/invoices/INV2-1': invoice('PAID'),
      'GET /v1/notifications/webhooks-events': () => ({ body: { events: [] } }),
    });
    const results = await runInvoicing(client, {
      ...baseOpts,
      invoiceId: 'INV2-1',
      log: () => {},
      clock: fakeClock(),
    });
    expect(statusOf(results, 'invoicing.webhook-event')).toBe('FAIL');
  });
});

describe('payouts', () => {
  const batchOpts = {
    senderBatchId: 'day1-test',
    amountCents: 100,
    paypalEmail: 'payee@example.com',
    waitMinutes: 3,
  };
  const created = (id: string) => () => ({
    status: 201,
    body: { batch_header: { payout_batch_id: id, batch_status: 'PENDING' } },
  });
  const batch = (id: string, status: string, itemStatus: string) => () => ({
    body: {
      batch_header: { payout_batch_id: id, batch_status: status },
      items: [
        {
          payout_item_id: 'I1',
          transaction_status: itemStatus,
          payout_item: { receiver: 'payee@example.com' },
        },
      ],
    },
  });
  const events = {
    body: {
      events: [
        {
          id: 'E',
          event_type: 'PAYMENT.PAYOUTSBATCH.SUCCESS',
          create_time: 't',
          resource: { batch_header: { payout_batch_id: 'PB-1' } },
        },
      ],
    },
  };

  it('builds one PayPal email item with stable ids', () => {
    const body = buildPayoutBody(batchOpts);
    expect(body.sender_batch_header.sender_batch_id).toBe('day1-test');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      recipient_type: 'EMAIL',
      receiver: 'payee@example.com',
      recipient_wallet: 'PAYPAL',
      amount: { currency: 'USD', value: '1.00' },
      sender_item_id: 'day1-test-paypal',
    });
  });

  it('keeps sender_item_id within the 63 character limit', () => {
    const body = buildPayoutBody({ ...batchOpts, senderBatchId: 'x'.repeat(100) });
    for (const item of body.items)
      expect((item.sender_item_id as string).length).toBeLessThanOrEqual(63);
  });

  it('sends the batch id as PayPal-Request-Id and waits for SUCCESS', async () => {
    const { client, calls } = fakePayPal({
      'POST /v1/payments/payouts': created('PB-1'),
      'GET /v1/payments/payouts/PB-1': [
        batch('PB-1', 'PROCESSING', 'PENDING'),
        batch('PB-1', 'SUCCESS', 'SUCCESS'),
      ],
      'GET /v1/notifications/webhooks-events': () => events,
    });
    const results = await runPayouts(client, { ...batchOpts, log: () => {}, clock: fakeClock() });
    expect(calls.find((c) => c.method === 'POST')?.headers['paypal-request-id']).toBe('day1-test');
    expect(statusOf(results, 'payouts.batch')).toBe('PASS');
    expect(statusOf(results, 'payouts.webhook-event')).toBe('PASS');
  });

  it('fails once, and sends no second batch, when PayPal rejects the batch', async () => {
    const { client, calls } = fakePayPal({
      'POST /v1/payments/payouts': () => ({
        status: 422,
        body: { name: 'USER_BUSINESS_ERROR', message: 'Rejected' },
      }),
    });
    const results = await runPayouts(client, { ...batchOpts, log: () => {}, clock: fakeClock() });
    expect(statusOf(results, 'payouts.run')).toBe('FAIL');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('fails when the batch ends DENIED', async () => {
    const { client } = fakePayPal({
      'POST /v1/payments/payouts': created('PB-4'),
      'GET /v1/payments/payouts/PB-4': batch('PB-4', 'DENIED', 'BLOCKED'),
    });
    const results = await runPayouts(client, { ...batchOpts, log: () => {}, clock: fakeClock() });
    expect(statusOf(results, 'payouts.batch')).toBe('FAIL');
  });
});

describe('transaction search', () => {
  const now = new Date('2026-10-27T10:00:00Z');

  it('queries one window with fields=all and reports the rows', async () => {
    const { client, calls } = fakePayPal({
      'GET /v1/reporting/transactions': () => ({
        body: {
          transaction_details: [
            {
              transaction_info: {
                transaction_id: 'T1',
                transaction_event_code: 'T0006',
                transaction_status: 'S',
                invoice_id: 'INV2-1',
                transaction_amount: { currency_code: 'USD', value: '1.00' },
              },
            },
          ],
          total_pages: 1,
          last_refreshed_datetime: '2026-10-27T09:00:00Z',
        },
      }),
    });
    const results = await runSearch(client, { days: 7, now, log: () => {} });
    expect(statusOf(results, 'search.query')).toBe('PASS');
    expect(results[0]?.detail).toContain('1 transactions');
    expect(calls[0]?.path).toContain('start_date=2026-10-20T10%3A00%3A00Z');
    expect(calls[0]?.path).toContain('fields=all');
  });

  it('treats an empty sandbox as a pass with a warning', async () => {
    const { client } = fakePayPal({
      'GET /v1/reporting/transactions': () => ({
        body: { transaction_details: [], total_pages: 0 },
      }),
    });
    const results = await runSearch(client, { days: 7, now, log: () => {} });
    expect(statusOf(results, 'search.query')).toBe('PASS');
    expect(statusOf(results, 'search.data')).toBe('WARN');
  });

  it('tells the user to enable the feature on a 403', async () => {
    const { client } = fakePayPal({
      'GET /v1/reporting/transactions': () => ({ status: 403, body: { name: 'NOT_AUTHORIZED' } }),
    });
    const results = await runSearch(client, { days: 7, now, log: () => {} });
    expect(statusOf(results, 'search.query')).toBe('FAIL');
    expect(results[0]?.detail).toContain('Transaction Search feature');
  });

  it('fails on an out-of-range window before calling PayPal', async () => {
    const { client, calls } = fakePayPal({});
    const results = await runSearch(client, { days: 45, now, log: () => {} });
    expect(statusOf(results, 'search.query')).toBe('FAIL');
    expect(calls).toHaveLength(0);
  });
});
