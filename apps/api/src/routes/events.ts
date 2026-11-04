import { CreateEventRequest, type EventsResponse, type EventSummary } from '@quartermaster/shared';
import { Router, type Response } from 'express';
import { requireTreasurer } from '../auth/treasurer.js';
import { getDb, type Db } from '../db/client.js';
import { createEvent, listEvents } from '../db/events.js';

export interface EventsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
}

// The events the app runs (All events, the switcher) and the setup flow's first step. Treasurer only. No money moves.
//   GET  /         -> EventsResponse (shared), soonest first
//   POST /         CreateEventRequest -> 201 EventSummary; 422 with the first problem when the body is invalid
export function eventsRouter(options: EventsRouterOptions = {}) {
  const env = options.env ?? process.env;
  const router = Router();

  function db(res: Response): Db | undefined {
    try {
      return (options.db ?? getDb)();
    } catch {
      res.status(503).json({ error: 'database is not configured' });
      return undefined;
    }
  }

  router.get('/', requireTreasurer(env), async (_req, res) => {
    const conn = db(res);
    if (!conn) return;
    try {
      const body: EventsResponse = { events: await listEvents(conn) };
      res.json(body);
    } catch (err) {
      console.error('list events failed', err);
      res.status(500).json({ error: 'list events request failed' });
    }
  });

  router.post('/', requireTreasurer(env), async (req, res) => {
    const input = CreateEventRequest.safeParse(req.body);
    if (!input.success) {
      const issue = input.error.issues[0];
      res
        .status(422)
        .json({
          error: 'invalid event',
          field: issue?.path.join('.') ?? null,
          detail: issue?.message ?? null,
        });
      return;
    }
    const conn = db(res);
    if (!conn) return;
    try {
      const body: EventSummary = await createEvent(conn, input.data);
      res.status(201).json(body);
    } catch (err) {
      console.error('create event failed', err);
      res.status(500).json({ error: 'create event request failed' });
    }
  });

  return router;
}
