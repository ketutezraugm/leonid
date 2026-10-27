import express, { Router } from 'express';
import {
  createMemoryEventStore,
  webhookHandlers,
  WebhookEvent,
  type EventStore,
  type HandlerRegistry,
  type WebhookApp,
} from './registry.js';
import { readWebhookHeaders, SIMULATOR_WEBHOOK_ID, verifyWebhook } from './verify.js';

export interface WebhookRouterOptions {
  env?: NodeJS.ProcessEnv;
  store?: EventStore;
  registry?: HandlerRegistry;
  verify?: typeof verifyWebhook;
}

const APPS: Record<WebhookApp, string> = {
  treasury: 'PAYPAL_TREASURY_WEBHOOK_ID',
  procurement: 'PAYPAL_PROCUREMENT_WEBHOOK_ID',
};

// Mount BEFORE express.json(): signature verification needs the exact bytes PayPal sent.
// POST /:app where app is "treasury" or "procurement" (one webhook per PayPal app).
export function webhookRouter(options: WebhookRouterOptions = {}) {
  const env = options.env ?? process.env;
  const store = options.store ?? createMemoryEventStore();
  const registry = options.registry ?? webhookHandlers;
  const verify = options.verify ?? verifyWebhook;

  const verifyEnabled = env.PAYPAL_WEBHOOK_VERIFY !== 'false';
  if (!verifyEnabled && env.NODE_ENV === 'production') {
    throw new Error('PAYPAL_WEBHOOK_VERIFY=false is not allowed in production');
  }
  // The simulator signs with a literal id, so accept it only where we explicitly allow it.
  const acceptSimulator = env.PAYPAL_ACCEPT_SIMULATOR_EVENTS === 'true';

  const router = Router();
  router.post('/:app', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
    const app = req.params.app;
    if (app !== 'treasury' && app !== 'procurement') {
      res.status(404).json({ error: 'unknown app' });
      return;
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (verifyEnabled) {
      const ownId = env[APPS[app]];
      const webhookIds = [ownId, acceptSimulator ? SIMULATOR_WEBHOOK_ID : undefined].filter((id): id is string => !!id);
      if (webhookIds.length === 0) {
        res.status(503).json({ error: 'webhook id not configured' });
        return;
      }
      const headers = readWebhookHeaders(req.headers);
      if (!headers) {
        res.status(400).json({ error: 'missing PayPal signature headers' });
        return;
      }
      let ok: boolean;
      try {
        ok = await verify({ headers, rawBody, webhookIds });
      } catch (err) {
        // Could not fetch the certificate: ask PayPal to retry later.
        console.error('webhook verification unavailable', err);
        res.status(503).json({ error: 'verification unavailable' });
        return;
      }
      if (!ok) {
        res.status(401).json({ error: 'invalid signature' });
        return;
      }
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'body is not JSON' });
      return;
    }
    const parsed = WebhookEvent.safeParse(json);
    if (!parsed.success) {
      res.status(400).json({ error: 'not a PayPal event' });
      return;
    }
    const event = parsed.data;

    if (!(await store.claim(event.id))) {
      res.json({ status: 'duplicate' });
      return;
    }
    try {
      await registry.dispatch(app, event);
    } catch (err) {
      await store.release(event.id);
      console.error(`webhook handler failed for ${event.event_type} ${event.id}`, err);
      res.status(500).json({ error: 'handler failed' });
      return;
    }
    // Event types nobody registered still get 200, otherwise PayPal retries them for days.
    res.json({ status: 'ok' });
  });
  return router;
}
