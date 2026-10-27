import { z } from 'zod';

// Money is integer cents inside our code. It is converted to PayPal's string amount only here.
export function toPayPalAmount(cents: number, currency = 'USD') {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`invalid amount in cents: ${cents}`);
  // ponytail: assumes a 2-decimal currency; zero-decimal ones (JPY, HUF, TWD) need their own handling
  return { currency_code: currency, value: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` };
}

export function fromPayPalValue(value: string): number {
  const m = /^(\d+)\.(\d{2})$/.exec(value);
  if (!m) throw new Error(`unexpected PayPal amount: ${value}`);
  return Number(m[1]) * 100 + Number(m[2]);
}

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly debugId: string | undefined,
    readonly body: unknown,
  ) {
    super(`PayPal ${status} (debug_id ${debugId ?? 'n/a'})`);
  }
}

export type PayPalApp = 'treasury' | 'procurement';

export interface PayPalClientOptions {
  app: PayPalApp;
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

const TokenResponse = z.object({ access_token: z.string(), expires_in: z.number() });

// One client per PayPal app. Never mix them: money in lands in the treasury, procurement holds the agent wallet.
export function createPayPalClient(opts: PayPalClientOptions) {
  const baseUrl = opts.baseUrl ?? 'https://api-m.sandbox.paypal.com';
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let token: { value: string; expiresAt: number } | undefined;

  async function send(url: string, init: RequestInit): Promise<unknown> {
    const res = await doFetch(url, init);
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new PayPalError(res.status, res.headers.get('paypal-debug-id') ?? undefined, json);
    return json;
  }

  async function accessToken(): Promise<string> {
    if (token && now() < token.expiresAt) return token.value;
    const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');
    const json = await send(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const t = TokenResponse.parse(json);
    token = { value: t.access_token, expiresAt: now() + (t.expires_in - 60) * 1000 };
    return token.value;
  }

  // requestId (PayPal-Request-Id) is required on every POST and must come from our own record id,
  // so a retry can never double-charge or double-pay.
  async function request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    schema: z.ZodType<T>,
    extra: { body?: unknown; requestId?: string } = {},
  ): Promise<T> {
    if (method === 'POST' && !extra.requestId) throw new Error(`POST ${path} needs a requestId`);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
    };
    if (extra.requestId) headers['PayPal-Request-Id'] = extra.requestId;
    const json = await send(`${baseUrl}${path}`, {
      method,
      headers,
      body: extra.body === undefined ? undefined : JSON.stringify(extra.body),
    });
    return schema.parse(json);
  }

  return { app: opts.app, request };
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;
