import { task } from '@renderinc/sdk/workflows';

// Render Workflows tasks (PRD §9): durable background jobs. Each task only orchestrates (steps, retries, fan-out); the real
// work happens in the API's own job endpoints, so the rules engine, the audit log and the ledger stay in one place. A task
// never holds PayPal credentials or touches the database.
//
// Environment of the Workflow service (set in the Render Dashboard, never committed):
//   API_BASE_URL   the API service's URL, for example https://quartermaster-staging.onrender.com
//   JOBS_TOKEN     the same secret the API checks on /api/jobs/* (x-job-token header)

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set on the Workflow service`);
  return value;
}

// One call to a job endpoint. Anything but a 2xx throws, so Render retries the task instead of recording a success.
async function callApi<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${setting('API_BASE_URL').replace(/\/$/, '')}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-job-token': setting('JOBS_TOKEN'), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return (await res.json()) as T;
}

interface EventBudget {
  eventId: string;
  currency: string;
  clearedIncomeMinor: number;
  committedMinor: number;
  unlockedMinor: number;
  asOf: string;
}

// Budget recompute, one event: unlocked = cleared income - committed spend, written to the audit log by the API.
export const recomputeEvent = task(
  { name: 'recompute-event', retry: { maxRetries: 3, waitDurationMs: 2000, backoffScaling: 2 }, timeoutSeconds: 120 },
  async (_ctx, eventId: string) => callApi<EventBudget>('/api/jobs/budget-recompute', { eventId }),
);

// Budget recompute, every event: one subtask per event, run in parallel, each retried on its own.
export const budgetRecompute = task({ name: 'budget-recompute', timeoutSeconds: 600 }, async (ctx) => {
  const { eventIds } = await callApi<{ eventIds: string[] }>('/api/jobs/events');
  return Promise.all(eventIds.map((eventId) => ctx.run(recomputeEvent, eventId)));
});

interface ReminderResult {
  sponsorId: string;
  outcome: string;
}

// Invoice reminder, one sponsor: the API asks PayPal for the live invoice status and only then asks PayPal to send the reminder.
export const remindSponsor = task(
  { name: 'remind-sponsor', retry: { maxRetries: 3, waitDurationMs: 2000, backoffScaling: 2 }, timeoutSeconds: 120 },
  async (_ctx, sponsorId: string) => callApi<ReminderResult>('/api/jobs/invoice-reminder', { sponsorId }),
);

// Invoice reminders, every sponsor with an unpaid invoice: one subtask per sponsor, run in parallel, each retried on its own.
export const invoiceReminders = task({ name: 'invoice-reminders', timeoutSeconds: 600 }, async (ctx) => {
  const { sponsorIds } = await callApi<{ sponsorIds: string[] }>('/api/jobs/unpaid-invoices');
  return Promise.all(sponsorIds.map((sponsorId) => ctx.run(remindSponsor, sponsorId)));
});

interface ReportResult {
  sponsorId: string;
  purchases: number;
  summary: string;
}

// Sponsor report, one sponsor: the API builds the report from the ledger and the executor's records and publishes it. The
// share link is never in this result (task results show in the Render Dashboard): the treasurer reads it from the API.
export const reportSponsor = task(
  { name: 'report-sponsor', retry: { maxRetries: 3, waitDurationMs: 2000, backoffScaling: 2 }, timeoutSeconds: 180 },
  async (_ctx, sponsorId: string) => callApi<ReportResult>('/api/jobs/sponsor-report', { sponsorId }),
);

// Sponsor reports, every sponsor that has paid: one subtask per sponsor, run in parallel, each retried on its own.
export const sponsorReports = task({ name: 'sponsor-reports', timeoutSeconds: 900 }, async (ctx) => {
  const { sponsorIds } = await callApi<{ sponsorIds: string[] }>('/api/jobs/report-sponsors');
  return Promise.all(sponsorIds.map((sponsorId) => ctx.run(reportSponsor, sponsorId)));
});
