import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createPayPalClient } from './client.js';
import { PayPalApiError, PayPalTimeoutError } from './errors.js';

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const token = (accessToken = 'tok-1', expiresIn = 3600) =>
  json(200, { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn });

function setup(responses: Response[], now = () => 0) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const res of responses) fetch.mockResolvedValueOnce(res);
  const client = createPayPalClient({
    app: 'treasury',
    clientId: 'id',
    clientSecret: 'secret',
    fetch,
    now,
  });
  return { client, fetch };
}

const Ok = z.object({ ok: z.boolean() });

describe('createPayPalClient', () => {
  it('exchanges client credentials for a token against the sandbox', async () => {
    const { client, fetch } = setup([token()]);
    await expect(client.getAccessToken()).resolves.toBe('tok-1');

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    expect(init?.body).toBe('grant_type=client_credentials');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Basic ${btoa('id:secret')}`);
  });

  it('caches the token until shortly before it expires', async () => {
    let clock = 0;
    const { client, fetch } = setup([token('tok-1', 3600), token('tok-2', 3600)], () => clock);

    await client.getAccessToken();
    clock = 3_500_000;
    await expect(client.getAccessToken()).resolves.toBe('tok-1');
    clock = 3_550_000;
    await expect(client.getAccessToken()).resolves.toBe('tok-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares one token request between concurrent callers', async () => {
    const { client, fetch } = setup([token()]);
    await Promise.all([client.getAccessToken(), client.getAccessToken()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends bearer auth, idempotency and mock-response headers', async () => {
    const { client, fetch } = setup([token(), json(201, { ok: true })]);
    await client.request({
      method: 'POST',
      path: '/v2/checkout/orders',
      schema: Ok,
      body: { a: 1 },
      requestId: 'order-abc',
      mockApplicationCode: 'INSTRUMENT_DECLINED',
    });

    const [url, init] = fetch.mock.calls[1]!;
    const headers = new Headers(init?.headers);
    expect(url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders');
    expect(headers.get('Authorization')).toBe('Bearer tok-1');
    expect(headers.get('PayPal-Request-Id')).toBe('order-abc');
    expect(headers.get('PayPal-Mock-Response')).toBe(
      '{"mock_application_codes":"INSTRUMENT_DECLINED"}',
    );
    expect(init?.body).toBe('{"a":1}');
  });

  it('turns the PayPal error envelope into a PayPalApiError with issue and debug_id', async () => {
    const { client } = setup([
      token(),
      json(422, {
        name: 'UNPROCESSABLE_ENTITY',
        message: 'The requested action could not be completed.',
        debug_id: '70c28ae654da',
        details: [{ issue: 'INSTRUMENT_DECLINED', description: 'The instrument was declined.' }],
      }),
    ]);
    const err = await client
      .request({ method: 'GET', path: '/x', schema: Ok })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err).toMatchObject({
      status: 422,
      errorName: 'UNPROCESSABLE_ENTITY',
      issue: 'INSTRUMENT_DECLINED',
      debugId: '70c28ae654da',
    });
    expect((err as Error).message).toContain('70c28ae654da');
  });

  it('reports OAuth failures with the debug id header', async () => {
    const { client } = setup([
      json(
        401,
        { error: 'invalid_client', error_description: 'Client Authentication failed' },
        { 'paypal-debug-id': 'dbg-1' },
      ),
    ]);
    await expect(client.getAccessToken()).rejects.toMatchObject({
      status: 401,
      errorName: 'invalid_client',
      debugId: 'dbg-1',
    });
  });

  it('drops the cached token after a 401 so the next call re-authenticates', async () => {
    const { client, fetch } = setup([
      token('tok-1'),
      json(401, { name: 'AUTHENTICATION_FAILURE', debug_id: 'd' }),
      token('tok-2'),
      json(200, { ok: true }),
    ]);
    await expect(client.request({ method: 'GET', path: '/x', schema: Ok })).rejects.toBeInstanceOf(
      PayPalApiError,
    );
    await client.request({ method: 'GET', path: '/x', schema: Ok });
    expect(new Headers(fetch.mock.calls[3]![1]?.headers).get('Authorization')).toBe('Bearer tok-2');
  });

  it('rejects responses that do not match the schema', async () => {
    const { client } = setup([token(), json(200, { ok: 'yes' })]);
    await expect(client.request({ method: 'GET', path: '/x', schema: Ok })).rejects.toThrow();
  });

  describe('timeout', () => {
    // A fetch that never answers on its own, but honours the abort signal like the real one.
    const hangs = (init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));

    it('gives up on a PayPal call that never answers, with a PayPalTimeoutError that is not a PayPal answer', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(token()).mockImplementationOnce((_url, init) => hangs(init));
      const client = createPayPalClient({ app: 'treasury', clientId: 'id', clientSecret: 'secret', fetch, timeoutMs: 20 });
      const err = await client.request({ method: 'POST', path: '/v2/checkout/orders', schema: Ok }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PayPalTimeoutError);
      expect(err).not.toBeInstanceOf(PayPalApiError);
      expect((err as Error).message).toBe('PayPal did not answer POST /v2/checkout/orders within 20 ms');
    });

    it('also times out the token request, and the next call fetches a fresh token instead of waiting on the dead one', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementationOnce((_url, init) => hangs(init))
        .mockResolvedValueOnce(token('tok-2'))
        .mockResolvedValueOnce(json(200, { ok: true }));
      const client = createPayPalClient({ app: 'treasury', clientId: 'id', clientSecret: 'secret', fetch, timeoutMs: 20 });
      await expect(client.getAccessToken()).rejects.toBeInstanceOf(PayPalTimeoutError);
      await expect(client.request({ method: 'GET', path: '/x', schema: Ok })).resolves.toEqual({ ok: true });
      expect(new Headers(fetch.mock.calls[2]![1]?.headers).get('Authorization')).toBe('Bearer tok-2');
    });

    it('does not time out a call that answers in time', async () => {
      const { client } = setup([token(), json(200, { ok: true })]);
      await expect(client.request({ method: 'GET', path: '/x', schema: Ok })).resolves.toEqual({ ok: true });
    });
  });
});
