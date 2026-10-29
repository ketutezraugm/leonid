import { describe, expect, it, vi } from 'vitest';
import { createPayPalClient } from './client.js';
import { buildInvoiceBody, createInvoice, getInvoice, sendInvoice } from './invoicing.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const token = () => json(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 });

function clientWith(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(token());
  for (const r of responses) fetch.mockResolvedValueOnce(r);
  const client = createPayPalClient({ app: 'treasury', clientId: 'id', clientSecret: 's', fetch });
  return { client, fetch };
}

const base = {
  currency: 'USD',
  invoiceDate: '2026-11-01',
  dueDate: '2026-11-15',
  note: 'Thank you for sponsoring OpenHack 2027.',
  invoicerName: 'OpenHack 2027',
  recipientEmail: 'sponsor@example.com',
  recipientName: 'Harbor Cloud',
  items: [{ name: 'OpenHack 2027 gold sponsorship', quantity: 1, unitAmountMinor: 350_000 }],
};

describe('buildInvoiceBody', () => {
  it('converts cents to PayPal money and sets a specified due date', () => {
    const body = buildInvoiceBody(base);
    expect(body.items).toEqual([
      {
        name: 'OpenHack 2027 gold sponsorship',
        description: undefined,
        quantity: '1',
        unit_amount: { currency_code: 'USD', value: '3500.00' },
      },
    ]);
    expect(body.detail).toMatchObject({
      currency_code: 'USD',
      invoice_date: '2026-11-01',
      payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: '2026-11-15' },
    });
    expect(body.primary_recipients[0]?.billing_info).toEqual({
      business_name: 'Harbor Cloud',
      email_address: 'sponsor@example.com',
    });
    expect(body.invoicer).toEqual({ business_name: 'OpenHack 2027' });
  });

  it('is due on receipt when there is no due date', () => {
    expect(buildInvoiceBody({ ...base, dueDate: null }).detail.payment_term).toEqual({
      term_type: 'DUE_ON_RECEIPT',
    });
  });

  it('refuses an amount that is not whole minor units', () => {
    expect(() =>
      buildInvoiceBody({ ...base, items: [{ name: 'x', quantity: 1, unitAmountMinor: 10.5 }] }),
    ).toThrow(RangeError);
  });
});

describe('createInvoice', () => {
  it('posts the body and reads the invoice id from the self link PayPal answers with', async () => {
    const { client, fetch } = clientWith(
      json(201, {
        rel: 'self',
        href: 'https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-TEST-1',
        method: 'GET',
      }),
    );

    const created = await createInvoice(client, base);

    expect(created).toEqual({ id: 'INV2-TEST-1' });
    const [url, init] = fetch.mock.calls[1] ?? [];
    expect(url).toBe('https://api-m.sandbox.paypal.com/v2/invoicing/invoices');
    expect(init?.method).toBe('POST');
    // PayPal's invoice create has no idempotency key, so none is sent.
    expect((init?.headers as Record<string, string>)['PayPal-Request-Id']).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toMatchObject({ detail: { currency_code: 'USD' } });
  });

  it('accepts a response that carries the id directly', async () => {
    const { client } = clientWith(json(201, { id: 'INV2-TEST-2' }));
    expect(await createInvoice(client, base)).toEqual({ id: 'INV2-TEST-2' });
  });

  it('fails loudly when PayPal returns neither an id nor a link', async () => {
    const { client } = clientWith(json(201, {}));
    await expect(createInvoice(client, base)).rejects.toThrow(/neither an id nor a link/);
  });
});

describe('sendInvoice', () => {
  it('sends to the recipient and copies the invoicer', async () => {
    const { client, fetch } = clientWith(json(200, {}));

    await sendInvoice(client, 'INV2-TEST-1', { subject: 'Invoice from OpenHack 2027', note: 'Hello' });

    const [url, init] = fetch.mock.calls[1] ?? [];
    expect(url).toBe('https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-TEST-1/send');
    expect(JSON.parse(String(init?.body))).toEqual({
      subject: 'Invoice from OpenHack 2027',
      note: 'Hello',
      send_to_invoicer: true,
      send_to_recipient: true,
    });
  });

  it('accepts 202, which PayPal answers when the invoice date is in the future', async () => {
    const { client } = clientWith(new Response(null, { status: 202 }));
    await expect(
      sendInvoice(client, 'INV2-TEST-1', { subject: 's', note: 'n' }),
    ).resolves.toBeUndefined();
  });

  it('escapes the invoice id in the path', async () => {
    const { client, fetch } = clientWith(json(200, {}));
    await sendInvoice(client, 'INV2/../x', { subject: 's', note: 'n' });
    expect(String(fetch.mock.calls[1]?.[0])).toContain('INV2%2F..%2Fx/send');
  });
});

describe('getInvoice', () => {
  it('returns the status, number and the payer link', async () => {
    const { client } = clientWith(
      json(200, {
        id: 'INV2-TEST-1',
        status: 'SENT',
        detail: {
          invoice_number: '0001',
          metadata: { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/#TEST1' },
        },
      }),
    );
    expect(await getInvoice(client, 'INV2-TEST-1')).toEqual({
      id: 'INV2-TEST-1',
      status: 'SENT',
      invoiceNumber: '0001',
      recipientViewUrl: 'https://www.sandbox.paypal.com/invoice/p/#TEST1',
    });
  });

  it('tolerates a draft with no number or payer link yet', async () => {
    const { client } = clientWith(json(200, { id: 'INV2-TEST-1', status: 'DRAFT', detail: {} }));
    expect(await getInvoice(client, 'INV2-TEST-1')).toMatchObject({
      status: 'DRAFT',
      invoiceNumber: null,
      recipientViewUrl: null,
    });
  });
});
