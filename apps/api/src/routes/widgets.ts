import {
  BudgetBurnResponse,
  CommandCenterResponse,
  DeliveryRiskResponse,
  FundingThermometerResponse,
  PayoutsLedgerResponse,
  RulesHealthResponse,
  WidgetFilter,
} from '@quartermaster/shared';
import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { currentTreasurer, ownerOf, requireTreasurer } from '../auth/treasurer.js';
import { getDb, type Db } from '../db/client.js';
import { getDemoEvent, getVisibleEvent } from '../db/events.js';
import { getBudgetBurn, getFundingThermometer, getRulesHealth } from '../widgets/live.js';
import { getDeliveryRiskSample } from '../widgets/sample.js';
import { getPayoutsLedger } from '../widgets/payouts.js';

export interface WidgetsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
  now?: () => Date;
}

const EventQuery = WidgetFilter.extend({ eventId: z.uuid().optional() });

// Data for the Money command center (AG Studio). Read-only and treasurer-only. Every widget endpoint
// takes the shared WidgetFilter (sponsorId, category) so a click in one widget can filter the others, and
// answers { source, data }: 'live' for numbers from our own ledger and audit log, 'sample' while the
// owner's data does not exist yet.
//   GET /funding[?eventId=…&sponsorId=…]   pledged, invoiced and cleared per sponsor
//   GET /rules-health[?eventId=…&category=…]   allowed, sent to approval and blocked, with reasons
//   GET /budget-burn[?eventId=…&category=…]    cleared, committed and unlocked, by category, with caps
//   GET /delivery-risk[?eventId=…&sponsorId=…&category=…]   SAMPLE until P4's orders and tracking exist
//   GET /payouts[?eventId=…&sponsorId=…&category=…]   claims, prizes and speaker fees, live (F17)
//   GET /command-center[?eventId=…]   all five above, unfiltered, in one answer (what the Money page asks)
// With no eventId the seeded demo event is used: the web does not know an event's id until the Event
// endpoint exists, and the demo runs on that one event.
export function widgetsRouter(options: WidgetsRouterOptions = {}) {
  const env = options.env ?? process.env;
  const guard = requireTreasurer(env);
  const router = Router();

  // The event a request is about: the one it names when the caller can see it, else the seeded demo event
  // (none: undefined, so 404). Someone else's event answers like an unknown one.
  const eventIdOf = async (db: Db, eventId: string | undefined, res: Response) =>
    eventId
      ? (await getVisibleEvent(db, eventId, ownerOf(currentTreasurer(res))))?.id
      : (await getDemoEvent(db))?.id;

  const handle =
    <Q>(
      schema: z.ZodType<Q>,
      fn: (query: Q, res: Response, ctx: { db: Db; now: Date }) => Promise<void>,
    ): RequestHandler =>
    async (req, res) => {
      const query = schema.safeParse(req.query);
      if (!query.success) {
        res.status(400).json({ error: 'invalid query', issues: query.error.issues });
        return;
      }
      let db: Db;
      try {
        db = (options.db ?? getDb)();
      } catch {
        res.status(503).json({ error: 'database is not configured' });
        return;
      }
      try {
        await fn(query.data, res, { db, now: (options.now ?? (() => new Date()))() });
      } catch (err) {
        console.error('widget request failed', err);
        res.status(500).json({ error: 'widget request failed' });
      }
    };

  router.get(
    '/funding',
    guard,
    handle(EventQuery, async ({ eventId, ...filter }, res, { db, now }) => {
      const id = await eventIdOf(db, eventId, res);
      const data = id ? await getFundingThermometer(db, id, filter, now) : undefined;
      if (!data) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      res.json(FundingThermometerResponse.parse({ source: 'live', data }));
    }),
  );

  router.get(
    '/rules-health',
    guard,
    handle(EventQuery, async ({ eventId, ...filter }, res, { db, now }) => {
      const id = await eventIdOf(db, eventId, res);
      const data = id ? await getRulesHealth(db, id, filter, now) : undefined;
      if (!data) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      res.json(RulesHealthResponse.parse({ source: 'live', data }));
    }),
  );

  router.get(
    '/budget-burn',
    guard,
    handle(EventQuery, async ({ eventId, ...filter }, res, { db, now }) => {
      const id = await eventIdOf(db, eventId, res);
      const data = id ? await getBudgetBurn(db, id, filter, now) : undefined;
      if (!data) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      res.json(BudgetBurnResponse.parse({ source: 'live', data }));
    }),
  );

  router.get(
    '/delivery-risk',
    guard,
    handle(EventQuery, async ({ eventId, ...filter }, res, { db, now }) => {
      const id = await eventIdOf(db, eventId, res);
      const data = id ? await getDeliveryRiskSample(db, id, filter, now) : undefined;
      if (!data) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      res.json(DeliveryRiskResponse.parse({ source: 'sample', data }));
    }),
  );

  router.get(
    '/payouts',
    guard,
    handle(EventQuery, async ({ eventId, ...filter }, res, { db, now }) => {
      const id = await eventIdOf(db, eventId, res);
      const data = id ? await getPayoutsLedger(db, id, filter, now) : undefined;
      if (!data) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      res.json(PayoutsLedgerResponse.parse({ source: 'live', data }));
    }),
  );

  // The Money page's one request: all five widgets, unfiltered (Studio does the cross-filtering in the
  // browser). The event is resolved once and the five loaders run in parallel, instead of five requests
  // each resolving the event and queueing for the same database connections.
  router.get(
    '/command-center',
    guard,
    handle(z.object({ eventId: z.uuid().optional() }), async ({ eventId }, res, { db, now }) => {
      const id = await eventIdOf(db, eventId, res);
      const [funding, budget, payouts, rules, delivery] = id
        ? await Promise.all([
            getFundingThermometer(db, id, {}, now),
            getBudgetBurn(db, id, {}, now),
            getPayoutsLedger(db, id, {}, now),
            getRulesHealth(db, id, {}, now),
            getDeliveryRiskSample(db, id, {}, now),
          ])
        : [];
      if (!funding || !budget || !payouts || !rules || !delivery) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      res.json(
        CommandCenterResponse.parse({
          funding: { source: 'live', data: funding },
          budget: { source: 'live', data: budget },
          payouts: { source: 'live', data: payouts },
          rules: { source: 'live', data: rules },
          delivery: { source: 'sample', data: delivery },
        }),
      );
    }),
  );

  return router;
}
