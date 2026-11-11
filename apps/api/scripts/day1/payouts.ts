// Day-1 test (PRD §14, P3): send one Payouts batch to a PayPal recipient and confirm the batch succeeds
// and PayPal generates PAYMENT.PAYOUTSBATCH.SUCCESS.
//
//   pnpm --filter @leonid/api day1:payouts
//   flags: --batch-id <stable id>  --amount-cents 100  --wait-minutes 3
//
// NOT production code: it creates a sandbox payout directly. Production payouts are created only by
// the rules-engine executor, with a stable sender_batch_id and PayPal-Request-Id per batch.

import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  type Clock,
  type PayPalClient,
  type StepResult,
  PayPalError,
  createClient,
  findEvents,
  formatResult,
  hasFailure,
  loadTreasuryCredentials,
  parseArgs,
  pollUntil,
  realClock,
  requireEnv,
  toPayPalValue,
} from './lib.js';

const EVENT = 'PAYMENT.PAYOUTSBATCH.SUCCESS';

const Created = z.object({
  batch_header: z.object({ payout_batch_id: z.string(), batch_status: z.string() }),
});
const Batch = z.object({
  batch_header: z.object({ payout_batch_id: z.string(), batch_status: z.string() }),
  items: z
    .array(
      z.object({
        payout_item_id: z.string(),
        transaction_status: z.string(),
        payout_item: z
          .object({ receiver: z.string().optional(), recipient_wallet: z.string().optional() })
          .optional(),
        errors: z
          .object({ name: z.string().optional(), message: z.string().optional() })
          .optional(),
      }),
    )
    .default([]),
});

const TERMINAL = new Set(['SUCCESS', 'DENIED', 'CANCELED']);

export type PayoutsOptions = {
  senderBatchId: string;
  amountCents: number;
  paypalEmail: string;
  waitMinutes: number;
  log?: (line: string) => void;
  clock?: Clock;
};

export function buildPayoutBody(
  opts: Pick<PayoutsOptions, 'senderBatchId' | 'amountCents' | 'paypalEmail'>,
) {
  return {
    sender_batch_header: {
      sender_batch_id: opts.senderBatchId,
      email_subject: 'Leonid day-1 test payout',
      email_message: 'Sandbox test payout.',
    },
    items: [
      {
        recipient_type: 'EMAIL',
        receiver: opts.paypalEmail,
        amount: { currency: 'USD', value: toPayPalValue(opts.amountCents, 'USD') },
        note: 'Leonid day-1 test (PayPal)',
        sender_item_id: `${opts.senderBatchId}-paypal`.slice(0, 63),
        recipient_wallet: 'PAYPAL',
      },
    ],
  };
}

export async function runPayouts(
  client: PayPalClient,
  opts: PayoutsOptions,
): Promise<StepResult[]> {
  const log = opts.log ?? console.log;
  const clock = opts.clock ?? realClock;
  const results: StepResult[] = [];
  const add = (step: string, status: StepResult['status'], detail: string) => {
    const r = { step, status, detail };
    results.push(r);
    log(formatResult(r));
  };

  try {
    const created = await client.request('POST', '/v1/payments/payouts', Created, {
      body: buildPayoutBody(opts),
      // Retries with the same batch id can never pay twice.
      headers: { 'PayPal-Request-Id': opts.senderBatchId },
    });
    const batchId = created.data.batch_header.payout_batch_id;
    add('payouts.create', 'PASS', `${batchId} (debug_id ${created.debugId ?? 'n/a'})`);

    const final = await pollUntil(
      clock,
      () => client.request('GET', `/v1/payments/payouts/${batchId}`, Batch),
      (r) => TERMINAL.has(r.data.batch_header.batch_status),
      { intervalMs: 10_000, timeoutMs: opts.waitMinutes * 60_000 },
    );
    const status = final.value.data.batch_header.batch_status;
    for (const item of final.value.data.items) {
      const detail = `${item.payout_item?.receiver ?? item.payout_item_id}: ${item.transaction_status}${item.errors ? ` (${item.errors.name}: ${item.errors.message})` : ''}`;
      log(`  item ${detail}`);
    }
    if (final.timedOut)
      add('payouts.batch', 'FAIL', `Still ${status} after ${opts.waitMinutes} min`);
    else add('payouts.batch', status === 'SUCCESS' ? 'PASS' : 'FAIL', `batch_status=${status}`);

    if (status === 'SUCCESS') {
      const events = await pollUntil(
        clock,
        () => findEvents(client, EVENT, batchId),
        (e) => e.length > 0,
        { intervalMs: 5_000, timeoutMs: 60_000 },
      );
      if (events.value.length > 0)
        add(
          'payouts.webhook-event',
          'PASS',
          `PayPal generated ${EVENT} (event ${events.value[0]?.id}). Confirm delivery in the receiver's logs.`,
        );
      else
        add(
          'payouts.webhook-event',
          'WARN',
          `No ${EVENT} event found for ${batchId}. Check that a webhook is subscribed to it.`,
        );
    }
  } catch (err) {
    const where =
      err instanceof PayPalError
        ? `HTTP ${err.status} ${err.path} debug_id ${err.debugId ?? 'n/a'}`
        : 'error';
    add('payouts.run', 'FAIL', `${where}: ${(err as Error).message}`);
  }
  return results;
}

const compactStamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 12);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = createClient(loadTreasuryCredentials());
  const results = await runPayouts(client, {
    senderBatchId:
      typeof args['batch-id'] === 'string' ? args['batch-id'] : `day1-${compactStamp(new Date())}`,
    amountCents: Number(args['amount-cents'] ?? 100),
    paypalEmail: requireEnv('DAY1_PAYPAL_RECIPIENT_EMAIL'),
    waitMinutes: Number(args['wait-minutes'] ?? 3),
  });
  process.exitCode = hasFailure(results) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
