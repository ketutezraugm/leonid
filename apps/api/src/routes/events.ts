import {
  CreateEventRequest,
  PlanResponse,
  SetMaxSpendRequest,
  type EventsResponse,
  type EventSummary,
} from '@leonid/shared';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { currentTreasurer, ownerOf, requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { getDb, type Db } from '../db/client.js';
import {
  createEvent,
  deleteEvent,
  getDemoEvent,
  getVisibleEvent,
  listEvents,
  setMaxSpend,
} from '../db/events.js';
import { listTasks } from '../db/tasks.js';

export interface EventsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
}

// The events the app runs (All events, the switcher) and the setup flow's first step. Treasurer only. No money moves.
// Each treasurer sees their own events plus the shared demo event (canSeeEvent in db/events.ts).
//   GET    /      -> EventsResponse (shared), soonest first
//   POST   /      CreateEventRequest -> 201 EventSummary, owned by the caller; 422 with the first problem when the body is invalid
//   GET    /:id/plan -> PlanResponse (shared): that event's own tasks; 404 unknown or not the caller's
//   PUT    /:id/max-spend SetMaxSpendRequest -> EventSummary; maxSpend null clears it; 404 unknown or not the caller's
//   DELETE /:id   -> 204; 404 unknown or not the caller's; 409 { error } for the demo event or one with money history (never deleted)
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
      const body: EventsResponse = {
        events: await listEvents(conn, ownerOf(currentTreasurer(res))),
      };
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
      res.status(422).json({
        error: 'invalid event',
        field: issue?.path.join('.') ?? null,
        detail: issue?.message ?? null,
      });
      return;
    }
    const conn = db(res);
    if (!conn) return;
    try {
      const body: EventSummary = await createEvent(
        conn,
        input.data,
        ownerOf(currentTreasurer(res)),
      );
      res.status(201).json(body);
    } catch (err) {
      console.error('create event failed', err);
      res.status(500).json({ error: 'create event request failed' });
    }
  });

  router.get('/:id/plan', requireTreasurer(env), async (req, res) => {
    // "demo" is the web's route id for the seeded event when the events list is unavailable.
    const id = req.params.id === 'demo' ? undefined : z.uuid().safeParse(req.params.id);
    if (id && !id.success) {
      res.status(404).json({ error: 'event not found' });
      return;
    }
    const conn = db(res);
    if (!conn) return;
    try {
      const event = id
        ? await getVisibleEvent(conn, id.data, ownerOf(currentTreasurer(res)))
        : await getDemoEvent(conn);
      if (!event) {
        res.status(404).json({ error: 'event not found' });
        return;
      }
      const rows = await listTasks(conn, event.id);
      const body: PlanResponse = PlanResponse.parse({
        eventDate: event.date.toISOString(),
        tasks: rows.map((t) => ({
          id: t.id,
          name: t.name,
          start: t.start.toISOString(),
          end: t.end.toISOString(),
          deadline: t.deadline?.toISOString() ?? null,
          dependsOn: t.dependsOn,
          fundedBySponsorId: t.fundedBySponsorId,
          invoiceOfSponsorId: t.invoiceOfSponsorId,
          kind: t.kind,
          workstream: t.workstream,
        })),
      });
      res.json(body);
    } catch (err) {
      console.error('read plan failed', err);
      res.status(500).json({ error: 'plan request failed' });
    }
  });

  router.put('/:id/max-spend', requireTreasurer(env), async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    const input = SetMaxSpendRequest.safeParse(req.body);
    if (!id.success) {
      res.status(404).json({ error: 'event not found' });
      return;
    }
    if (!input.success) {
      res.status(422).json({ error: 'invalid maximum spend', detail: input.error.issues[0]?.message ?? null });
      return;
    }
    const conn = db(res);
    if (!conn) return;
    try {
      const event = await setMaxSpend(
        conn,
        id.data,
        input.data.maxSpend,
        treasurerActor(res),
        ownerOf(currentTreasurer(res)),
      );
      if (!event) res.status(404).json({ error: 'event not found' });
      else res.json(event);
    } catch (err) {
      console.error('set max spend failed', err);
      res.status(500).json({ error: 'max spend request failed' });
    }
  });

  router.delete('/:id', requireTreasurer(env), async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: 'event not found' });
      return;
    }
    const conn = db(res);
    if (!conn) return;
    try {
      const result = await deleteEvent(
        conn,
        id.data,
        treasurerActor(res),
        ownerOf(currentTreasurer(res)),
      );
      if (result.kind === 'not_found') res.status(404).json({ error: 'event not found' });
      else if (result.kind === 'refused') res.status(409).json({ error: result.reason });
      else res.status(204).end();
    } catch (err) {
      console.error('delete event failed', err);
      res.status(500).json({ error: 'delete event request failed' });
    }
  });

  return router;
}
