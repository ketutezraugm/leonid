import { z } from 'zod';
import { toPayPalApiError } from './errors.js';

// Sandbox only: there are no live PayPal keys anywhere in this project.
export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

// Refresh a minute early so a token never expires mid-request.
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export type PayPalApp = 'treasury' | 'procurement';

const TokenResponse = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
});

export interface PayPalClientOptions {
  app: PayPalApp;
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface PayPalRequest<T> {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  schema: z.ZodType<T>;
  body?: unknown;
  // Idempotency key derived from our own record ID; required on POSTs that create or move money.
  requestId?: string;
  // Sandbox negative testing: PayPal returns this error instead of processing the call.
  mockApplicationCode?: string;
}

export interface PayPalClient {
  readonly app: PayPalApp;
  getAccessToken(): Promise<string>;
  request<T>(req: PayPalRequest<T>): Promise<T>;
}

export function createPayPalClient(options: PayPalClientOptions): PayPalClient {
  const baseUrl = options.baseUrl ?? PAYPAL_SANDBOX_BASE_URL;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const basicAuth = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64');

  let cached: { token: string; refreshAt: number } | undefined;
  let inFlight: Promise<string> | undefined;

  async function fetchToken(): Promise<string> {
    const res = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const body = await readJson(res);
    if (!res.ok) throw toPayPalApiError(res.status, body, res.headers.get('paypal-debug-id'));
    const parsed = TokenResponse.parse(body);
    cached = {
      token: parsed.access_token,
      refreshAt: now() + parsed.expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS,
    };
    return parsed.access_token;
  }

  async function getAccessToken(): Promise<string> {
    if (cached && now() < cached.refreshAt) return cached.token;
    // Concurrent callers share one token request.
    inFlight ??= fetchToken().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  async function request<T>(req: PayPalRequest<T>): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: 'application/json',
    };
    if (req.body !== undefined) headers['Content-Type'] = 'application/json';
    if (req.requestId) headers['PayPal-Request-Id'] = req.requestId;
    if (req.mockApplicationCode) {
      headers['PayPal-Mock-Response'] = JSON.stringify({
        mock_application_codes: req.mockApplicationCode,
      });
    }

    const res = await fetchImpl(`${baseUrl}${req.path}`, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
    });
    const body = await readJson(res);
    if (!res.ok) {
      if (res.status === 401) cached = undefined;
      throw toPayPalApiError(res.status, body, res.headers.get('paypal-debug-id'));
    }
    return req.schema.parse(body);
  }

  return { app: options.app, getAccessToken, request };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const ENV_KEYS: Record<PayPalApp, { id: string; secret: string }> = {
  treasury: { id: 'PAYPAL_TREASURY_CLIENT_ID', secret: 'PAYPAL_TREASURY_CLIENT_SECRET' },
  procurement: { id: 'PAYPAL_PROCUREMENT_CLIENT_ID', secret: 'PAYPAL_PROCUREMENT_CLIENT_SECRET' },
};

const clients = new Map<PayPalApp, PayPalClient>();

export function isPayPalAppConfigured(
  app: PayPalApp,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env[ENV_KEYS[app].id] && env[ENV_KEYS[app].secret]);
}

// One client (and token cache) per PayPal app. Never mix treasury and procurement credentials.
export function getPayPalClient(app: PayPalApp): PayPalClient {
  const existing = clients.get(app);
  if (existing) return existing;
  const keys = ENV_KEYS[app];
  const clientId = process.env[keys.id];
  const clientSecret = process.env[keys.secret];
  if (!clientId || !clientSecret) {
    throw new Error(`PayPal ${app} app is not configured: set ${keys.id} and ${keys.secret}`);
  }
  const client = createPayPalClient({ app, clientId, clientSecret });
  clients.set(app, client);
  return client;
}
