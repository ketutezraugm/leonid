import { describe, expect, it, vi } from 'vitest';
import { createPayPalClient } from './client.js';
import { searchTransactions } from './search.js';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const token = () => json(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 });

function clientWith(...pages: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(token());
  for (const p of pages) fetch.mockResolvedValueOnce(p);
  return { client: createPayPalClient({ app: 'treasury', clientId: 'i', clientSecret: 's', fetch }), fetch };
}

const tx = (id: string, extra: Record<string, unknown> = {}) => ({
  transaction_info: { transaction_id: id, transaction_status: 'S', transaction_amount: { currency_code: 'USD', value: '420.00' }, ...extra },
});

describe('searchTransactions', () => {
  it('asks for the window with whole-second timestamps, transaction_info only, and reads ids, status and gross amount', async () => {
    const { client, fetch } = clientWith(json(200, { transaction_details: [tx('CAP1', { paypal_reference_id: 'ORDER1' })], total_pages: 1 }));
    const found = await searchTransactions(client, { start: new Date('2026-11-02T00:00:00.123Z'), end: new Date('2026-11-05T12:00:00.987Z') });
    expect(found).toEqual([{ transactionId: 'CAP1', referenceId: 'ORDER1', status: 'S', amountMinor: 42_000, currency: 'USD' }]);
    const url = new URL(String(fetch.mock.calls[1]?.[0]));
    expect(url.pathname).toBe('/v1/reporting/transactions');
    expect(url.searchParams.get('start_date')).toBe('2026-11-02T00:00:00Z'); // no fractional seconds: PayPal rejects them
    expect(url.searchParams.get('end_date')).toBe('2026-11-05T12:00:00Z');
    expect(url.searchParams.get('fields')).toBe('transaction_info');
  });

  it('follows the pages, and keeps a negative (refund) amount negative', async () => {
    const { client, fetch } = clientWith(
      json(200, { transaction_details: [tx('A')], total_pages: 2 }),
      json(200, { transaction_details: [tx('B', { transaction_amount: { currency_code: 'USD', value: '-5.00' } })], total_pages: 2 }),
    );
    const found = await searchTransactions(client, { start: new Date('2026-11-02T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') });
    expect(found.map((f) => [f.transactionId, f.amountMinor])).toEqual([['A', 42_000], ['B', -500]]);
    expect(new URL(String(fetch.mock.calls[2]?.[0])).searchParams.get('page')).toBe('2');
  });

  it('refuses a window longer than 31 days instead of sending a request PayPal would reject', async () => {
    const { client, fetch } = clientWith();
    await expect(searchTransactions(client, { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-11-05T00:00:00Z') })).rejects.toThrow('31 days');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers an empty list for an account with no transactions', async () => {
    const { client } = clientWith(json(200, {}));
    expect(await searchTransactions(client, { start: new Date('2026-11-02T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') })).toEqual([]);
  });
});
