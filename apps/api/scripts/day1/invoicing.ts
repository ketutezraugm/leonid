// Day-1 test (PRD §14, P3): create, send and pay an invoice between two sandbox accounts, then
// confirm PayPal generated INVOICING.INVOICE.PAID. Fallback if it fails: Orders checkout link.
//
//   pnpm --filter @leonid/api day1:invoicing                       create + send, then wait for payment
//   pnpm --filter @leonid/api day1:invoicing --invoice-id INV2-... resume watching an existing invoice
//   flags: --amount-cents 100  --wait-minutes 10  --no-wait

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
  webhooksFor,
} from './lib.js';

const EVENT = 'INVOICING.INVOICE.PAID';

const Created = z.object({ id: z.string().optional(), href: z.string().optional() });
const Invoice = z.object({
  id: z.string(),
  status: z.string(),
  detail: z.object({
    invoice_number: z.string().optional(),
    metadata: z.object({ recipient_view_url: z.string().optional() }).optional(),
  }),
});

export type InvoicingOptions = {
  recipientEmail: string;
  amountCents: number;
  invoiceId?: string;
  waitMinutes: number;
  now?: Date;
  log?: (line: string) => void;
  clock?: Clock;
};

export function buildInvoiceBody(recipientEmail: string, amountCents: number, today: Date) {
  return {
    detail: {
      currency_code: 'USD',
      invoice_date: today.toISOString().slice(0, 10),
      note: 'Leonid day-1 sandbox test. Not a real invoice.',
      payment_term: { term_type: 'DUE_ON_RECEIPT' },
    },
    invoicer: { business_name: 'Leonid Day-1 Test' },
    primary_recipients: [
      {
        billing_info: {
          email_address: recipientEmail,
          name: { given_name: 'Day1', surname: 'Sponsor' },
        },
      },
    ],
    items: [
      {
        name: 'Day-1 test sponsorship',
        quantity: '1',
        unit_amount: { currency_code: 'USD', value: toPayPalValue(amountCents, 'USD') },
      },
    ],
  };
}

const idFromHref = (href: string) => href.split('/').filter(Boolean).pop() ?? '';

export async function runInvoicing(
  client: PayPalClient,
  opts: InvoicingOptions,
): Promise<StepResult[]> {
  const log = opts.log ?? console.log;
  const clock = opts.clock ?? realClock;
  const results: StepResult[] = [];
  const add = (step: string, status: StepResult['status'], detail: string) => {
    const r = { step, status, detail };
    results.push(r);
    log(formatResult(r));
  };

  // Stays true if the webhook list cannot be read, so the event check still runs.
  let webhookSubscribed = true;
  try {
    const hooks = await webhooksFor(client, EVENT);
    if (hooks.length === 0) {
      webhookSubscribed = false;
      add(
        'invoicing.webhook-registered',
        'WARN',
        `No webhook is subscribed to ${EVENT} on this app, so PayPal will not generate the event. Register one (P2's Render URL or a tunnel) and re-run.`,
      );
    } else {
      add('invoicing.webhook-registered', 'PASS', hooks.map((h) => h.url).join(', '));
    }
  } catch (err) {
    add(
      'invoicing.webhook-registered',
      'WARN',
      `Could not list webhooks: ${(err as Error).message}`,
    );
  }

  let invoiceId = opts.invoiceId;
  try {
    if (!invoiceId) {
      const body = buildInvoiceBody(opts.recipientEmail, opts.amountCents, opts.now ?? new Date());
      const created = await client.request('POST', '/v2/invoicing/invoices', Created, {
        body,
        headers: { Prefer: 'return=representation' },
      });
      invoiceId =
        created.data.id ?? (created.data.href ? idFromHref(created.data.href) : undefined);
      if (!invoiceId) throw new Error('Create returned neither an id nor a self link');
      add('invoicing.create', 'PASS', `${invoiceId} (debug_id ${created.debugId ?? 'n/a'})`);

      const sent = await client.request(
        'POST',
        `/v2/invoicing/invoices/${invoiceId}/send`,
        z.object({}).passthrough(),
        {
          body: {
            subject: 'Leonid day-1 test invoice',
            note: 'Sandbox test. Please pay from your sandbox personal account.',
            send_to_invoicer: true,
            send_to_recipient: true,
          },
        },
      );
      add('invoicing.send', 'PASS', `HTTP ${sent.status} (debug_id ${sent.debugId ?? 'n/a'})`);
    }

    const id: string = invoiceId;
    const current = await client.request('GET', `/v2/invoicing/invoices/${id}`, Invoice);
    const payUrl = current.data.detail.metadata?.recipient_view_url;
    add(
      'invoicing.state',
      'PASS',
      `status=${current.data.status} number=${current.data.detail.invoice_number ?? 'n/a'}`,
    );
    log(
      `\nPay it now: open ${payUrl ?? '(no recipient_view_url returned; use the invoice email)'}`,
    );
    log(`in a private window and log in as the sandbox PERSONAL account ${opts.recipientEmail}.\n`);

    if (opts.waitMinutes <= 0) {
      add('invoicing.paid', 'SKIP', 'Run again with --invoice-id to watch for payment.');
      return results;
    }

    const paid = await pollUntil(
      clock,
      () => client.request('GET', `/v2/invoicing/invoices/${id}`, Invoice),
      (r) => r.data.status === 'PAID' || r.data.status === 'MARKED_AS_PAID',
      { intervalMs: 10_000, timeoutMs: opts.waitMinutes * 60_000 },
    );
    if (paid.timedOut) {
      add(
        'invoicing.paid',
        'FAIL',
        `Still ${paid.value.data.status} after ${opts.waitMinutes} min. Pay the invoice, then re-run with --invoice-id ${id}`,
      );
      return results;
    }
    add('invoicing.paid', 'PASS', `status=${paid.value.data.status}`);

    if (!webhookSubscribed) {
      add(
        'invoicing.webhook-event',
        'SKIP',
        `No webhook is subscribed to ${EVENT}, so PayPal fires nothing to find. Subscribe one, then re-run with --invoice-id ${id}.`,
      );
      return results;
    }

    // Event lists lag the payment a little, so give them a short window.
    const events = await pollUntil(
      clock,
      () => findEvents(client, EVENT, id),
      (e) => e.length > 0,
      { intervalMs: 5_000, timeoutMs: 60_000 },
    );
    if (events.value.length > 0) {
      add(
        'invoicing.webhook-event',
        'PASS',
        `PayPal generated ${EVENT} (event ${events.value[0]?.id}). Confirm delivery in the receiver's logs.`,
      );
    } else {
      add(
        'invoicing.webhook-event',
        'FAIL',
        `No ${EVENT} event for ${id} within 60s. Without it, F4's unlock cannot be webhook-driven: use the Orders checkout-link fallback or poll the invoice.`,
      );
    }
  } catch (err) {
    const where =
      err instanceof PayPalError
        ? `HTTP ${err.status} ${err.path} debug_id ${err.debugId ?? 'n/a'}`
        : 'error';
    add('invoicing.run', 'FAIL', `${where}: ${(err as Error).message}`);
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const creds = loadTreasuryCredentials();
  const client = createClient(creds);
  const results = await runInvoicing(client, {
    recipientEmail: requireEnv('DAY1_SPONSOR_EMAIL'),
    amountCents: Number(args['amount-cents'] ?? 100),
    waitMinutes: args['no-wait'] ? 0 : Number(args['wait-minutes'] ?? 10),
    ...(typeof args['invoice-id'] === 'string' && { invoiceId: args['invoice-id'] }),
  });
  process.exitCode = hasFailure(results) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
