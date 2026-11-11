import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createPayPalClient, type PayPalApp } from './client.js';
import { PayPalApiError, PayPalTimeoutError } from './errors.js';
import { buildPayoutBody, sendPayout, type PayoutInput } from './payouts.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const token = () => json(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 });

function clientWith(next: Response | Error, app: PayPalApp = 'treasury') {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(token());
  if (next instanceof Error) fetch.mockRejectedValueOnce(next);
  else fetch.mockResolvedValueOnce(next);
  const client = createPayPalClient({ app, clientId: 'id', clientSecret: 's', fetch });
  return { client, fetch };
}

const created = (
  id = 'BATCH-1',
  status = 'PENDING',
  senderBatchId: string | undefined = 'claim-1',
) =>
  json(201, {
    batch_header: {
      payout_batch_id: id,
      batch_status: status,
      ...(senderBatchId ? { sender_batch_header: { sender_batch_id: senderBatchId } } : {}),
    },
    links: [],
  });

const base: PayoutInput = {
  referenceId: 'claim-1',
  recipientType: 'EMAIL',
  receiver: 'volunteer@example.com',
  amountMinor: 4_250,
  currency: 'USD',
};

describe('buildPayoutBody', () => {
  it('sends one item in PayPal money, with our reference as both batch id and item id', () => {
    expect(buildPayoutBody({ ...base, note: 'Receipt refund' })).toEqual({
      sender_batch_header: {
        sender_batch_id: 'claim-1',
        email_subject: undefined,
        email_message: undefined,
      },
      items: [
        {
          recipient_type: 'EMAIL',
          receiver: 'volunteer@example.com',
          amount: { currency_code: 'USD', value: '42.50' },
          note: 'Receipt refund',
          sender_item_id: 'claim-1',
        },
      ],
    });
  });

  it('pays by PayPal id too', () => {
    const body = buildPayoutBody({
      ...base,
      recipientType: 'PAYPAL_ID',
      receiver: 'ABCDEFGHJKLMN',
    });
    expect(body.items[0]).toMatchObject({ recipient_type: 'PAYPAL_ID', receiver: 'ABCDEFGHJKLMN' });
  });

  it('never names a wallet, even when a caller tries to: payouts are PayPal-only', () => {
    const sneaky = { ...base, recipientWallet: 'VENMO', recipient_wallet: 'VENMO' } as PayoutInput;
    expect(JSON.stringify(buildPayoutBody(sneaky))).not.toMatch(/wallet|venmo/i);
  });

  it.each([
    ['zero', 0],
    ['negative', -100],
    ['fractional', 10.5],
    ['not a number', Number.NaN],
    ['beyond safe integers', Number.MAX_SAFE_INTEGER + 2],
  ])('refuses an amount that is %s', (_name, amountMinor) => {
    expect(() => buildPayoutBody({ ...base, amountMinor })).toThrow();
  });

  it('refuses a currency PayPal takes without decimals, and a malformed one', () => {
    expect(() => buildPayoutBody({ ...base, currency: 'JPY' })).toThrow(/Unsupported currency/);
    expect(() => buildPayoutBody({ ...base, currency: 'dollars' })).toThrow();
  });

  it.each([
    ['empty', ''],
    ['over PayPal’s 63 characters for an item id', 'x'.repeat(64)],
    ['with a space', 'claim 1'],
    ['with a slash', 'claim/1'],
  ])('refuses a reference id that is %s', (_name, referenceId) => {
    expect(() => buildPayoutBody({ ...base, referenceId })).toThrow();
  });

  it('accepts a reference id of exactly 63 characters', () => {
    const referenceId = 'a'.repeat(63);
    expect(buildPayoutBody({ ...base, referenceId }).items[0]?.sender_item_id).toBe(referenceId);
  });

  it('refuses a receiver that does not fit the recipient type', () => {
    expect(() => buildPayoutBody({ ...base, receiver: 'not-an-email' })).toThrow();
    expect(() =>
      buildPayoutBody({ ...base, recipientType: 'PAYPAL_ID', receiver: 'has space' }),
    ).toThrow();
    expect(() =>
      buildPayoutBody({ ...base, receiver: `${'a'.repeat(120)}@example.com` }),
    ).toThrow();
  });

  it('refuses a recipient type PayPal’s sandbox cannot pay, such as a phone number', () => {
    const phone = {
      ...base,
      recipientType: 'PHONE',
      receiver: '+15555550123',
    } as unknown as PayoutInput;
    expect(() => buildPayoutBody(phone)).toThrow();
  });

  it('refuses text longer than PayPal takes', () => {
    expect(() => buildPayoutBody({ ...base, note: 'n'.repeat(4001) })).toThrow();
    expect(() => buildPayoutBody({ ...base, emailSubject: 's'.repeat(256) })).toThrow();
    expect(() => buildPayoutBody({ ...base, emailMessage: 'm'.repeat(1001) })).toThrow();
  });
});

