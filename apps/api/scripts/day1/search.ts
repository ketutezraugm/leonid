// Day-1 test (PRD §14, P3): run one Transaction Search query. It needs the Transaction Search
// feature enabled on the Treasury app. Results lag by up to ~3 hours, so use webhooks for live
// numbers and this API only for reconciliation and reports.
//
//   pnpm --filter @leonid/api day1:search
//   flags: --days 7 (1 to 31)

import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  type PayPalClient,
  type StepResult,
  PayPalError,
  createClient,
  formatResult,
  hasFailure,
  loadTreasuryCredentials,
  parseArgs,
  searchWindow,
} from './lib.js';

const Page = z.object({
  transaction_details: z
    .array(
      z.object({
        transaction_info: z.object({
          transaction_id: z.string().optional(),
          transaction_event_code: z.string().optional(),
          transaction_status: z.string().optional(),
          transaction_initiation_date: z.string().optional(),
          invoice_id: z.string().optional(),
          transaction_amount: z.object({ currency_code: z.string(), value: z.string() }).optional(),
        }),
      }),
    )
    .default([]),
  total_items: z.number().optional(),
  total_pages: z.number().optional(),
  last_refreshed_datetime: z.string().optional(),
});

const MAX_PAGES = 5;

export async function runSearch(
  client: PayPalClient,
  opts: { days: number; now?: Date; log?: (line: string) => void },
): Promise<StepResult[]> {
  const log = opts.log ?? console.log;
  const results: StepResult[] = [];
  const add = (step: string, status: StepResult['status'], detail: string) => {
    const r = { step, status, detail };
    results.push(r);
    log(formatResult(r));
  };

  try {
    const { start, end } = searchWindow(opts.now ?? new Date(), opts.days);
    const rows: z.infer<typeof Page>['transaction_details'] = [];
    let lastRefreshed: string | undefined;
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
      const query = `start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&fields=all&page_size=100&page=${page}`;
      const { data } = await client.request('GET', `/v1/reporting/transactions?${query}`, Page);
      rows.push(...data.transaction_details);
      totalPages = data.total_pages ?? 1;
      lastRefreshed = data.last_refreshed_datetime ?? lastRefreshed;
    }
    for (const row of rows.slice(0, 5)) {
      const t = row.transaction_info;
      log(
        `  ${t.transaction_id} ${t.transaction_event_code} ${t.transaction_status} ${t.transaction_amount?.value ?? '?'} ${t.transaction_amount?.currency_code ?? ''} ${t.transaction_initiation_date ?? ''}`,
      );
    }
    const withInvoice = rows.filter((r) => r.transaction_info.invoice_id).length;
    add(
      'search.query',
      'PASS',
      `${rows.length} transactions in the last ${opts.days} days (${withInvoice} carry an invoice_id), last refreshed ${lastRefreshed ?? 'n/a'}`,
    );
    if (rows.length === 0) {
      add(
        'search.data',
        'WARN',
        'Zero rows is a valid answer for a fresh sandbox. Re-run after the invoice and payout tests, allowing up to 3 hours for them to appear.',
      );
    }
  } catch (err) {
    if (err instanceof PayPalError && (err.status === 403 || err.status === 401)) {
      add(
        'search.query',
        'FAIL',
        `HTTP ${err.status} debug_id ${err.debugId ?? 'n/a'}: enable the Transaction Search feature on the Treasury app (Developer Dashboard > Apps > the app > Features), then re-run.`,
      );
    } else {
      const where =
        err instanceof PayPalError
          ? `HTTP ${err.status} debug_id ${err.debugId ?? 'n/a'}`
          : 'error';
      add('search.query', 'FAIL', `${where}: ${(err as Error).message}`);
    }
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = createClient(loadTreasuryCredentials());
  const results = await runSearch(client, { days: Number(args.days ?? 7) });
  process.exitCode = hasFailure(results) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
