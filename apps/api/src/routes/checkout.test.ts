import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutCaptureResponse, CheckoutConfig, CheckoutOrderResponse } from '@quartermaster/shared';
import { events } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import type { Db } from '../db/client.js';
import { createPayPalClient } from '../paypal/client.js';
import { eq } from 'drizzle-orm';
import { checkoutRouter } from './checkout.js';
import { createRateLimiter } from './rateLimit.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const env = { PAYPAL_TREASURY_CLIENT_ID: 'treasury-client-id' };

let db: Db;
let eventId: string;
beforeEach(async () => {
  db = await createTestDb();
  eventId = (await seedDemoEvent(db)).id;
});

interface Behaviour {
  order?: { status: string; customId?: string };
  capture?: () => Response;
  create?: () => Response;
}

function build(b: Behaviour = {}, limiterMax = 100) {
  const calls: { key: string; requestId: string | null; body: { purchase_units: { custom_id?: string; amount: { currency_code: string; value: string } }[] } | null }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/oauth2/token') return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
    const key = `${init?.method} ${path}`;
    calls.push({ key, requestId: new Headers(init?.headers).get('PayPal-Request-Id'), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (key === 'POST /v2/checkout/orders') {
      return (b.create ?? (() => json(201, { id: 'ORD-NEW', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/x' }] })))();
    }
    if (key === 'GET /v2/checkout/orders/ORD-1') {
      const o = b.order ?? { status: 'APPROVED', customId: `qm:${eventId}:ticket` };
      return json(200, { id: 'ORD-1', status: o.status, purchase_units: [{ custom_id: o.customId, amount: { currency_code: 'USD', value: '25.00' } }], links: [] });
    }
    if (key === 'POST /v2/checkout/orders/ORD-1/capture') {
      return (b.capture ?? (() => json(201, { id: 'ORD-1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED' }] } }] })))();
    }
    throw new Error(`unexpected PayPal call: ${key}`);
  });
  const client = createPayPalClient({ app: 'treasury', clientId: 'i', clientSecret: 's', fetch });
  const app = express();
  app.use(express.json());
  app.use('/api/checkout', checkoutRouter({ env, client: () => client, db: () => db, limiter: createRateLimiter({ max: limiterMax, windowMs: 60_000 }) }));
  return { app, calls };
}
const paypalPosts = (calls: ReturnType<typeof build>['calls'], pathEnd: string) => calls.filter((c) => c.key.startsWith('POST') && c.key.endsWith(pathEnd));

describe('GET /api/checkout/:eventId/config', () => {
  it('gives the public client id, the ticket price and the donation limits, with no login', async () => {
    const res = await request(build().app).get(`/api/checkout/${eventId}/config`).expect(200);
    expect(CheckoutConfig.parse(res.body)).toEqual({
      eventName: 'OpenHack 2027',
      currency: 'USD',
      clientId: 'treasury-client-id',
      ticketPriceMinor: 2500,
      donationMinMinor: 100,
      donationMaxMinor: 50000,
    });
  });

  it('answers 404 for an event that does not exist, or an id that is not one', async () => {
    const { app } = build();
    await request(app).get(`/api/checkout/${crypto.randomUUID()}/config`).expect(404);
    await request(app).get('/api/checkout/not-a-uuid/config').expect(404);
  });
});

