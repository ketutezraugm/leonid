import {
  FundingThermometerResponse,
  RulesHealthResponse,
  WidgetFilter,
} from '@quartermaster/shared';
import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { requireTreasurer } from '../auth/treasurer.js';
import { getDb, type Db } from '../db/client.js';
import { getFundingThermometer, getRulesHealth } from '../widgets/live.js';

export interface WidgetsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
  now?: () => Date;
}

const FundingQuery = WidgetFilter.extend({ eventId: z.uuid() });

// Data for the Money command center (AG Studio). Read-only and treasurer-only. Every widget endpoint
// takes the shared WidgetFilter (sponsorId, category) so a click in one widget can filter the others, and
// answers { source, data }: 'live' for numbers from our own ledger and audit log, 'sample' while the
// owner's data does not exist yet.
//   GET /funding?eventId=…[&sponsorId=…]   pledged, invoiced and cleared per sponsor
//   GET /rules-health[?category=…]         allowed, sent to approval and blocked, with reasons
export function widgetsRouter(options: WidgetsRouterOptions = {}) {
  const env = options.env ?? process.env;
  const guard = requireTreasurer(env);
  const router = Router();

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
    handle(FundingQuery, async ({ eventId, ...filter }, res, { db, now }) => {
      const data = await getFundingThermometer(db, eventId, filter, now);
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
    handle(WidgetFilter, async (filter, res, { db, now }) => {
      const data = await getRulesHealth(db, filter, now);
      res.json(RulesHealthResponse.parse({ source: 'live', data }));
    }),
  );

  return router;
}
