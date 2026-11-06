import {
  CreateEventRequest,
  type CreateEventResponse,
  type EventOverview,
  type EventSummary,
  type EventsResponse,
} from '@quartermaster/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { currentTreasurer, requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { loadUnlocked } from '../db/budget.js';
import { getDb, type Db } from '../db/client.js';
import { createOwnedEvent, getEvent, listOwnedEvents, ReservedEventNameError } from '../db/events.js';
import type { events } from '../db/schema.js';
import { listTasks } from '../db/tasks.js';
import { createRateLimiter, type RateLimiter } from './rateLimit.js';

export interface EventsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
  now?: () => Date;
  // One person may make 10 events in 10 minutes. A new login is a new identity on the demo, so a backstop caps all of them.
  perOwnerLimiter?: RateLimiter;
  globalLimiter?: RateLimiter;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function toSummary(row: typeof events.$inferSelect): EventSummary {
  return {
    id: row.id,
    name: row.name,
    date: day(row.date),
    endDate: day(row.endDate ?? row.date),
    people: row.headcount,
    currency: row.currency,
    budgetTotalMinor: row.budgetTotal,
    categories: row.categories,
    city: row.city,
  };
}

// The setup flow. Treasurer only; the seeded demo event is not in the list (the web adds it).
//   GET  /                     -> EventsResponse: the events this person made
//   POST /                     body CreateEventRequest -> 201 CreateEventResponse
//   GET  /:eventId/overview    -> EventOverview: unlocked budget and plan tasks (Event home, Plan)
export function eventsRouter(options: EventsRouterOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const perOwner = options.perOwnerLimiter ?? createRateLimiter({ max: 10, windowMs: 10 * 60_000 });
  const backstop = options.globalLimiter ?? createRateLimiter({ max: 60, windowMs: 10 * 60_000 });
  const router = Router();
  router.use(requireTreasurer(env));

  const handle =
    (fn: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], db: Db) => Promise<void>): RequestHandler =>
    async (req, res) => {
      let db: Db;
      try {
        db = (options.db ?? getDb)();
      } catch {
        res.status(503).json({ error: 'database is not configured' });
        return;
      }
      try {
        await fn(req, res, db);
      } catch (err) {
        console.error('events request failed', err);
        res.status(500).json({ error: 'events request failed' });
      }
    };

  router.get(
    '/',
    handle(async (_req, res, db) => {
      const rows = await listOwnedEvents(db, currentTreasurer(res).sub);
      const body: EventsResponse = { events: rows.map(toSummary) };
      res.json(body);
    }),
  );

  router.post(
    '/',
    handle(async (req, res, db) => {
      const parsed = CreateEventRequest.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ error: 'Check the event details', issues: parsed.error.issues });
        return;
      }
      const input = parsed.data;
      if (input.date < day(now())) {
        res.status(422).json({ error: 'The event date is in the past' });
        return;
      }
      const owner = currentTreasurer(res).sub;
      // Both are taken before the write, so a refused request still counts.
      if (!perOwner.take(req, owner) || !backstop.take(req, 'all')) {
        res.status(429).json({ error: 'Too many events created. Try again in a few minutes.' });
        return;
      }
      try {
        const row = await createOwnedEvent(
          db,
          {
            name: input.name,
            date: new Date(`${input.date}T00:00:00Z`),
            endDate: new Date(`${input.endDate ?? input.date}T00:00:00Z`),
            headcount: input.people,
            budgetTotal: input.budgetTotalMinor,
            currency: input.currency,
            categories: [...new Set(input.categories.map((c) => c.toLowerCase()))],
            city: input.city,
            ownerSub: owner,
          },
          treasurerActor(res),
        );
        const body: CreateEventResponse = { event: toSummary(row) };
        res.status(201).json(body);
      } catch (err) {
        if (err instanceof ReservedEventNameError) {
          res.status(422).json({ error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  router.get(
    '/:eventId/overview',
    handle(async (req, res, db) => {
      const id = z.uuid().safeParse(req.params.eventId);
      const event = id.success ? await getEvent(db, id.data) : undefined;
      if (!event) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      const [unlockedMinor, tasks] = await Promise.all([loadUnlocked(db, event, now()), listTasks(db, event.id)]);
      const body: EventOverview = {
        unlockedMinor,
        tasks: tasks.map((t) => ({
          id: t.id,
          name: t.name,
          start: day(t.start),
          end: day(t.end),
          deadline: t.deadline ? day(t.deadline) : null,
        })),
      };
      res.json(body);
    }),
  );

  return router;
}
