import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createPayPalClient, fromPayPalValue, PayPalError, toPayPalAmount } from './core.js';

describe('amounts', () => {
  it('converts cents to PayPal strings', () => {
    expect(toPayPalAmount(14000)).toEqual({ currency_code: 'USD', value: '140.00' });
    expect(toPayPalAmount(5)).toEqual({ currency_code: 'USD', value: '0.05' });
    expect(toPayPalAmount(0)).toEqual({ currency_code: 'USD', value: '0.00' });
  });
  it('rejects floats and negatives', () => {
    expect(() => toPayPalAmount(1.5)).toThrow();
    expect(() => toPayPalAmount(-1)).toThrow();
  });
  it('parses PayPal strings back to cents', () => {
    expect(fromPayPalValue('420.00')).toBe(42000);
    expect(() => fromPayPalValue('4.2')).toThrow();
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

describe('client', () => {
  const tokenBody = { access_token: 'tok', expires_in: 3600 };

  it('caches the token and refreshes it before expiry', async () => {
    let t = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/v1/oauth2/token') ? jsonResponse(tokenBody) : jsonResponse({ ok: true }),
    );
    const client = createPayPalClient({
      app: 'treasury',
      clientId: 'id',
      clientSecret: 'secret',
      fetch: fetchMock as unknown as typeof fetch,
      now: () => t,
    });
    const schema = z.object({ ok: z.boolean() });
    await client.request('GET', '/x', schema);
    await client.request('GET', '/x', schema);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/v1/oauth2/token'))).toHaveLength(1);
    t = 3600 * 1000; // past expires_in minus the safety margin
    await client.request('GET', '/x', schema);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/v1/oauth2/token'))).toHaveLength(2);
  });

  it('refuses a POST without a request id', async () => {
    const client = createPayPalClient({ app: 'procurement', clientId: 'id', clientSecret: 's', fetch: vi.fn() as never });
    await expect(client.request('POST', '/v2/checkout/orders', z.unknown(), { body: {} })).rejects.toThrow('requestId');
  });

  it('sends PayPal-Request-Id and raises PayPalError with the debug id', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/v1/oauth2/token')) return jsonResponse(tokenBody);
      return jsonResponse({ name: 'NOT_AUTHORIZED' }, { status: 403, headers: { 'paypal-debug-id': 'dbg123' } });
    });
    const client = createPayPalClient({
      app: 'procurement',
      clientId: 'id',
      clientSecret: 's',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const err = await client.request('POST', '/v2/checkout/orders', z.unknown(), { body: {}, requestId: 'cart-1' }).catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({ status: 403, debugId: 'dbg123' });
    const orderCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/v2/checkout/orders'));
    expect((orderCall?.[1]?.headers as Record<string, string>)['PayPal-Request-Id']).toBe('cart-1');
  });
});
