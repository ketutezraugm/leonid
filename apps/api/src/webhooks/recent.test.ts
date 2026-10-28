import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHandlerRegistry, createMemoryEventStore } from './registry.js';
import { webhookRouter } from './router.js';

const signed = {
  'content-type': 'application/json',
  'paypal-transmission-id': 'T-1',
  'paypal-transmission-time': '2026-10-28T17:08:10Z',
  'paypal-transmission-sig': 'sig',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
  'paypal-auth-algo': 'SHA256withRSA',
};
const env = { PAYPAL_TREASURY_WEBHOOK_ID: 'WH-T', TREASURER_TOKEN: 'letmein', PAYPAL_ACCEPT_SIMULATOR_EVENTS: 'true' };
const treasurer = { 'x-treasurer-token': 'letmein' };
const event = (id: string) => JSON.stringify({ id, event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} });

function build(verify = vi.fn(async () => true), envOverride: NodeJS.ProcessEnv = env) {
  const app = express();
  app.use('/hook', webhookRouter({ env: envOverride, store: createMemoryEventStore(), registry: createHandlerRegistry(), verify }));
  return app;
}

describe('GET /recent', () => {
  it('is for the treasurer only, and fails closed when no token is configured', async () => {
    const app = build();
    expect((await request(app).get('/hook/recent')).status).toBe(401);
    expect((await request(app).get('/hook/recent').set('x-treasurer-token', 'nope')).status).toBe(401);
    const noToken = build(undefined, { PAYPAL_TREASURY_WEBHOOK_ID: 'WH-T' });
    expect((await request(noToken).get('/hook/recent').set(treasurer)).status).toBe(503);
  });

  it('shows an accepted event with its type and id, newest first', async () => {
    const app = build();
    await request(app).post('/hook/treasury').set(signed).send(event('WH-1'));
    await request(app).post('/hook/treasury').set(signed).send(event('WH-1')); // a retry
    const { deliveries } = (await request(app).get('/hook/recent').set(treasurer)).body;
    expect(deliveries[0]).toMatchObject({ app: 'treasury', status: 200, outcome: 'duplicate', eventId: 'WH-1' });
    expect(deliveries[1]).toMatchObject({ outcome: 'accepted', eventType: 'PAYMENT.CAPTURE.COMPLETED', eventId: 'WH-1' });
  });

  it('says why a signature was rejected, without exposing the signature or the body', async () => {
    const app = build(vi.fn(async () => false));
    await request(app).post('/hook/treasury').set(signed).send(event('WH-2'));
    const text = JSON.stringify((await request(app).get('/hook/recent').set(treasurer)).body);
    expect(text).toContain('signature did not match');
    expect(text).toContain('algo SHA256withRSA');
    expect(text).toContain('cert host api.sandbox.paypal.com');
    expect(text).toContain('own webhook id + simulator id');
    expect(text).not.toContain('"sig"'); // the transmission signature
    expect(text).not.toContain('PAYMENT.CAPTURE.COMPLETED'); // the body is not echoed for rejected events
  });

  it('records a missing-header request, an unreachable certificate and an unconfigured webhook', async () => {
    const missing = build();
    await request(missing).post('/hook/treasury').send(event('WH-3'));
    expect((await request(missing).get('/hook/recent').set(treasurer)).body.deliveries[0]).toMatchObject({ status: 400, outcome: 'rejected' });

    const down = build(
      vi.fn(async () => {
        throw new Error('could not fetch PayPal cert: HTTP 503');
      }),
    );
    await request(down).post('/hook/treasury').set(signed).send(event('WH-4'));
    expect((await request(down).get('/hook/recent').set(treasurer)).body.deliveries[0]).toMatchObject({
      status: 503,
      outcome: 'unavailable',
      reason: 'could not fetch PayPal cert: HTTP 503',
    });

    const unconfigured = build(undefined, { TREASURER_TOKEN: 'letmein' });
    await request(unconfigured).post('/hook/treasury').set(signed).send(event('WH-5'));
    expect((await request(unconfigured).get('/hook/recent').set(treasurer)).body.deliveries[0]).toMatchObject({ status: 503, reason: 'webhook id not configured' });
  });

  it('keeps only the last 50 deliveries', async () => {
    const app = build();
    for (let i = 0; i < 55; i++) await request(app).post('/hook/treasury').set(signed).send(event(`WH-${i}`));
    const { deliveries } = (await request(app).get('/hook/recent').set(treasurer)).body;
    expect(deliveries).toHaveLength(50);
    expect(deliveries[0].eventId).toBe('WH-54');
  });
});
