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
const recent = async (app: express.Express) => (await request(app).get('/hook/recent').set(treasurer)).body;

describe('GET /recent', () => {
  it('is for the treasurer only, and fails closed when no token is configured', async () => {
    const app = build();
    expect((await request(app).get('/hook/recent')).status).toBe(401);
    expect((await request(app).get('/hook/recent').set('x-treasurer-token', 'nope')).status).toBe(401);
    const noToken = build(undefined, { PAYPAL_TREASURY_WEBHOOK_ID: 'WH-T' });
    expect((await request(noToken).get('/hook/recent').set(treasurer)).status).toBe(503);
  });

  it('shows a verified event with its type and id, newest first', async () => {
    const app = build();
    await request(app).post('/hook/treasury').set(signed).send(event('WH-1'));
    await request(app).post('/hook/treasury').set(signed).send(event('WH-1')); // a retry
    const { deliveries } = await recent(app);
    expect(deliveries[0]).toMatchObject({ app: 'treasury', status: 200, outcome: 'duplicate', eventId: 'WH-1' });
    expect(deliveries[1]).toMatchObject({ outcome: 'accepted', eventType: 'PAYMENT.CAPTURE.COMPLETED', eventId: 'WH-1' });
  });

  it('puts a signature failure in the unauthenticated list with fixed wording, not in the verified one', async () => {
    const app = build(vi.fn(async () => false));
    await request(app).post('/hook/treasury').set(signed).send(event('WH-2'));
    const body = await recent(app);
    expect(body.deliveries).toHaveLength(0);
    expect(body.unauthenticated[0]).toMatchObject({
      status: 401,
      outcome: 'rejected',
      reason: 'signature did not match (algo SHA256withRSA, cert host paypal.com, tried own webhook id + simulator id)',
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain('"sig"'); // the transmission signature
    expect(text).not.toContain('PAYMENT.CAPTURE.COMPLETED'); // the body is not echoed for rejected events
  });

  it('never copies text a stranger sent into the treasurer view', async () => {
    const app = build(vi.fn(async () => false));
    const hostile = {
      ...signed,
      'paypal-auth-algo': 'SHA256withRSA <script>alert(1)</script> FAKE AUDIT LINE',
      'paypal-cert-url': 'https://evil.example.com/FAKE-APPROVED-BY-TREASURER',
    };
    await request(app).post('/hook/treasury').set(hostile).send(event('WH-6'));
    const text = JSON.stringify(await recent(app));
    expect(text).not.toContain('script');
    expect(text).not.toContain('FAKE');
    expect(text).not.toContain('evil.example.com');
    expect(text).toContain('algo unsupported, cert host not paypal.com');
  });

  it('does not store the text of a verification error, which can quote what the caller sent', async () => {
    const app = build(
      vi.fn(async () => {
        throw new Error('untrusted PayPal cert url: evil.example.com FAKE');
      }),
    );
    await request(app).post('/hook/treasury').set(signed).send(event('WH-4'));
    const { unauthenticated } = await recent(app);
    expect(unauthenticated[0]).toMatchObject({ status: 503, outcome: 'unavailable', reason: 'certificate unavailable or not from paypal.com' });
    expect(JSON.stringify(unauthenticated)).not.toContain('FAKE');
  });

  it('records a missing-header request and an unconfigured webhook as unauthenticated', async () => {
    const missing = build();
    await request(missing).post('/hook/treasury').send(event('WH-3'));
    expect((await recent(missing)).unauthenticated[0]).toMatchObject({ status: 400, outcome: 'rejected' });

    const unconfigured = build(undefined, { TREASURER_TOKEN: 'letmein' });
    await request(unconfigured).post('/hook/treasury').set(signed).send(event('WH-5'));
    expect((await recent(unconfigured)).unauthenticated[0]).toMatchObject({ status: 503, reason: 'webhook id not configured' });
  });

  it('keeps each list to the last 50, and a flood of bad requests cannot push a verified delivery out', async () => {
    let good = true;
    const app = build(vi.fn(async () => good));
    await request(app).post('/hook/treasury').set(signed).send(event('REAL-1'));
    good = false;
    for (let i = 0; i < 60; i++) await request(app).post('/hook/treasury').set(signed).send(event(`FLOOD-${i}`));
    const body = await recent(app);
    expect(body.unauthenticated).toHaveLength(50);
    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries[0]).toMatchObject({ outcome: 'accepted', eventId: 'REAL-1' });
  });

  it('caps the verified list at 50 too', async () => {
    const app = build();
    for (let i = 0; i < 55; i++) await request(app).post('/hook/treasury').set(signed).send(event(`WH-${i}`));
    const { deliveries } = await recent(app);
    expect(deliveries).toHaveLength(50);
    expect(deliveries[0].eventId).toBe('WH-54');
  });
});
