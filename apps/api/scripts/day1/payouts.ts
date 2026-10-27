// Day-1 test (PRD §14, P3): send one Payouts batch to a PayPal recipient and a Venmo recipient and
// confirm the batch succeeds. Fallback if Venmo fails: PayPal-only payouts.
//
//   pnpm --filter @quartermaster/api day1:payouts
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

// The docs show the Venmo wallet as VENMO in one place and Venmo in another, so the script tries both.
export type WalletCasing = 'VENMO' | 'Venmo';

export type PayoutsOptions = {
  senderBatchId: string;
  amountCents: number;
  paypalEmail: string;
  venmo?: { recipientType: 'USER_HANDLE' | 'EMAIL'; receiver: string };
  waitMinutes: number;
  log?: (line: string) => void;
  clock?: Clock;
};

export function buildPayoutBody(
  opts: Pick<PayoutsOptions, 'senderBatchId' | 'amountCents' | 'paypalEmail' | 'venmo'>,
  venmoCasing: WalletCasing = 'VENMO',
) {
  const amount = { currency: 'USD', value: toPayPalValue(opts.amountCents, 'USD') };
  const items: Record<string, unknown>[] = [
    {
      recipient_type: 'EMAIL',
      receiver: opts.paypalEmail,
      amount,
      note: 'Quartermaster day-1 test (PayPal)',
      sender_item_id: `${opts.senderBatchId}-paypal`.slice(0, 63),
      recipient_wallet: 'PAYPAL',
    },
  ];
  if (opts.venmo) {
    items.push({
      recipient_type: opts.venmo.recipientType,
      receiver: opts.venmo.receiver,
      amount,
      note: 'Quartermaster day-1 test (Venmo)',
      sender_item_id: `${opts.senderBatchId}-venmo`.slice(0, 63),
      recipient_wallet: venmoCasing,
    });
  }
  return {
    sender_batch_header: {
      sender_batch_id: opts.senderBatchId,
      email_subject: 'Quartermaster day-1 test payout',
      email_message: 'Sandbox test payout.',
    },
    items,
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

  const create = (batchOpts: Parameters<typeof buildPayoutBody>[0], casing: WalletCasing) =>
    client.request('POST', '/v1/payments/payouts', Created, {
      body: buildPayoutBody(batchOpts, casing),
      // Retries with the same batch id can never pay twice.
      headers: { 'PayPal-Request-Id': batchOpts.senderBatchId },
    });

  let batchId: string | undefined;
  let withVenmo = Boolean(opts.venmo);
  try {
    if (!opts.venmo) {
      add('payouts.venmo', 'SKIP', 'Set DAY1_VENMO_HANDLE (or DAY1_VENMO_EMAIL) to test Venmo.');
    } else {
      let venmoError: PayPalError | undefined;
      for (const casing of ['VENMO', 'Venmo'] as const) {
        try {
          const created = await create(opts, casing);
          batchId = created.data.batch_header.payout_batch_id;
          add(
            'payouts.create',
            'PASS',
            `${batchId} with recipient_wallet=${casing} (debug_id ${created.debugId ?? 'n/a'})`,
          );
          venmoError = undefined;
          break;
        } catch (err) {
          if (!(err instanceof PayPalError) || err.status >= 500) throw err;
          venmoError = err;
        }
      }
      if (venmoError) {
        add(
          'payouts.venmo',
          'FAIL',
          `Venmo item rejected (HTTP ${venmoError.status}, debug_id ${venmoError.debugId ?? 'n/a'}): ${venmoError.body.slice(0, 300)}`,
        );
        withVenmo = false;
      }
    }

    if (!batchId) {
      // Fallback from the PRD: PayPal-only payouts. Proves the batch path works without Venmo.
      const fallbackId = withVenmo ? opts.senderBatchId : `${opts.senderBatchId}-paypal-only`;
      const created = await create(
        { ...opts, senderBatchId: fallbackId, venmo: undefined },
        'VENMO',
      );
      batchId = created.data.batch_header.payout_batch_id;
      add(
        'payouts.create',
        'PASS',
        `${batchId} (${opts.venmo ? 'PayPal-only fallback' : 'PayPal only, Venmo not configured'}, debug_id ${created.debugId ?? 'n/a'})`,
      );
    }

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
        () => findEvents(client, EVENT, batchId as string),
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
  const handle = process.env.DAY1_VENMO_HANDLE;
  const venmoEmail = process.env.DAY1_VENMO_EMAIL;
  const venmo = handle
    ? ({ recipientType: 'USER_HANDLE', receiver: handle } as const)
    : venmoEmail
      ? ({ recipientType: 'EMAIL', receiver: venmoEmail } as const)
      : undefined;
  const results = await runPayouts(client, {
    senderBatchId:
      typeof args['batch-id'] === 'string' ? args['batch-id'] : `day1-${compactStamp(new Date())}`,
    amountCents: Number(args['amount-cents'] ?? 100),
    paypalEmail: requireEnv('DAY1_PAYPAL_RECIPIENT_EMAIL'),
    ...(venmo && { venmo }),
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
