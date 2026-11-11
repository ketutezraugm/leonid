import { describe, expect, it, vi } from 'vitest';
import { createPayPalClient } from '../paypal/client.js';
import { createPayoutSender } from './payoutSender.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function clientFor(app: 'treasury' | 'procurement') {
  const calls: { path: string; requestId: string | null; body: { sender_batch_header: { sender_batch_id: string }; items: unknown[] } }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/oauth2/token') return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
    calls.push({ path, requestId: new Headers(init?.headers).get('PayPal-Request-Id'), body: JSON.parse(String(init?.body)) });
    return json(201, { batch_header: { payout_batch_id: 'PB-REAL', batch_status: 'PENDING', sender_batch_header: { sender_batch_id: 'claim-1' } } });
  });
  return { client: createPayPalClient({ app, clientId: 'i', clientSecret: 's', fetch }), calls };
}

const input = { referenceId: 'claim-1', recipientEmail: 'dana@example.com', amountMinor: 3_000, currency: 'USD', note: 'Leonid claim' };

describe('createPayoutSender', () => {
  it('pays one person by email from the Treasury app, with the reference id as the batch id and the request id', async () => {
    const { client, calls } = clientFor('treasury');
    expect(await createPayoutSender(() => client).send(input)).toEqual({ batchId: 'PB-REAL' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/v1/payments/payouts');
    expect(calls[0]!.requestId).toBe('payout-claim-1');
    expect(calls[0]!.body.sender_batch_header.sender_batch_id).toBe('claim-1');
    expect(calls[0]!.body.items).toEqual([
      expect.objectContaining({ recipient_type: 'EMAIL', receiver: 'dana@example.com', amount: { currency: 'USD', value: '30.00' }, note: 'Leonid claim', sender_item_id: 'claim-1' }),
    ]);
  });

  it('never pays people from the Procurement app', async () => {
    const { client, calls } = clientFor('procurement');
    await expect(createPayoutSender(() => client).send(input)).rejects.toThrow('Treasury app only');
    expect(calls).toHaveLength(0);
  });
});
