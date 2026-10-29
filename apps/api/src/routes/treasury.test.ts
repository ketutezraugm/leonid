import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { TreasuryResponse } from '@quartermaster/shared';
import { createPayPalClient } from '../paypal/client.js';
import { fromPayPalSignedMoney } from '../paypal/money.js';
import { treasuryRouter } from './treasury.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const env = { TREASURER_TOKEN: 'letmein' };
const treasurer = { 'x-treasurer-token': 'letmein' };

// Shape copied from the sandbox: GET /v1/reporting/balances on the Treasury app.
const sandboxBalances = {
  balances: [
    {
      currency: 'USD',
      total_balance: { currency_code: 'USD', value: '5211.57' },
      available_balance: { currency_code: 'USD', value: '5211.57' },
      withheld_balance: { currency_code: 'USD', value: '0.00' },
    },
  ],
  account_id: 'ACCT123',
  as_of_time: '2026-10-29T03:59:59Z',
  last_refresh_time: '2026-10-29T03:59:59Z',
};

function build(balances: () => Response, e: NodeJS.ProcessEnv = env) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/oauth2/token') return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
    if (path === '/v1/reporting/balances') return balances();
    throw new Error(`unexpected PayPal call: ${path}`);
  });
  const client = createPayPalClient({ app: 'treasury', clientId: 'i', clientSecret: 's', fetch });
  const app = express();
  app.use('/api/treasury', treasuryRouter({ env: e, client: () => client }));
  return app;
}

describe('GET /api/treasury', () => {
  it('is treasurer only', async () => {
    const app = build(() => json(200, sandboxBalances));
    expect((await request(app).get('/api/treasury')).status).toBe(401);
    expect((await request(app).get('/api/treasury').set('x-treasurer-token', 'nope')).status).toBe(401);
  });

  it('returns the balances in minor units, with the merchant id and when PayPal refreshed them', async () => {
    const res = await request(build(() => json(200, sandboxBalances))).get('/api/treasury').set(treasurer);
    expect(res.status).toBe(200);
    expect(TreasuryResponse.parse(res.body)).toEqual({
      merchantId: 'ACCT123',
      asOf: '2026-10-29T03:59:59Z',
      balances: [{ currency: 'USD', totalMinor: 521_157, availableMinor: 521_157, withheldMinor: 0 }],
    });
  });

  it('handles a negative balance with no available amount, and an account with no balances at all', async () => {
    const negative = { ...sandboxBalances, balances: [{ currency: 'USD', total_balance: { currency_code: 'USD', value: '-12.05' } }] };
    const a = await request(build(() => json(200, negative))).get('/api/treasury').set(treasurer);
    // available_balance missing: null, not the total.
    expect(TreasuryResponse.parse(a.body).balances).toEqual([{ currency: 'USD', totalMinor: -1205, availableMinor: null, withheldMinor: 0 }]);

    const none = await request(build(() => json(200, { account_id: 'ACCT123', as_of_time: '2026-10-29T03:59:59Z' }))).get('/api/treasury').set(treasurer);
    expect(none.status).toBe(200);
    expect(none.body.balances).toEqual([]);
  });

  it('skips a balance it cannot convert (zero-decimal or malformed) and keeps the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mixed = {
      ...sandboxBalances,
      balances: [
        ...sandboxBalances.balances,
        { currency: 'JPY', total_balance: { currency_code: 'JPY', value: '1500' }, available_balance: { currency_code: 'JPY', value: '1500' } },
        { currency: 'EUR', total_balance: { currency_code: 'EUR', value: 'not-a-number' } },
      ],
    };
    const res = await request(build(() => json(200, mixed))).get('/api/treasury').set(treasurer);
    expect(res.status).toBe(200);
    expect(TreasuryResponse.parse(res.body).balances).toEqual([
      { currency: 'USD', totalMinor: 521_157, availableMinor: 521_157, withheldMinor: 0 },
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('not-a-number');
    warn.mockRestore();
  });

  it('answers 502 when PayPal sends a response shape it does not recognize', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const malformed = { balances: [{ currency: 'USD', total_balance: { currency_code: 'usd', value: 12 } }] };
    const res = await request(build(() => json(200, malformed))).get('/api/treasury').set(treasurer);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'treasury request failed' });
    error.mockRestore();
  });

  it('answers 502 when PayPal refuses, without leaking its message, and 503 when the Treasury app is not configured', async () => {
    const refused = await request(build(() => json(403, { name: 'NOT_AUTHORIZED', message: 'secret detail', debug_id: 'd1' }))).get('/api/treasury').set(treasurer);
    expect(refused.status).toBe(502);
    expect(JSON.stringify(refused.body)).not.toContain('secret detail');

    const bare = express();
    bare.use('/api/treasury', treasuryRouter({ env }));
    expect((await request(bare).get('/api/treasury').set(treasurer)).status).toBe(503);
  });
});

describe('fromPayPalSignedMoney', () => {
  it('reads negative and positive balances', () => {
    expect(fromPayPalSignedMoney({ currency_code: 'USD', value: '-0.05' })).toEqual({ amountMinor: -5, currency: 'USD' });
    expect(fromPayPalSignedMoney({ currency_code: 'USD', value: '140.00' })).toEqual({ amountMinor: 14_000, currency: 'USD' });
  });
});
