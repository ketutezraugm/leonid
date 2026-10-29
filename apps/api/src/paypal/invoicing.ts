import { z } from 'zod';
import type { PayPalClient } from './client.js';
import { fromPayPalMoney, PayPalMoney, toPayPalMoney } from './money.js';

// Invoicing v2: create, send, read and search. An invoice asks a sponsor for money and moves none, so it
// is not behind the rules engine. Create takes no PayPal-Request-Id (checked against PayPal's spec), so
// a retry would create a second invoice: callers must make retries safe themselves (invoices/send.ts).

export interface InvoiceItemInput {
  name: string;
  description?: string;
  quantity: number;
  unitAmountMinor: number;
}

export interface CreateInvoiceInput {
  // Our own key for the invoice (the sponsor id), stored in PayPal's detail.reference so an invoice
  // whose create response was lost can be found again with searchInvoicesByReference.
  reference: string;
  currency: string;
  // YYYY-MM-DD
  invoiceDate: string;
  // YYYY-MM-DD, or null for due on receipt.
  dueDate: string | null;
  // Shown to the sponsor on the invoice.
  note: string;
  invoicerName: string;
  recipientEmail: string;
  recipientName: string;
  items: InvoiceItemInput[];
}

export function buildInvoiceBody(input: CreateInvoiceInput) {
  return {
    detail: {
      reference: input.reference,
      currency_code: input.currency,
      invoice_date: input.invoiceDate,
      note: input.note,
      // PayPal's spec: payment_term carries "either but not both" term_type or due_date.
      payment_term: input.dueDate ? { due_date: input.dueDate } : { term_type: 'DUE_ON_RECEIPT' },
    },
    invoicer: { business_name: input.invoicerName },
    primary_recipients: [
      {
        billing_info: {
          business_name: input.recipientName,
          email_address: input.recipientEmail,
        },
      },
    ],
    items: input.items.map((item) => ({
      name: item.name,
      description: item.description,
      quantity: String(item.quantity),
      unit_amount: toPayPalMoney(item.unitAmountMinor, input.currency),
    })),
  };
}

// Without a Prefer header PayPal answers a create with a self link, not the invoice.
const Created = z.object({ id: z.string().optional(), href: z.string().optional() });

const idFromHref = (href: string) => href.split('/').filter(Boolean).pop() ?? '';

export async function createInvoice(
  client: PayPalClient,
  input: CreateInvoiceInput,
): Promise<{ id: string }> {
  const created = await client.request({
    method: 'POST',
    path: '/v2/invoicing/invoices',
    schema: Created,
    body: buildInvoiceBody(input),
  });
  const id = created.id ?? (created.href ? idFromHref(created.href) : '');
  if (!id) throw new Error('PayPal created an invoice but returned neither an id nor a link');
  return { id };
}

export interface SendInvoiceInput {
  subject: string;
  note: string;
}

// 200 when the invoice date is today, 202 when it is later; both mean PayPal accepted it.
export async function sendInvoice(
  client: PayPalClient,
  invoiceId: string,
  input: SendInvoiceInput,
): Promise<void> {
  await client.request({
    method: 'POST',
    path: `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
    schema: z.unknown(),
    body: {
      subject: input.subject,
      note: input.note,
      send_to_invoicer: true,
      send_to_recipient: true,
    },
  });
}

const InvoiceResponse = z.looseObject({
  id: z.string(),
  status: z.string(),
  detail: z.looseObject({
    reference: z.string().optional(),
    invoice_number: z.string().optional(),
    metadata: z.looseObject({ recipient_view_url: z.string().optional() }).optional(),
  }),
  amount: z.looseObject({ currency_code: z.string(), value: z.string() }).optional(),
});

export interface InvoiceView {
  id: string;
  // PayPal's own status: DRAFT, SENT, UNPAID, PARTIALLY_PAID, PAID, MARKED_AS_PAID, CANCELLED, ...
  status: string;
  invoiceNumber: string | null;
  // PayPal's hosted payer page; this is the link the sponsor pays through.
  recipientViewUrl: string | null;
  // detail.reference, which we set to the sponsor id.
  reference: string | null;
  // The invoice total (PayPal's `amount`) in minor units, or null when PayPal did not return one.
  total: { amountMinor: number; currency: string } | null;
}

function toView(invoice: z.infer<typeof InvoiceResponse>): InvoiceView {
  return {
    id: invoice.id,
    status: invoice.status,
    invoiceNumber: invoice.detail.invoice_number ?? null,
    recipientViewUrl: invoice.detail.metadata?.recipient_view_url ?? null,
    reference: invoice.detail.reference ?? null,
    total: invoice.amount ? fromPayPalMoney(PayPalMoney.parse(invoice.amount)) : null,
  };
}

export async function getInvoice(client: PayPalClient, invoiceId: string): Promise<InvoiceView> {
  const invoice = await client.request({
    method: 'GET',
    path: `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
    schema: InvoiceResponse,
  });
  return toView(invoice);
}

const SearchResponse = z.looseObject({ items: z.array(InvoiceResponse).optional() });

// POST /v2/invoicing/search-invoices with a search_data body of { reference } and page/page_size query
// parameters (checked against PayPal's Invoicing v2 OpenAPI spec). The spec does not say whether the
// reference filter is an exact match, so only exact matches are returned. Read-only: it recovers an
// invoice whose create response was lost (invoices/send.ts).
export async function searchInvoicesByReference(
  client: PayPalClient,
  reference: string,
): Promise<InvoiceView[]> {
  const found = await client.request({
    method: 'POST',
    path: '/v2/invoicing/search-invoices?page=1&page_size=100',
    schema: SearchResponse,
    body: { reference },
  });
  return (found.items ?? []).filter((i) => i.detail.reference === reference).map(toView);
}
