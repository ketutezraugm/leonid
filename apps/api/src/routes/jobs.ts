import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireJobToken } from '../auth/jobToken.js';
import { writeAudit } from '../db/audit.js';
import { getDb, type Db } from '../db/client.js';
import { listEvents } from '../db/events.js';
import { getBudgetBurn } from '../widgets/live.js';

export interface JobsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
  now?: () => Date;
}

const RecomputeBody = z.object({ eventId: z.uuid() });

// The work behind the Render Workflows tasks (apps/workflows). Called only by the Workflow service, with the JOBS_TOKEN secret;
// never by the browser. These endpoints compute and record, and move no money: anything that did would go through the executor.
//   GET  /events             -> { eventIds }: every event, for a task to fan out over
//   POST /budget-recompute   { eventId } -> the event's cleared income, committed spend and unlocked budget, now.
//                            The numbers are derived from the ledger and audit log on every read, so there is nothing stored
//                            to update; this takes the snapshot and writes it to the audit log as workflow.budget_recompute.
export function jobsRouter(options: JobsRouterOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const guard = requireJobToken(env);
  const router = Router();

  function db(res: Response): Db | undefined {
    try {
      return (options.db ?? getDb)();
    } catch {
      res.status(503).json({ error: 'database is not configured' });
      return undefined;
    }
  }

  router.get('/events', guard, async (_req, res) => {
    const conn = db(res);
    if (!conn) return;
    try {
      res.json({ eventIds: (await listEvents(conn)).map((e) => e.id) });
    } catch (err) {
      console.error('job events failed', err);
      res.status(500).json({ error: 'job failed' });
    }
  });

  router.post('/budget-recompute', guard, async (req, res) => {
    const body = RecomputeBody.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ error: 'body must be { eventId }' });
      return;
    }
    const conn = db(res);
    if (!conn) return;
    try {
      const burn = await getBudgetBurn(conn, body.data.eventId, {}, now());
      if (!burn) {
        res.status(404).json({ error: 'No such event' });
        return;
      }
      const result = {
        eventId: body.data.eventId,
        currency: burn.currency,
        clearedIncomeMinor: burn.clearedIncome,
        committedMinor: burn.committed,
        unlockedMinor: burn.unlocked,
        asOf: burn.asOf,
      };
      await writeAudit(conn, {
        actor: 'workflow:budget-recompute',
        action: 'workflow.budget_recompute',
        input: result,
        reason: 'unlocked budget recomputed from the ledger and the committed spend',
      });
      res.json(result);
    } catch (err) {
      console.error('budget recompute failed', err);
      res.status(500).json({ error: 'job failed' });
    }
  });

  return router;
}
