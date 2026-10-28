// Day-1 sandbox checks from PRD §14, owned by P3. This is throwaway test tooling, not the
// production PayPal client: that lives in src/paypal/ and is owned by P2.
//
// The payouts check moves sandbox money outside the rules engine because the engine does not exist
// yet and the PRD asks for exactly this test. Production payouts, refunds and captures go only
// through the rules-engine executor (see .claude/rules/money-safety.md).

import { z } from 'zod';

// Hard-coded on purpose, so these scripts can never reach live PayPal.
export const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

export type Status = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
export type StepResult = { step: string; status: Status; detail: string };

export const formatResult = (r: StepResult) => `RESULT ${r.step} ${r.status} ${r.detail}`;

export const hasFailure = (results: StepResult[]) => results.some((r) => r.status === 'FAIL');

// --- Money and dates -----------------------------------------------------------------

// Currencies PayPal takes without decimals.
const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);

// Integer minor units to PayPal's decimal string: (14000, 'USD') -> '140.00'.
export function toPayPalValue(minor: number, currency: string): string {
  if (!Number.isInteger(minor) || minor < 0)
    throw new Error(`Amount must be a non-negative integer of minor units, got ${minor}`);
  if (ZERO_DECIMAL.has(currency)) return String(minor);
  const whole = Math.trunc(minor / 100);
  const cents = String(minor % 100).padStart(2, '0');
  return `${whole}.${cents}`;
}

// Transaction Search rejects fractional seconds.
export const toPayPalTimestamp = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

export const TRANSACTION_SEARCH_MAX_DAYS = 31;

export function searchWindow(now: Date, days: number): { start: string; end: string } {
  if (!Number.isInteger(days) || days < 1 || days > TRANSACTION_SEARCH_MAX_DAYS) {
    throw new Error(
      `Transaction Search covers 1 to ${TRANSACTION_SEARCH_MAX_DAYS} days per request, got ${days}`,
    );
  }
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: toPayPalTimestamp(start), end: toPayPalTimestamp(now) };
}

// --- Config --------------------------------------------------------------------------

const Credentials = z.object({
  PAYPAL_TREASURY_CLIENT_ID: z.string().min(1),
  PAYPAL_TREASURY_CLIENT_SECRET: z.string().min(1),
});

export function loadTreasuryCredentials(env: NodeJS.ProcessEnv = process.env) {
  const parsed = Credentials.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(
      `Missing ${missing}. Copy .env.example to .env and fill in the sandbox Treasury app credentials.`,
    );
  }
  return {
    clientId: parsed.data.PAYPAL_TREASURY_CLIENT_ID,
    clientSecret: parsed.data.PAYPAL_TREASURY_CLIENT_SECRET,
  };
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value) throw new Error(`Set ${name} in .env (see the Day-1 section of .env.example).`);
  return value;
}

// --- PayPal HTTP ---------------------------------------------------------------------

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly debugId: string | null,
    readonly body: string,
  ) {
    super(`PayPal ${status} on ${path} (debug_id ${debugId ?? 'n/a'}): ${body.slice(0, 500)}`);
    this.name = 'PayPalError';
  }
}

const TokenResponse = z.object({ access_token: z.string(), expires_in: z.number() });

export type RequestOptions = { body?: unknown; headers?: Record<string, string> };
export type Response<T> = { status: number; data: T; debugId: string | null };

export type PayPalClient = {
  request<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    options?: RequestOptions,
  ): Promise<Response<z.infer<S>>>;
};

export function createClient(opts: {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): PayPalClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  let token: { value: string; expiresAt: number } | undefined;

  async function accessToken(): Promise<string> {
    if (token && now() < token.expiresAt) return token.value;
    const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');
    const res = await fetchImpl(`${SANDBOX_BASE_URL}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const text = await res.text();
    if (!res.ok)
      throw new PayPalError(
        res.status,
        '/v1/oauth2/token',
        res.headers.get('paypal-debug-id'),
        text,
      );
    const parsed = TokenResponse.parse(JSON.parse(text));
    // Refresh a minute early so an in-flight call never carries an expired token.
    token = { value: parsed.access_token, expiresAt: now() + (parsed.expires_in - 60) * 1000 };
    return token.value;
  }

  async function request<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    options: RequestOptions = {},
  ) {
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(`${SANDBOX_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
        ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
      });
      const text = await res.text();
      const debugId = res.headers.get('paypal-debug-id');
      // A revoked or expired token: drop it and mint a new one once.
      if (res.status === 401 && attempt === 1) {
        token = undefined;
        continue;
      }
      if (!res.ok) throw new PayPalError(res.status, path, debugId, text);
      const data = schema.parse(text ? JSON.parse(text) : {});
      return { status: res.status, data, debugId };
    }
  }

  return { request };
}

// --- Polling -------------------------------------------------------------------------

export type Clock = { sleep: (ms: number) => Promise<void>; now: () => number };
export const realClock: Clock = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date.now,
};

export async function pollUntil<T>(
  clock: Clock,
  fn: () => Promise<T>,
  done: (value: T) => boolean,
  opts: { intervalMs: number; timeoutMs: number },
): Promise<{ value: T; timedOut: boolean }> {
  const deadline = clock.now() + opts.timeoutMs;
  for (;;) {
    const value = await fn();
    if (done(value)) return { value, timedOut: false };
    if (clock.now() >= deadline) return { value, timedOut: true };
    await clock.sleep(opts.intervalMs);
  }
}

// --- Webhook helpers -----------------------------------------------------------------

const WebhookList = z.object({
  webhooks: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      event_types: z.array(z.object({ name: z.string() })),
    }),
  ),
});

// Registered webhooks that would receive `eventType`. PayPal only creates events for subscribed types.
export async function webhooksFor(client: PayPalClient, eventType: string) {
  const { data } = await client.request('GET', '/v1/notifications/webhooks', WebhookList);
  return data.webhooks.filter((w) =>
    w.event_types.some((t) => t.name === eventType || t.name === '*'),
  );
}

const WebhookEvents = z.object({
  events: z
    .array(
      z.object({
        id: z.string(),
        event_type: z.string(),
        create_time: z.string(),
        resource: z.unknown(),
      }),
    )
    .default([]),
});

// Events PayPal generated for `eventType` whose resource mentions `needle` (an invoice or batch ID).
export async function findEvents(client: PayPalClient, eventType: string, needle: string) {
  const { data } = await client.request(
    'GET',
    `/v1/notifications/webhooks-events?event_type=${encodeURIComponent(eventType)}&page_size=50`,
    WebhookEvents,
  );
  return data.events.filter((e) => JSON.stringify(e.resource ?? {}).includes(needle));
}

export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[arg.slice(2)] = next;
      i++;
    } else out[arg.slice(2)] = true;
  }
  return out;
}