describe('POST /api/checkout/:eventId/orders', () => {
  it("creates a Treasury order for the event's own ticket price, tagged with the event", async () => {
    const { app, calls } = build();
    const res = await request(app).post(`/api/checkout/${eventId}/orders`).send({ kind: 'ticket' }).expect(201);
    expect(CheckoutOrderResponse.parse(res.body)).toEqual({ orderId: 'ORD-NEW' });
    const unit = calls.find((c) => c.key === 'POST /v2/checkout/orders')!.body!.purchase_units[0]!;
    expect(unit).toMatchObject({ custom_id: `qm:${eventId}:ticket`, amount: { currency_code: 'USD', value: '25.00' } });
  });

  it('ignores an amount sent with a ticket, so the price cannot be chosen by the buyer', async () => {
    const { app, calls } = build();
    await request(app).post(`/api/checkout/${eventId}/orders`).send({ kind: 'ticket', amountMinor: 1 }).expect(201);
    expect(calls.find((c) => c.key === 'POST /v2/checkout/orders')!.body!.purchase_units[0]!.amount.value).toBe('25.00');
  });

  it('creates a donation for the amount given, within the limits', async () => {
    const { app, calls } = build();
    await request(app).post(`/api/checkout/${eventId}/orders`).send({ kind: 'donation', amountMinor: 7_550 }).expect(201);
    expect(calls.find((c) => c.key === 'POST /v2/checkout/orders')!.body!.purchase_units[0]!).toMatchObject({
      custom_id: `qm:${eventId}:donation`,
      amount: { value: '75.50' },
    });
    for (const bad of [{ kind: 'donation', amountMinor: 99 }, { kind: 'donation', amountMinor: 50_001 }, { kind: 'donation', amountMinor: 10.5 }, { kind: 'donation' }, { kind: 'refund' }, {}]) {
      await request(app).post(`/api/checkout/${eventId}/orders`).send(bad).expect(422);
    }
    expect(paypalPosts(calls, '/orders')).toHaveLength(1);
  });

  it('refuses tickets for an event with no ticket price, but still takes donations', async () => {
    await db.update(events).set({ ticketPrice: null }).where(eq(events.id, eventId));
    const { app, calls } = build();
    await request(app).post(`/api/checkout/${eventId}/orders`).send({ kind: 'ticket' }).expect(409);
    expect(calls).toEqual([]);
    await request(app).post(`/api/checkout/${eventId}/orders`).send({ kind: 'donation', amountMinor: 1000 }).expect(201);
  });

  it('gives each order its own PayPal request id, so two buyers never share an order', async () => {
    const { app, calls } = build();
    await request(app).post(`/api/checkout/${eventId}/orders`).send({ kind: 'ticket' });
    await request(app).post(`/api/checkout/${eventId}/orders`).send({ kind: 'ticket' });
    const ids = paypalPosts(calls, '/orders').map((c) => c.requestId);
    expect(new Set(ids).size).toBe(2);
  });

  it('rate limits per client, and answers 502 when PayPal cannot create the order', async () => {
    const limited = build({}, 2);
    for (let i = 0; i < 2; i++) await request(limited.app).post(`/api/checkout/${eventId}/orders`).send({ kind: 'ticket' }).expect(201);
    await request(limited.app).post(`/api/checkout/${eventId}/orders`).send({ kind: 'ticket' }).expect(429);

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const broken = build({ create: () => json(500, { name: 'INTERNAL_SERVER_ERROR' }) });
      await request(broken.app).post(`/api/checkout/${eventId}/orders`).send({ kind: 'ticket' }).expect(502);
    } finally {
      error.mockRestore();
    }
  });
});

describe('POST /api/checkout/:eventId/orders/:orderId/capture', () => {
  it('captures an order PayPal says the buyer approved, once, with a request id derived from the order', async () => {
    const { app, calls } = build();
    const res = await request(app).post(`/api/checkout/${eventId}/orders/ORD-1/capture`).expect(200);
    expect(CheckoutCaptureResponse.parse(res.body)).toEqual({ status: 'paid' });
    const captures = paypalPosts(calls, '/capture');
    expect(captures).toHaveLength(1);
    expect(captures[0]!.requestId).toBe('capture-ORD-1');
  });

  it('does not touch an order that belongs to another event or has no event tag, and says only that it is not found', async () => {
    for (const customId of [`qm:${crypto.randomUUID()}:ticket`, undefined, 'something-else']) {
      const { app, calls } = build({ order: { status: 'APPROVED', customId } });
      await request(app).post(`/api/checkout/${eventId}/orders/ORD-1/capture`).expect(404);
      expect(paypalPosts(calls, '/capture')).toHaveLength(0);
    }
  });

  it('does not capture an order the buyer has not approved', async () => {
    const { app, calls } = build({ order: { status: 'CREATED', customId: `qm:${eventId}:ticket` } });
    await request(app).post(`/api/checkout/${eventId}/orders/ORD-1/capture`).expect(409);
    expect(paypalPosts(calls, '/capture')).toHaveLength(0);
  });

  it('answers paid without a second capture when the order is already completed (a double click)', async () => {
    const { app, calls } = build({ order: { status: 'COMPLETED', customId: `qm:${eventId}:ticket` } });
    const res = await request(app).post(`/api/checkout/${eventId}/orders/ORD-1/capture`).expect(200);
    expect(res.body).toEqual({ status: 'paid' });
    expect(paypalPosts(calls, '/capture')).toHaveLength(0);
  });

  it('reports pending when PayPal is still reviewing the payment, and rejects odd order ids without calling PayPal', async () => {
    const pending = build({
      capture: () => json(201, { id: 'ORD-1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'PENDING' }] } }] }),
    });
    expect((await request(pending.app).post(`/api/checkout/${eventId}/orders/ORD-1/capture`).expect(200)).body).toEqual({ status: 'pending' });

    const { app, calls } = build();
    await request(app).post(`/api/checkout/${eventId}/orders/${encodeURIComponent('../x?y')}/capture`).expect(404);
    expect(calls).toEqual([]);
  });
});
