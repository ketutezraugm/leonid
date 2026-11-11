import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireJobToken } from '../auth/jobToken.js';
import { writeAudit } from '../db/audit.js';
import { getDb, type Db } from '../db/client.js';
import { listEvents } from '../db/events.js';
import { listInvoicedSponsorIds, remindSponsor } from '../invoices/remind.js';
import { getPayPalClient, isPayPalAppConfigured, type PayPalClient } from '../paypal/client.js';
import { PayPalApiError } from '../paypal/errors.js';
import { searchTransactions } from '../paypal/search.js';
import { AgentNotConfiguredError, chatModel } from '../agents/model.js';
import { generateSponsorReport, listReportSponsorIds, type TransactionSearch } from '../reports/generate.js';
import { errorLabel } from '../reports/store.js';
import { getBudgetBurn } from '../widgets/live.js';
import type { LanguageModel } from 'ai';

export interface JobsRouterOptions {
  env?: NodeJS.ProcessEnv;
  db?: () => Db;
  now?: () => Date;
  client?: () => PayPalClient;
  // The model that phrases a sponsor report's summary. Undefined (or not configured) means the plain template is used.
  model?: () => LanguageModel | undefined;
  // How a sponsor report checks its purchases against PayPal's transaction records. Undefined: the report has no PayPal check.
  search?: () => TransactionSearch | undefined;
}

const RecomputeBody = z.object({ eventId: z.uuid() });
const ReminderBody = z.object({ sponsorId: z.uuid() });
const ReportBody = z.object({ sponsorId: z.uuid() });

function defaultModel(): LanguageModel | undefined {
  try {
    return chatModel();
  } catch (err) {
    if (err instanceof AgentNotConfiguredError) return undefined;
    throw err;
  }
}

// Transaction Search belongs to the Treasury app (paypal.md); without its credentials the report simply has no PayPal check.
function defaultSearch(): TransactionSearch | undefined {
  if (!isPayPalAppConfigured('treasury')) return undefined;
  const client = getPayPalClient('treasury');
  return (window) => searchTransactions(client, window);
}

// A sponsor is reminded at most once per INVOICE_REMINDER_MIN_HOURS (default 24).
function reminderInterval(env: NodeJS.ProcessEnv): number {
  const hours = Number(env.INVOICE_REMINDER_MIN_HOURS ?? 24);
  // Whole hours: Postgres make_interval(hours => ...) takes an integer, so 0.5 would fail every reminder.
  return Number.isFinite(hours) && hours >= 0 ? Math.floor(hours) : 24;
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
//   GET  /report-sponsors    -> { sponsorIds }: sponsors that have paid, the ones with something to report
//   POST /sponsor-report     { sponsorId } -> { sponsorId, purchases, summary }: builds the sponsor's spend report from the ledger
//                            and the executor's records, adds a summary (a model if configured, else a plain template), and
//                            publishes it at the sponsor's stable link. The link itself is NOT in the answer or the audit log:
//                            the treasurer reads it from GET /api/reports/link/:sponsorId.
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
      res.json({ eventIds: (await listEvents(conn, null)).map((e) => e.id) });
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

  router.get('/report-sponsors', guard, async (_req, res) => {
    const conn = db(res);
    if (!conn) return;
    try {
      res.json({ sponsorIds: await listReportSponsorIds(conn) });
    } catch (err) {
      console.error('job report-sponsors failed', err);
      res.status(500).json({ error: 'job failed' });
    }
  });

  router.post('/sponsor-report', guard, async (req, res) => {
    const body = ReportBody.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ error: 'body must be { sponsorId }' });
      return;
    }
    const conn = db(res);
    if (!conn) return;
    try {
      const made = await generateSponsorReport(conn, body.data.sponsorId, {
        model: (options.model ?? defaultModel)(),
        search: (options.search ?? defaultSearch)(),
        now: now(),
      });
      if (!made) {
        res.status(404).json({ error: 'No such sponsor' });
        return;
      }
      const lines = made.view.spend.lines;
      const count = (check: string) => lines.filter((l) => l.paypalCheck === check).length;
      const result = {
        sponsorId: body.data.sponsorId,
        purchases: lines.length,
        summary: made.view.narrative.source,
        // What PayPal's own transaction records said about the purchases; null when the check could not run.
        paypalCheck: made.view.spend.paypalCheckedAt ? { confirmed: count('confirmed'), differs: count('differs'), notFound: count('not_found') } : null,
      };
      await writeAudit(conn, {
        actor: 'workflow:sponsor-reports',
        action: 'workflow.sponsor_report',
        input: { ...result, spentMinor: made.view.spend.totalMinor, currency: made.view.currency },
        reason: 'sponsor spend report built from the ledger and the executor records and published',
      });
      res.json(result);
    } catch (err) {
      // Not err.message: a failed publish quotes its query parameters, and those include the report's share token.
      console.error('sponsor report failed:', errorLabel(err));
      res.status(500).json({ error: 'job failed' });
    }
  });

  return router;
}
