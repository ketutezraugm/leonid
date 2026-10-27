import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHandlerRegistry, createMemoryEventStore } from './registry.js';
import { webhookRouter } from './router.js';

const signedHeaders = {
  'content-type': 'application/json',
  'paypal-transmission-id': 'T-1',
  'paypal-transmission-time': '2026-10-27T10:00:00Z',
  'paypal-transmission-sig': 'sig',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
  'paypal-auth-algo': 'SHA256withRSA',
};
const event = { id: 'WH-1', event_type: 'INVOICING.INVOICE.PAID', resource: { id: 'INV2-1' } };

function build(overrides: Parameters<typeof webhookRouter>[0] = {}) {
  const registry = createHandlerRegistry();
  const handler = vi.fn(async () => {});
  registry.register('INVOICING.INVOICE.PAID', handler);
  const verify = vi.fn(async () => true);
  const app = express();
  app.use(
    '/hook',
    webhookRouter({
      env: { PAYPAL_TREASURY_WEBHOOK_ID: 'WH-TREASURY' },
      store: createMemoryEventStore(),
      registry,
      verify,
      ...overrides,
    }),
  );
  return { app, handler, verify };
}

describe('webhook router', () => {
  it('verifies, dispatches to the registered handler and answers 200', async () => {
    const { app, handler, verify } = build();
    const res = await request(app).post('/hook/treasury').set(signedHeaders).send(JSON.stringify(event));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ webhookIds: ['WH-TREASURY'] }));
  });

  it('verifies against the exact raw bytes it received', async () => {
    const { app, verify } = build();
    const raw = '{ "id" : "WH-1",   "event_type":"INVOICING.INVOICE.PAID","resource":{} }';
    await request(app).post('/hook/treasury').set(signedHeaders).send(raw);
    const call = verify.mock.calls[0] as unknown as [{ rawBody: Buffer }];
    expect(call[0].rawBody.toString()).toBe(raw);
  });

  it('rejects an invalid signature without running handlers', async () => {
    const { app, handler } = build({ verify: async () => false });
    const res = await request(app).post('/hook/treasury').set(signedHeaders).send(JSON.stringify(event));
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('asks PayPal to retry when verification is unavailable', async () => {
    const { app } = build({
      verify: async () => {
        throw new Error('cert fetch failed');
      },
    });
    const res = await request(app).post('/hook/treasury').set(signedHeaders).send(JSON.stringify(event));
    expect(res.status).toBe(503);
  });

  it('answers 503 when the webhook id is not configured', async () => {
    const { app } = build({ env: {} });
    const res = await request(app).post('/hook/treasury').set(signedHeaders).send(JSON.stringify(event));
    expect(res.status).toBe(503);
  });

  it('only accepts the simulator id when explicitly allowed', async () => {
    const { app, verify } = build({ env: { PAYPAL_TREASURY_WEBHOOK_ID: 'WH-T', PAYPAL_ACCEPT_SIMULATOR_EVENTS: 'true' } });
    await request(app).post('/hook/treasury').set(signedHeaders).send(JSON.stringify(event));
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ webhookIds: ['WH-T', 'WEBHOOK_ID'] }));
  });

  it('processes a retried event only once', async () => {
    const { app, handler } = build();
    await request(app).post('/hook/treasury').set(signedHeaders).send(JSON.stringify(event));
    const second = await request(app).post('/hook/treasury').set(signedHeaders).send(JSON.stringify(event));
    expect(second.body).toEqual({ status: 'duplicate' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('lets PayPal retry after a handler failure', async () => {
    const registry = createHandlerRegistry();
    const handler = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    registry.register('INVOICING.INVOICE.PAID', handler);
    const { app } = build({ registry });
    const first = await request(app).post('/hook/treasury').set(signedHeaders).send(JSON.stringify(event));
    expect(first.status).toBe(500);
    const retry = await request(app).post('/hook/treasury').set(signedHeaders).send(JSON.stringify(event));
    expect(retry.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('acknowledges event types nobody handles', async () => {
    const { app } = build();
    const other = { ...event, id: 'WH-2', event_type: 'CUSTOMER.DISPUTE.CREATED' };
    const res = await request(app).post('/hook/treasury').set(signedHeaders).send(JSON.stringify(other));
    expect(res.status).toBe(200);
  });

  it('rejects unknown apps and non-event bodies', async () => {
    const { app } = build();
    expect((await request(app).post('/hook/other').set(signedHeaders).send('{}')).status).toBe(404);
    expect((await request(app).post('/hook/treasury').set(signedHeaders).send('not json')).status).toBe(400);
    expect((await request(app).post('/hook/treasury').set(signedHeaders).send('{"hello":1}')).status).toBe(400);
  });

  it('skips verification only when explicitly disabled outside production', async () => {
    const { app, verify, handler } = build({ env: { PAYPAL_WEBHOOK_VERIFY: 'false' } });
    const res = await request(app).post('/hook/treasury').send(JSON.stringify(event)).set('content-type', 'application/json');
    expect(res.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalled();
  });

  it('refuses to start with verification disabled in production', () => {
    expect(() => webhookRouter({ env: { PAYPAL_WEBHOOK_VERIFY: 'false', NODE_ENV: 'production' } })).toThrow('production');
  });
});
