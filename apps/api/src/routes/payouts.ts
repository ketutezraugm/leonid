import { CreatePayoutRequest, PayoutsResponse } from '@quartermaster/shared';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { currentTreasurer, ownerOf, requireTreasurer, treasurerActor } from '../auth/treasurer.js';
import { getDb, type Db } from '../db/client.js';
import { getDemoEvent, getVisibleEvent } from '../db/events.js';
import { getPayments } from '../payments/context.js';
import { createDbApprovals } from '../payments/db.js';
import type { Executor } from '../payments/executor.js';
import { createPayout, listPayoutItems, payoutItemOf, type PayoutDeps } from '../payouts/service.js';

export interface PayoutsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
  // The executor. Throwing: this server cannot pay, so a payout is recorded as failed and nothing is sent.
  payments?: () => Pick<Executor, 'requestSpend'>;
}

// F17, treasurer-only.
//   POST /?        pay a prize winner or a speaker (through the rules engine; above the payout threshold it waits
//                  on the Approvals screen)
//   GET  /?eventId= every payout item of the event, claims included, newest first
export function payoutsRouter(options: PayoutsRouterOptions = {}) {
  const guard = requireTreasurer(options.env ?? process.env);
  const router = Router();

  const depsFor = (db: Db): PayoutDeps => {
    let requestSpend: PayoutDeps['requestSpend'];
    try {
      requestSpend = (options.payments ?? (() => getPayments().executor))().requestSpend;
    } catch {
      requestSpend = undefined;
    }
    const approvals = createDbApprovals(db);
    return { db, requestSpend, approvalStatus: async (ref) => (await approvals.findByReference(ref))?.status };
  };

  const handle =
    (fn: (req: Request, res: Response, db: Db) => Promise<void>): RequestHandler =>
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
        console.error('payouts request failed', err instanceof Error ? err.message : err);
        res.status(500).json({ error: 'payouts request failed' });
      }
    };

  // The named event when the caller can see it (canSeeEvent in db/events.ts), else the seeded demo event.
  const eventIdOf = async (db: Db, eventId: string | undefined, res: Response) =>
    eventId
      ? (await getVisibleEvent(db, eventId, ownerOf(currentTreasurer(res))))?.id
      : (await getDemoEvent(db))?.id;

  router.post(
    '/',
    guard,
    handle(async (req, res, db) => {
      const body = CreatePayoutRequest.safeParse(req.body);
      if (!body.success) {
        res.status(422).json({ error: 'invalid payout', issues: body.error.issues });
        return;
      }
      const { eventId: asked, ...input } = body.data;
      const eventId = await eventIdOf(db, asked, res);
      const row = eventId ? await createPayout(depsFor(db), eventId, input, treasurerActor(res)) : undefined;
      if (!row) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      res.status(201).json(PayoutsResponse.parse({ payouts: [payoutItemOf(row)] }));
    }),
  );

  router.get(
    '/',
    guard,
    handle(async (req, res, db) => {
      const query = z.object({ eventId: z.uuid().optional() }).safeParse(req.query);
      if (!query.success) {
        res.status(400).json({ error: 'invalid query' });
        return;
      }
      const eventId = await eventIdOf(db, query.data.eventId, res);
      if (!eventId) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      res.json(PayoutsResponse.parse({ payouts: await listPayoutItems(depsFor(db), eventId) }));
    }),
  );

  return router;
}
