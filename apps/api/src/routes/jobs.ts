import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireJobToken } from '../auth/jobToken.js';
import { writeAudit } from '../db/audit.js';
import { getDb, type Db } from '../db/client.js';
import { listEvents } from '../db/events.js';
import { listInvoicedSponsorIds, remindSponsor } from '../invoices/remind.js';
import { getPayPalClient, type PayPalClient } from '../paypal/client.js';
import { PayPalApiError } from '../paypal/errors.js';
import { getBudgetBurn } from '../widgets/live.js';

export interface JobsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
  now?: () => Date;
  client?: () => PayPalClient;
}

const RecomputeBody = z.object({ eventId: z.uuid() });
const ReminderBody = z.object({ sponsorId: z.uuid() });

// A sponsor is reminded at most once per INVOICE_REMINDER_MIN_HOURS (default 24).
function reminderInterval(env: NodeJS.ProcessEnv): number {
  const hours = Number(env.INVOICE_REMINDER_MIN_HOURS ?? 24);
  return Number.isFinite(hours) && hours >= 0 ? hours : 24;
}

// The work behind the Render Workflows tasks (apps/workflows). Called only by the Workflow service, with the JOBS_TOKEN secret;
// never by the browser. These endpoints compute and record, and move no money: anything that did would go through the executor.
//   GET  /events             -> { eventIds }: every event, for a task to fan out over
//   POST /budget-recompute   { eventId } -> the event's cleared income, committed spend and unlocked budget, now.
//                            The numbers are derived from the ledger and audit log on every read, so there is nothing stored
//                            to update; this takes the snapshot and writes it to the audit log as workflow.budget_recompute.
//   GET  /unpaid-invoices    -> { sponsorIds }: sponsors with an invoice out and no payment, by our records
//   POST /invoice-reminder   { sponsorId } -> { sponsorId, outcome }: asks PayPal to email the sponsor a reminder, but only if
//                            PayPal still shows the invoice open and the sponsor was not reminded recently (invoices/remind.ts).
//                            A PayPal failure answers 502, so the workflow retries it.
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

  router.get('/unpaid-invoices', guard, async (_req, res) => {
    const conn = db(res);
    if (!conn) return;
    try {
      res.json({ sponsorIds: await listInvoicedSponsorIds(conn) });
    } catch (err) {
      console.error('job unpaid-invoices failed', err);
      res.status(500).json({ error: 'job failed' });
    }
  });

  router.post('/invoice-reminder', guard, async (req, res) => {
    const body = ReminderBody.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ error: 'body must be { sponsorId }' });
      return;
    }
    const conn = db(res);
    if (!conn) return;
    try {
      const client = (options.client ?? (() => getPayPalClient('treasury')))();
      const outcome = await remindSponsor(
        { db: conn, client, minIntervalHours: reminderInterval(env) },
        body.data.sponsorId,
      );
      if (outcome === 'not_found') {
        res.status(404).json({ error: 'No such sponsor' });
        return;
      }
      res.json({ sponsorId: body.data.sponsorId, outcome });
    } catch (err) {
      console.error('invoice reminder failed', err instanceof Error ? err.message : err);
      res.status(err instanceof PayPalApiError ? 502 : 500).json({ error: 'job failed' });
    }
  });

  return router;
}
