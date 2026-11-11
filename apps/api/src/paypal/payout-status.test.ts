import { PayoutItemStatus } from '@leonid/shared';
import { describe, expect, it, vi } from 'vitest';
import { createPayPalClient } from './client.js';
import { getPayoutBatch, payoutItemStatusOf } from './payout-status.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWith(next: Response) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      json(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }),
    )
    .mockResolvedValueOnce(next);
  return {
    client: createPayPalClient({ app: 'treasury', clientId: 'id', clientSecret: 's', fetch }),
    fetch,
  };
}

describe('getPayoutBatch', () => {
  it('reads the batch and each item with the reference id we sent', async () => {
    const { client, fetch } = clientWith(
      json(200, {
        batch_header: { payout_batch_id: 'BATCH-1', batch_status: 'SUCCESS' },
        items: [
          {
            payout_item_id: 'ITEM-1',
            transaction_status: 'SUCCESS',
            payout_item: { sender_item_id: 'claim-1' },
          },
        ],
      }),
    );

    const batch = await getPayoutBatch(client, 'BATCH-1');

    expect(batch).toEqual({
      payoutBatchId: 'BATCH-1',
      batchStatus: 'SUCCESS',
      items: [
        {
          payoutItemId: 'ITEM-1',
          senderItemId: 'claim-1',
          transactionStatus: 'SUCCESS',
          error: null,
        },
      ],
    });
    const [url, init] = fetch.mock.calls[1] ?? [];
    expect(String(url)).toBe(
      'https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH-1?page_size=100',
    );
    expect(init?.method).toBe('GET');
  });

  it('keeps PayPal’s error name for a failed item', async () => {
    const { client } = clientWith(
      json(200, {
        batch_header: { payout_batch_id: 'B', batch_status: 'SUCCESS' },
        items: [
          {
            payout_item_id: 'I',
            transaction_status: 'FAILED',
            errors: { name: 'RECEIVER_UNREGISTERED', debug_id: 'd1' },
          },
        ],
      }),
    );

    expect((await getPayoutBatch(client, 'B')).items[0]).toMatchObject({
      transactionStatus: 'FAILED',
      error: 'RECEIVER_UNREGISTERED',
    });
  });

  it('reads a denied batch that has no items, and an item with no status yet', async () => {
    const denied = clientWith(
      json(200, { batch_header: { payout_batch_id: 'B', batch_status: 'DENIED' } }),
    );
    expect(await getPayoutBatch(denied.client, 'B')).toMatchObject({
      batchStatus: 'DENIED',
      items: [],
    });

    const bare = clientWith(
      json(200, {
        batch_header: { payout_batch_id: 'B', batch_status: 'PENDING' },
        items: [{ payout_item_id: 'I' }],
      }),
    );
    expect((await getPayoutBatch(bare.client, 'B')).items[0]).toEqual({
      payoutItemId: 'I',
      senderItemId: null,
      transactionStatus: null,
      error: null,
    });
  });

  it('puts an id with unsafe characters in the path safely', async () => {
    const { client, fetch } = clientWith(
      json(200, { batch_header: { payout_batch_id: 'x', batch_status: 'PENDING' } }),
    );

    await getPayoutBatch(client, 'a/../b?c');

    expect(String(fetch.mock.calls[1]?.[0])).toContain(
      '/v1/payments/payouts/a%2F..%2Fb%3Fc?page_size=100',
    );
  });
});

describe('payoutItemStatusOf', () => {
  const KNOWN = [
    'SUCCESS',
    'FAILED',
    'PENDING',
    'ONHOLD',
    'UNCLAIMED',
    'BLOCKED',
    'RETURNED',
    'REFUNDED',
    'REVERSED',
  ];

  it.each([
    ['SUCCESS', 'paid'],
    ['FAILED', 'failed'],
    ['PENDING', 'processing'],
    ['ONHOLD', 'processing'],
    ['UNCLAIMED', 'unclaimed'],
    ['BLOCKED', 'blocked'],
    ['RETURNED', 'returned'],
    ['REFUNDED', 'returned'],
    ['REVERSED', 'returned'],
  ])('maps PayPal’s %s to %s', (paypal, ours) => {
    expect(payoutItemStatusOf(paypal)).toBe(ours);
  });

  it('only ever answers with a status our shared shape knows', () => {
    for (const status of KNOWN) {
      expect(PayoutItemStatus.safeParse(payoutItemStatusOf(status)).success).toBe(true);
    }
  });

  it('does not guess at a status it has not heard of, so nobody is marked paid by mistake', () => {
    expect(payoutItemStatusOf('SOMETHING_NEW')).toBeUndefined();
    expect(payoutItemStatusOf('success')).toBeUndefined();
    expect(payoutItemStatusOf(null)).toBeUndefined();
    expect(payoutItemStatusOf('constructor')).toBeUndefined();
    expect(payoutItemStatusOf('__proto__')).toBeUndefined();
  });
});
