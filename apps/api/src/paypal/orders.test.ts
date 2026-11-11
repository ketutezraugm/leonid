import { describe, expect, it, vi } from 'vitest';
import { createPayPalClient } from './client.js';
import { createOrder, getOrder } from './orders.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const token = () => json(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 });

describe('createOrder', () => {
  it('posts a CAPTURE order in PayPal money and returns the buyer approval link', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(
        json(200, {
          id: '5O190127TN364715T',
          status: 'PAYER_ACTION_REQUIRED',
          links: [
            {
              href: 'https://api.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T',
              rel: 'self',
              method: 'GET',
            },
            {
              href: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T',
              rel: 'payer-action',
              method: 'GET',
            },
          ],
        }),
      );
    const client = createPayPalClient({
      app: 'treasury',
      clientId: 'id',
      clientSecret: 's',
      fetch,
    });

    const order = await createOrder(client, {
      referenceId: 'ticket-42',
      amountMinor: 14000,
      currency: 'USD',
      description: 'Ticket',
    });

    expect(order).toEqual({
      id: '5O190127TN364715T',
      status: 'PAYER_ACTION_REQUIRED',
      approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T',
    });
    const init = fetch.mock.calls[1]![1];
    expect(new Headers(init?.headers).get('PayPal-Request-Id')).toBe('order-ticket-42');
    const body = JSON.parse(String(init?.body));
    expect(body.intent).toBe('CAPTURE');
    expect(body.purchase_units[0]).toEqual({
      reference_id: 'ticket-42',
      description: 'Ticket',
      amount: { currency_code: 'USD', value: '140.00' },
    });
  });

  it('accepts the legacy approve link', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(
        json(201, {
          id: 'O1',
          status: 'CREATED',
          links: [{ href: 'https://approve', rel: 'approve' }],
        }),
      );
    const client = createPayPalClient({
      app: 'treasury',
      clientId: 'id',
      clientSecret: 's',
      fetch,
    });
    await expect(
      createOrder(client, { referenceId: 'r', amountMinor: 100, currency: 'USD' }),
    ).resolves.toMatchObject({
      approveUrl: 'https://approve',
    });
  });
});

describe('getOrder', () => {
  it('reads order status by id', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json(200, { id: 'O1', status: 'APPROVED', links: [] }));
    const client = createPayPalClient({
      app: 'treasury',
      clientId: 'id',
      clientSecret: 's',
      fetch,
    });

    await expect(getOrder(client, 'O1')).resolves.toMatchObject({ id: 'O1', status: 'APPROVED' });
    expect(fetch.mock.calls[1]![0]).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders/O1');
  });
});
