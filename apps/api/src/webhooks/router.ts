import express, { Router, type Response } from 'express';
import { requireTreasurer } from '../auth/treasurer.js';
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

// One line per delivery, kept in memory (last 50) and shown to the treasurer at GET /recent.
// Nothing secret goes in: no signatures, no body, only what is needed to see why an event was rejected.
export interface Delivery {
  at: string;
  app: string;
  status: number;
  outcome: 'accepted' | 'duplicate' | 'rejected' | 'unavailable' | 'error';
  eventType?: string;
  eventId?: string;
  reason?: string;
}
const MAX_RECENT = 50;

const APPS: Record<WebhookApp, string> = {
  treasury: 'PAYPAL_TREASURY_WEBHOOK_ID',
  procurement: 'PAYPAL_PROCUREMENT_WEBHOOK_ID',
};

// Mount BEFORE express.json(): signature verification needs the exact bytes PayPal sent.
// POST /:app where app is "treasury" or "procurement" (one webhook per PayPal app).
// GET /recent (treasurer only): the last deliveries and why each was accepted or rejected.
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

  const recent: Delivery[] = [];
  const note = (d: Omit<Delivery, 'at'>) => {
    recent.unshift({ at: new Date().toISOString(), ...d });
    recent.length = Math.min(recent.length, MAX_RECENT);
  };

  const router = Router();

  router.get('/recent', requireTreasurer(env), (_req, res) => {
    res.json({ deliveries: recent });
  });

  router.post('/:app', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
    const app = req.params.app;
    if (app !== 'treasury' && app !== 'procurement') {
      res.status(404).json({ error: 'unknown app' });
      return;
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    // Answer and remember in one place, so every exit leaves a trace.
    const finish = (res2: Response, status: number, body: object, d: Omit<Delivery, 'at' | 'app' | 'status'>) => {
      note({ app, status, ...d });
      res2.status(status).json(body);
    };

    if (verifyEnabled) {
      const ownId = env[APPS[app]];
      const webhookIds = [ownId, acceptSimulator ? SIMULATOR_WEBHOOK_ID : undefined].filter((id): id is string => !!id);
      if (webhookIds.length === 0) {
        finish(res, 503, { error: 'webhook id not configured' }, { outcome: 'unavailable', reason: 'webhook id not configured' });
        return;
      }
      const headers = readWebhookHeaders(req.headers);
      if (!headers) {
        finish(res, 400, { error: 'missing PayPal signature headers' }, { outcome: 'rejected', reason: 'missing PayPal signature headers' });
        return;
      }
      let ok: boolean;
      try {
        ok = await verify({ headers, rawBody, webhookIds });
      } catch (err) {
        // Could not fetch the certificate: ask PayPal to retry later.
        console.error('webhook verification unavailable', err);
        finish(res, 503, { error: 'verification unavailable' }, { outcome: 'unavailable', reason: err instanceof Error ? err.message : 'verification unavailable' });
        return;
      }
      if (!ok) {
        const certHost = (() => {
          try {
            return new URL(headers.certUrl).hostname;
          } catch {
            return 'invalid url';
          }
        })();
        const tried = [ownId ? 'own webhook id' : undefined, acceptSimulator ? 'simulator id' : undefined].filter(Boolean).join(' + ');
        finish(res, 401, { error: 'invalid signature' }, {
          outcome: 'rejected',
          reason: `signature did not match (algo ${headers.authAlgo}, cert host ${certHost}, tried ${tried})`,
        });
        return;
      }
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      finish(res, 400, { error: 'body is not JSON' }, { outcome: 'rejected', reason: 'body is not JSON' });
      return;
    }
    const parsed = WebhookEvent.safeParse(json);
    if (!parsed.success) {
      finish(res, 400, { error: 'not a PayPal event' }, { outcome: 'rejected', reason: 'body is not a PayPal event' });
      return;
    }
    const event = parsed.data;
    const who = { eventType: event.event_type, eventId: event.id };

    if (!(await store.claim(event.id))) {
      finish(res, 200, { status: 'duplicate' }, { outcome: 'duplicate', ...who });
      return;
    }
    try {
      await registry.dispatch(app, event);
    } catch (err) {
      await store.release(event.id);
      console.error(`webhook handler failed for ${event.event_type} ${event.id}`, err);
      finish(res, 500, { error: 'handler failed' }, { outcome: 'error', reason: 'handler failed', ...who });
      return;
    }
    // Event types nobody registered still get 200, otherwise PayPal retries them for days.
    finish(res, 200, { status: 'ok' }, { outcome: 'accepted', ...who });
  });
  return router;
}
