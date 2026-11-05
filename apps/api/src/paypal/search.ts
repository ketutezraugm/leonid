import { z } from 'zod';
import type { PayPalClient } from './client.js';
import { fromPayPalSignedMoney, PayPalMoney } from './money.js';

// Transaction Search: GET /v1/reporting/transactions (request and response shapes checked with the APIMatic plugin: the
// SearchTransactions endpoint and the TransactionInformation model). Read-only, and never the live source of truth: a transaction
// takes up to ~3 hours to appear, so webhooks stay the money state and this only checks them afterwards (invariant 5).

const Page = z.looseObject({
  transaction_details: z
    .array(
      z.looseObject({
        transaction_info: z.looseObject({
          transaction_id: z.string().optional(),
          // The related base id, for example the order a capture belongs to.
          paypal_reference_id: z.string().optional(),
          // S success, P pending, D denied, V reversed or refunded in full.
          transaction_status: z.string().optional(),
          transaction_amount: PayPalMoney.optional(),
        }),
      }),
    )
    .default([]),
  total_pages: z.number().optional(),
});

export interface FoundTransaction {
  transactionId: string | null;
  referenceId: string | null;
  status: string | null;
  amountMinor: number | null; // gross, signed
  currency: string | null;
}

export const SEARCH_MAX_DAYS = 31;
const PAGE_SIZE = 100;
// ponytail: five pages (500 transactions) per window; a demo event is far below that. Raise it if an event ever is not.
const MAX_PAGES = 5;
// Transaction Search rejects fractional seconds.
const stamp = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

// Every transaction of the account between start and end (31 days at most), balance-affecting ones only.
export async function searchTransactions(client: PayPalClient, window: { start: Date; end: Date }): Promise<FoundTransaction[]> {
  if (window.end.getTime() - window.start.getTime() > SEARCH_MAX_DAYS * 86_400_000) {
    throw new RangeError(`Transaction Search covers ${SEARCH_MAX_DAYS} days per request`);
  }
  const found: FoundTransaction[] = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page += 1) {
    const query = `start_date=${encodeURIComponent(stamp(window.start))}&end_date=${encodeURIComponent(stamp(window.end))}&fields=transaction_info&page_size=${PAGE_SIZE}&page=${page}`;
    const res = await client.request({ method: 'GET', path: `/v1/reporting/transactions?${query}`, schema: Page });
    totalPages = res.total_pages ?? 1;
    for (const { transaction_info: t } of res.transaction_details) {
      const money = t.transaction_amount ? fromPayPalSignedMoney(t.transaction_amount) : undefined;
      found.push({
        transactionId: t.transaction_id ?? null,
        referenceId: t.paypal_reference_id ?? null,
        status: t.transaction_status ?? null,
        amountMinor: money?.amountMinor ?? null,
        currency: money?.currency ?? null,
      });
    }
  }
  return found;
}
