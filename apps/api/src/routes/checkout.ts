import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import {
  CreateCheckoutOrderRequest,
  DONATION_MAX_MINOR,
  DONATION_MIN_MINOR,
  type ApiError,
  type CheckoutCaptureResponse,
  type CheckoutConfig,
  type CheckoutOrderResponse,
} from '@quartermaster/shared';
import { z } from 'zod';
import { DbNotConfiguredError, getDb, type Db } from '../db/client.js';
import { getEvent } from '../db/events.js';
import { getPayPalClient, isPayPalAppConfigured, type PayPalClient } from '../paypal/client.js';
import { PayPalApiError } from '../paypal/errors.js';
import { captureIncomeOrder } from '../paypal/income.js';
import { createOrder, getOrder } from '../paypal/orders.js';
import { buildCaptureTag, parseCaptureTag } from '../webhooks/handlers/capture-completed.js';
import { createRateLimiter, type RateLimiter } from './rateLimit.js';

export interface CheckoutRouterOptions {
  env?: NodeJS.ProcessEnv;
  client?: () => PayPalClient;
  db?: () => Db;
  limiter?: RateLimiter;
}

const fail = (res: Response, status: number, error: string) => void res.status(status).json({ error } satisfies ApiError);

// F6: tickets and donations, paid on the public event page with no login. Contract: packages/shared/src/checkout.ts.
//   GET  /:eventId/config                  public PayPal client id, ticket price (null: no tickets), donation limits
//   POST /:eventId/orders                  { kind: 'ticket' } | { kind: 'donation', amountMinor } -> a Treasury order to approve
//   POST /:eventId/orders/:orderId/capture after PayPal's button approved it: PayPal is asked, then the order is collected
// The server decides the amount (a ticket's price is the event's), the event tag goes in custom_id, and the ledger is
// credited only by the PAYMENT.CAPTURE.COMPLETED webhook (capture-completed.ts), never by this route.
export function checkoutRouter(options: CheckoutRouterOptions = {}) {
  const env = options.env ?? process.env;
  const db = options.db ?? getDb;
  const treasury = options.client ?? (() => getPayPalClient('treasury'));
  const limiter = options.limiter ?? createRateLimiter({ max: 30, windowMs: 10 * 60_000 });
  const router = Router();

  const configured = () => Boolean(options.client) || isPayPalAppConfigured('treasury', env);

  // Looks the event up, then runs the handler; maps the known failures to a status so none of them is a bare 500.
  const forEvent =
    (fn: (req: Request, res: Response, event: NonNullable<Awaited<ReturnType<typeof getEvent>>>) => Promise<void>) =>
    async (req: Request, res: Response) => {
      if (!configured()) return fail(res, 503, 'PayPal Treasury app is not configured');
      const id = z.uuid().safeParse(req.params.eventId);
      try {
        const event = id.success ? await getEvent(db(), id.data) : undefined;
        if (!event) return fail(res, 404, 'Event not found');
        await fn(req, res, event);
      } catch (err) {
        if (err instanceof DbNotConfiguredError) return fail(res, 503, 'The database is not configured on this server.');
        console.error('checkout failed', err instanceof PayPalApiError ? err.message : err);
        fail(res, err instanceof PayPalApiError ? 502 : 500, 'Payment could not be completed. Nothing was charged; try again.');
      }
    };

  router.get(
    '/:eventId/config',
    forEvent(async (_req, res, event) => {
      const body: CheckoutConfig = {
        eventName: event.name,
        currency: event.currency,
        clientId: env.PAYPAL_TREASURY_CLIENT_ID ?? '',
        ticketPriceMinor: event.ticketPrice,
        donationMinMinor: DONATION_MIN_MINOR,
        donationMaxMinor: DONATION_MAX_MINOR,
      };
      res.json(body);
    }),
  );

  router.post(
    '/:eventId/orders',
    forEvent(async (req, res, event) => {
      const parsed = CreateCheckoutOrderRequest.safeParse(req.body);
      if (!parsed.success) return fail(res, 422, 'Choose a ticket, or a donation between the limits.');
      if (!limiter.take(req)) return fail(res, 429, 'Too many requests. Wait a few minutes and try again.');
      const request = parsed.data;
      let amountMinor: number;
      if (request.kind === 'ticket') {
        if (event.ticketPrice === null) return fail(res, 409, 'This event is not selling tickets.');
        amountMinor = event.ticketPrice;
      } else {
        amountMinor = request.amountMinor;
      }
      const referenceId = `${request.kind}-${randomUUID()}`;
      const order = await createOrder(treasury(), {
        referenceId,
        amountMinor,
        currency: event.currency,
        description: `${event.name} ${request.kind}`.slice(0, 120),
        customId: buildCaptureTag(event.id, request.kind),
      });
      const body: CheckoutOrderResponse = { orderId: order.id };
      res.status(201).json(body);
    }),
  );

  router.post(
    '/:eventId/orders/:orderId/capture',
    forEvent(async (req, res, event) => {
      if (!limiter.take(req)) return fail(res, 429, 'Too many requests. Wait a few minutes and try again.');
      const orderId = String(req.params.orderId);
      if (!/^[A-Za-z0-9-]{1,64}$/.test(orderId)) return fail(res, 404, 'Order not found');
      const client = treasury();
      const order = await getOrder(client, orderId);
      // Only this event's own orders: the tag we put in custom_id when we created it. Anything else looks like no order.
      const tag = parseCaptureTag(order.purchase_units?.[0]?.custom_id);
      if (tag?.eventId !== event.id) return fail(res, 404, 'Order not found');
      if (order.status === 'COMPLETED') return void res.json({ status: 'paid' } satisfies CheckoutCaptureResponse); // a double click
      if (order.status !== 'APPROVED') return fail(res, 409, 'This payment was not approved in PayPal.');
      const { captureStatus } = await captureIncomeOrder(client, orderId);
      if (captureStatus !== 'COMPLETED' && captureStatus !== 'PENDING') return fail(res, 502, 'PayPal did not take the payment. Nothing was charged.');
      res.json({ status: captureStatus === 'COMPLETED' ? 'paid' : 'pending' } satisfies CheckoutCaptureResponse);
    }),
  );

  return router;
}