describe('sendPayout', () => {
  it('posts to the Payouts API with an idempotency key from our reference, and returns the batch', async () => {
    const { client, fetch } = clientWith(created());

    const result = await sendPayout(client, base);

    expect(result).toEqual({ payoutBatchId: 'BATCH-1', batchStatus: 'PENDING' });
    const [url, init] = fetch.mock.calls[1] ?? [];
    expect(String(url)).toBe('https://api-m.sandbox.paypal.com/v1/payments/payouts');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['PayPal-Request-Id']).toBe('payout-claim-1');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      sender_batch_header: { sender_batch_id: 'claim-1' },
      items: [{ sender_item_id: 'claim-1', amount: { currency_code: 'USD', value: '42.50' } }],
    });
  });

  it('sends the same ids on a retry, so PayPal sees the same payout', async () => {
    const first = clientWith(created());
    const second = clientWith(created());

    await sendPayout(first.client, base);
    await sendPayout(second.client, base);

    const idOf = (f: typeof first.fetch) =>
      (f.mock.calls[1]?.[1]?.headers as Record<string, string>)['PayPal-Request-Id'];
    expect(idOf(first.fetch)).toBe(idOf(second.fetch));
    expect(first.fetch.mock.calls[1]?.[1]?.body).toEqual(second.fetch.mock.calls[1]?.[1]?.body);
  });

  it('pays only from the Treasury app', async () => {
    const { client, fetch } = clientWith(created(), 'procurement');

    await expect(sendPayout(client, base)).rejects.toThrow(/Treasury/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('calls PayPal with nothing when the input is invalid', async () => {
    const { client, fetch } = clientWith(created());

    await expect(sendPayout(client, { ...base, amountMinor: 0 })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes PayPal’s refusal on with its debug id', async () => {
    const { client } = clientWith(
      json(422, {
        name: 'UNPROCESSABLE_ENTITY',
        debug_id: 'dbg-9',
        details: [{ issue: 'INSUFFICIENT_FUNDS' }],
      }),
    );

    const err = await sendPayout(client, base).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err).toMatchObject({ status: 422, issue: 'INSUFFICIENT_FUNDS', debugId: 'dbg-9' });
  });

  it('lets a timeout through as a timeout, because the payout may have gone out', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { client } = clientWith(timeout);

    await expect(sendPayout(client, base)).rejects.toBeInstanceOf(PayPalTimeoutError);
  });

  it('keeps a batch status it does not know instead of failing after the money went out', async () => {
    const { client } = clientWith(created('BATCH-2', 'SOMETHING_NEW'));
    expect(await sendPayout(client, base)).toEqual({
      payoutBatchId: 'BATCH-2',
      batchStatus: 'SOMETHING_NEW',
    });
  });

  it('accepts an answer that does not echo the sender batch id', async () => {
    const { client } = clientWith(created('BATCH-3', 'PENDING', undefined));
    expect((await sendPayout(client, base)).payoutBatchId).toBe('BATCH-3');
  });

  it('refuses an answer for another sender batch id', async () => {
    const { client } = clientWith(created('BATCH-4', 'PENDING', 'claim-OTHER'));
    await expect(sendPayout(client, base)).rejects.toThrow(/another sender_batch_id/);
  });
});

// money-safety.md: a function that moves money is called only by the executor. eslint.config.js blocks this for
// spend.ts; for payouts.ts the same invariant is held by this test.
describe('who may import payouts.ts', () => {
  it('is imported only from payments/ and paypal/', () => {
    const src = fileURLToPath(new URL('..', import.meta.url));
    const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !/^(payments|paypal)[\\/]/.test(file))
      .filter((file) =>
        /['"][^'"]*paypal\/payouts(\.js)?['"]/.test(readFileSync(join(src, file), 'utf8')),
      );
    expect(offenders).toEqual([]);
  });
});
