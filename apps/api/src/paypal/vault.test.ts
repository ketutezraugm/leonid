import { describe, expect, it, vi } from 'vitest';
import { createPayPalClient } from './client.js';
import { chargeVaultedWallet } from './spend.js';
import { createPaymentToken, createWalletSetup, deletePaymentToken } from './vault.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const token = () => json(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 });

function clientWith(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(token());
  for (const r of responses) fetch.mockResolvedValueOnce(r);
  return { fetch, client: createPayPalClient({ app: 'procurement', clientId: 'id', clientSecret: 's', fetch }) };
}
const lastCall = (fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>) => {
  const [url, init] = fetch.mock.calls.at(-1)!;
  return { url: String(url), init: init!, body: init?.body ? JSON.parse(String(init.body)) : undefined };
};

describe('createWalletSetup', () => {
  it('asks for a merchant-initiated setup token and returns the approve link', async () => {
    const { fetch, client } = clientWith(
      json(201, {
        id: '6FW111286F2937909',
        status: 'PAYER_ACTION_REQUIRED',
        links: [
          { rel: 'approve', href: 'https://www.sandbox.paypal.com/agreements/approve?approval_session_id=6FW111286F2937909' },
          { rel: 'self', href: 'https://api.sandbox.paypal.com/v3/vault/setup-tokens/6FW111286F2937909' },
        ],
      }),
    );
    const setup = await createWalletSetup(client, { referenceId: 'w1', returnUrl: 'https://x/ok', cancelUrl: 'https://x/no' });
    expect(setup).toEqual({
      setupTokenId: '6FW111286F2937909',
      approveUrl: 'https://www.sandbox.paypal.com/agreements/approve?approval_session_id=6FW111286F2937909',
    });
    const call = lastCall(fetch);
    expect(call.url).toContain('/v3/vault/setup-tokens');
    expect((call.init.headers as Record<string, string>)['PayPal-Request-Id']).toBe('wallet-setup-w1');
    expect(call.body.payment_source.paypal).toMatchObject({
      usage_type: 'MERCHANT',
      experience_context: { return_url: 'https://x/ok', cancel_url: 'https://x/no' },
    });
  });

  it('allows one token per payer by default and several only when the demo pool opts in', async () => {
    const body = { id: 'T', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'approve', href: 'https://x/approve' }] };
    const one = clientWith(json(201, body));
    await createWalletSetup(one.client, { referenceId: 'a', returnUrl: 'r', cancelUrl: 'c' });
    expect(lastCall(one.fetch).body.payment_source.paypal.permit_multiple_payment_tokens).toBe(false);
    const pool = clientWith(json(201, body));
    await createWalletSetup(pool.client, { referenceId: 'b', returnUrl: 'r', cancelUrl: 'c', permitMultipleTokens: true });
    expect(lastCall(pool.fetch).body.payment_source.paypal.permit_multiple_payment_tokens).toBe(true);
  });

  it('fails loudly when PayPal returns no approve link', async () => {
    const { client } = clientWith(json(201, { id: 'T', status: 'PAYER_ACTION_REQUIRED', links: [] }));
    await expect(createWalletSetup(client, { referenceId: 'w2', returnUrl: 'a', cancelUrl: 'b' })).rejects.toThrow('approve link');
  });
});

describe('createPaymentToken', () => {
  it('exchanges the approved setup token for a payment token', async () => {
    const { fetch, client } = clientWith(
      json(201, { id: 'pt_123', customer: { id: 'cust_1' }, payment_source: { paypal: { email_address: 'p@example.com' } } }),
    );
    const wallet = await createPaymentToken(client, { setupTokenId: 'ST1' });
    expect(wallet).toEqual({ paymentTokenId: 'pt_123', customerId: 'cust_1', payerEmail: 'p@example.com' });
    expect(lastCall(fetch).body).toEqual({ payment_source: { token: { id: 'ST1', type: 'SETUP_TOKEN' } } });
  });
});

describe('deletePaymentToken (kill switch)', () => {
  it('deletes the token and accepts the empty 204 response', async () => {
    const { fetch, client } = clientWith(new Response(null, { status: 204 }));
    await expect(deletePaymentToken(client, 'pt_123')).resolves.toBeUndefined();
    const call = lastCall(fetch);
    expect(call.init.method).toBe('DELETE');
    expect(call.url).toContain('/v3/vault/payment-tokens/pt_123');
  });
});

describe('chargeVaultedWallet', () => {
  it('charges with vault_id and an idempotency key from our own record id', async () => {
    const { fetch, client } = clientWith(
      json(201, {
        id: 'ORDER1',
        status: 'COMPLETED',
        purchase_units: [{ payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '140.00' } }] } }],
      }),
    );
    const charge = await chargeVaultedWallet(client, { referenceId: 'cart-9', paymentTokenId: 'pt_123', amountMinor: 14000, currency: 'USD' });
    expect(charge).toEqual({ orderId: 'ORDER1', captureId: 'CAP1', status: 'COMPLETED' });
    const call = lastCall(fetch);
    expect((call.init.headers as Record<string, string>)['PayPal-Request-Id']).toBe('charge-cart-9');
    expect(call.body.payment_source).toEqual({ paypal: { vault_id: 'pt_123' } });
    expect(call.body.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '140.00' });
  });

  it('surfaces PayPal refusing a deleted token (the kill switch)', async () => {
    const { client } = clientWith(json(403, { name: 'NOT_AUTHORIZED', details: [{ issue: 'PERMISSION_DENIED' }] }));
    await expect(
      chargeVaultedWallet(client, { referenceId: 'cart-10', paymentTokenId: 'gone', amountMinor: 1000, currency: 'USD' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
