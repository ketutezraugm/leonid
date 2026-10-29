import express from 'express';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { auditLog, sponsors } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import type { PayPalClient, PayPalRequest } from '../paypal/client.js';
import { PayPalApiError } from '../paypal/errors.js';
import { invoicesRouter } from '../routes/invoices.js';
import { buildSponsorInvoiceDraft, draftForSponsor } from './draft.js';
import { CREATE_LEASE_SECONDS, InvoiceRefusedError, markSponsorInvoiced, sendSponsorInvoice } from './send.js';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

interface FakeInvoice {
  status: string;
  reference?: string;
  value: string;
  currency: string;
}

interface CreateBody {
  detail: { reference?: string; currency_code: string };
  items: { quantity: string; unit_amount: { value: string } }[];
}

// A tiny in-memory PayPal Invoicing: create returns a self link, send flips DRAFT to SENT, get reads it,
// search filters by reference.
function fakePayPal() {
  const calls: Call[] = [];
  const state = {
    next: 0,
    invoices: new Map<string, FakeInvoice>(),
    failCreate: false,
    failNextSend: false,
    // PayPal creates the invoice, but the answer never reaches us (a timeout or a dropped connection).
    loseCreateResponse: false,
    onCreate: undefined as undefined | (() => Promise<void>),
  };
  const view = (id: string, inv: FakeInvoice) => ({
    id,
    status: inv.status,
    detail: {
      reference: inv.reference,
      invoice_number: '0001',
      metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${id}` },
    },
    amount: { currency_code: inv.currency, value: inv.value },
  });
  const client: PayPalClient = {
    app: 'treasury',
    getAccessToken: async () => 'tok',
    async request<T>(req: PayPalRequest<T>): Promise<T> {
      calls.push({ method: req.method, path: req.path, body: req.body });
      if (req.method === 'POST' && req.path === '/v2/invoicing/invoices') {
        await state.onCreate?.();
        if (state.failCreate) {
          throw new PayPalApiError({ status: 422, errorName: 'UNPROCESSABLE_ENTITY', issue: 'INVALID_EMAIL', debugId: 'dbg-1' });
        }
        const body = req.body as CreateBody;
        const cents = body.items.reduce(
          (sum, i) => sum + Number(i.quantity) * Math.round(Number(i.unit_amount.value) * 100),
          0,
        );
        const id = `INV2-TEST-${++state.next}`;
        state.invoices.set(id, {
          status: 'DRAFT',
          reference: body.detail.reference,
          value: (cents / 100).toFixed(2),
          currency: body.detail.currency_code,
        });
        if (state.loseCreateResponse) {
          state.loseCreateResponse = false;
          throw new Error('socket hang up');
        }
        return req.schema.parse({
          rel: 'self',
          href: `https://api.sandbox.paypal.com/v2/invoicing/invoices/${id}`,
          method: 'GET',
        });
      }
      if (req.method === 'POST' && req.path.startsWith('/v2/invoicing/search-invoices')) {
        const { reference } = req.body as { reference: string };
        const items = [...state.invoices].filter(([, inv]) => inv.reference === reference).map(([id, inv]) => view(id, inv));
        return req.schema.parse({ items });
      }
      const send = /^\/v2\/invoicing\/invoices\/([^/]+)\/send$/.exec(req.path);
      if (req.method === 'POST' && send?.[1]) {
        if (state.failNextSend) {
          state.failNextSend = false;
          throw new PayPalApiError({ status: 500, errorName: 'INTERNAL_SERVER_ERROR', debugId: 'dbg-2' });
        }
        const inv = state.invoices.get(decodeURIComponent(send[1]));
        if (inv) inv.status = 'SENT';
        return req.schema.parse(undefined);
      }
      const get = /^\/v2\/invoicing\/invoices\/([^/]+)$/.exec(req.path);
      if (req.method === 'GET' && get?.[1]) {
        const id = decodeURIComponent(get[1]);
        const inv = state.invoices.get(id);
        if (!inv) throw new PayPalApiError({ status: 404, errorName: 'RESOURCE_NOT_FOUND', debugId: 'dbg-3' });
        return req.schema.parse(view(id, inv));
      }
      throw new Error(`unexpected PayPal call ${req.method} ${req.path}`);
    },
  };
  const count = (method: string, suffix: string) =>
    calls.filter((c) => c.method === method && c.path.endsWith(suffix)).length;
  return {
    client,
    calls,
    state,
    // An invoice that already exists at PayPal, for the Harbor Cloud pledge unless overridden.
    put: (id: string, status: string, over: Partial<FakeInvoice> = {}) =>
      state.invoices.set(id, { status, reference: sponsorId, value: '3500.00', currency: 'USD', ...over }),
    creates: () => calls.filter((c) => c.method === 'POST' && c.path === '/v2/invoicing/invoices').length,
    searches: () => calls.filter((c) => c.path.startsWith('/v2/invoicing/search-invoices')).length,
    sends: () => count('POST', '/send'),
  };
}

const NOW = () => new Date('2026-11-01T10:00:00Z');
const EMAIL = 'sponsor@example.com';

let db: Db;
let paypal: ReturnType<typeof fakePayPal>;
let sponsorId: string;
let event: { name: string; currency: string };

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.execute(sql`truncate table audit_log, events restart identity cascade`);
  const seeded = await seedDemoEvent(db);
  event = { name: seeded.name, currency: seeded.currency };
  const [sponsor] = await db.select().from(sponsors).where(eq(sponsors.name, 'Harbor Cloud'));
  if (!sponsor) throw new Error('seed has no Harbor Cloud');
  sponsorId = sponsor.id;
  paypal = fakePayPal();
});

const sponsorRow = async () => (await db.select().from(sponsors).where(eq(sponsors.id, sponsorId)))[0];
const auditActions = async () => (await db.select().from(auditLog)).map((r) => r.action).sort();
const draft = async () => {
  const row = await sponsorRow();
  if (!row) throw new Error('sponsor missing');
  return buildSponsorInvoiceDraft(row, event);
};
const send = async (over: Partial<Parameters<typeof sendSponsorInvoice>[1]> = {}) =>
  sendSponsorInvoice(
    { db, client: paypal.client, now: NOW },
    { sponsorId, draft: await draft(), recipientEmail: EMAIL, actor: 'treasurer', ...over },
  );

describe('buildSponsorInvoiceDraft', () => {
  it('invoices the whole pledge as one line, due in two weeks', async () => {
    const d = await draft();
    expect(d).toMatchObject({
      sponsorId,
      currency: 'USD',
      dueInDays: 14,
      items: [{ quantity: 1, unitAmount: 350_000 }],
    });
    expect(d.items[0]?.name).toBe('OpenHack 2027 gold sponsorship');
    expect(d.note).toContain('OpenHack 2027');
    expect(d.reasoning).toContain('3500.00 USD');
  });

  it('refuses to draft a sponsor with no pledge', () => {
    expect(() =>
      buildSponsorInvoiceDraft({ id: 's', name: 'Nobody', tier: 'bronze', pledged: 0 }, event),
    ).toThrow(/no pledge/);
  });

  it('loads a draft for a stored sponsor, and nothing for an unknown one', async () => {
    expect((await draftForSponsor(db, sponsorId))?.draft.items[0]?.unitAmount).toBe(350_000);
    expect(await draftForSponsor(db, '00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });
});

describe('sendSponsorInvoice', () => {
  it('creates and sends the PayPal invoice, then records it on the sponsor', async () => {
    const sent = await send();

    expect(sent).toEqual({
      paypalInvoiceId: 'INV2-TEST-1',
      invoiceNumber: '0001',
      recipientViewUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-TEST-1',
      resumed: false,
    });
    expect(await sponsorRow()).toMatchObject({ paypalInvoiceId: 'INV2-TEST-1', status: 'invoiced' });
    expect(paypal.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /v2/invoicing/invoices',
      'POST /v2/invoicing/invoices/INV2-TEST-1/send',
      'GET /v2/invoicing/invoices/INV2-TEST-1',
    ]);
    expect(await auditActions()).toEqual(['invoice.create', 'invoice.sent']);
  });

  it('sends the pledge in PayPal money, to the recipient, with the due date counted from today', async () => {
    await send();

    const created = paypal.calls[0]?.body as {
      items: { unit_amount: { currency_code: string; value: string } }[];
      detail: { payment_term: unknown; reference: string };
      primary_recipients: { billing_info: { email_address: string; business_name: string } }[];
      invoicer: { business_name: string };
    };
    expect(created.items[0]?.unit_amount).toEqual({ currency_code: 'USD', value: '3500.00' });
    expect(created.detail.payment_term).toEqual({ due_date: '2026-11-15' });
    // The sponsor id is the reference that finds this invoice again if its create response is lost.
    expect(created.detail.reference).toBe(sponsorId);
    expect(created.primary_recipients[0]?.billing_info).toEqual({ business_name: 'Harbor Cloud', email_address: EMAIL });
    expect(created.invoicer.business_name).toBe('OpenHack 2027');
    expect(paypal.calls[1]?.body).toMatchObject({ subject: 'Invoice from OpenHack 2027', send_to_recipient: true });
  });

  it('makes a zero-day draft due on receipt', async () => {
    await send({ draft: { ...(await draft()), dueInDays: 0 } });
    const created = paypal.calls[0]?.body as { detail: { payment_term: unknown } };
    expect(created.detail.payment_term).toEqual({ term_type: 'DUE_ON_RECEIPT' });
  });

  it('refuses a sponsor that is already invoiced, without touching PayPal again', async () => {
    await send();
    const before = paypal.calls.length;

    await expect(send()).rejects.toMatchObject({ name: 'InvoiceRefusedError', code: 'already_invoiced' });
    expect(paypal.calls).toHaveLength(before);
  });

  it('refuses a sponsor that has already paid', async () => {
    await db.update(sponsors).set({ status: 'paid' }).where(eq(sponsors.id, sponsorId));
    await expect(send()).rejects.toMatchObject({ code: 'already_paid' });
    expect(paypal.calls).toHaveLength(0);
  });

  it('refuses an unknown sponsor', async () => {
    await expect(send({ sponsorId: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({
      code: 'sponsor_not_found',
    });
  });

  it.each([
    ['an amount that is not the pledge', (d: Awaited<ReturnType<typeof draft>>) => ({ ...d, items: [{ name: 'x', quantity: 1, unitAmount: 1 }] })],
    ['a quantity that changes the total', (d: Awaited<ReturnType<typeof draft>>) => ({ ...d, items: [{ name: 'x', quantity: 2, unitAmount: 350_000 }] })],
    ['another currency', (d: Awaited<ReturnType<typeof draft>>) => ({ ...d, currency: 'EUR' })],
    ['another sponsor', (d: Awaited<ReturnType<typeof draft>>) => ({ ...d, sponsorId: 'someone-else' })],
  ])('refuses a draft with %s', async (_name, tamper) => {
    await expect(send({ draft: tamper(await draft()) })).rejects.toMatchObject({ code: 'draft_mismatch' });
    expect(paypal.calls).toHaveLength(0);
    expect((await sponsorRow())?.status).toBe('pledged');
  });

  it('rejects a recipient address that is not an email', async () => {
    await expect(send({ recipientEmail: 'not-an-email' })).rejects.toThrow();
    expect(paypal.calls).toHaveLength(0);
  });

  it('keeps nothing when PayPal refuses to create the invoice, and can be retried', async () => {
    paypal.state.failCreate = true;
    await expect(send()).rejects.toBeInstanceOf(PayPalApiError);
    expect(await sponsorRow()).toMatchObject({ paypalInvoiceId: null, status: 'pledged' });
    expect(await auditActions()).toEqual(['invoice.create', 'invoice.failed']);

    // The retry first checks PayPal for an invoice the failed attempt might have made, finds none,
    // and makes the first and only invoice.
    paypal.state.failCreate = false;
    expect((await send()).paypalInvoiceId).toBe('INV2-TEST-1');
    expect(paypal.searches()).toBe(1);
    expect(paypal.creates()).toBe(2);
    expect((await sponsorRow())?.status).toBe('invoiced');
  });

  it('finishes an interrupted send instead of creating a second invoice', async () => {
    paypal.state.failNextSend = true;
    await expect(send()).rejects.toBeInstanceOf(PayPalApiError);
    // The PayPal invoice exists and is remembered, but the sponsor has not been invoiced yet.
    expect(await sponsorRow()).toMatchObject({ paypalInvoiceId: 'INV2-TEST-1', status: 'pledged' });
    expect(await auditActions()).toEqual(['invoice.create', 'invoice.failed']);

    const retried = await send();

    expect(retried).toMatchObject({ paypalInvoiceId: 'INV2-TEST-1', resumed: true });
    expect(paypal.creates()).toBe(1);
    expect(paypal.sends()).toBe(2);
    expect((await sponsorRow())?.status).toBe('invoiced');
  });

  it('does not send again when PayPal already sent the invoice but the sponsor was not updated', async () => {
    paypal.put('INV2-TEST-9', 'SENT');
    await db.update(sponsors).set({ paypalInvoiceId: 'INV2-TEST-9' }).where(eq(sponsors.id, sponsorId));

    const result = await send();

    expect(result).toMatchObject({ paypalInvoiceId: 'INV2-TEST-9', resumed: true });
    expect(paypal.creates()).toBe(0);
    expect(paypal.sends()).toBe(0);
    expect((await sponsorRow())?.status).toBe('invoiced');
  });

  it('refuses to resume an invoice PayPal has cancelled', async () => {
    paypal.put('INV2-TEST-9', 'CANCELLED');
    await db.update(sponsors).set({ paypalInvoiceId: 'INV2-TEST-9' }).where(eq(sponsors.id, sponsorId));

    await expect(send()).rejects.toMatchObject({ code: 'stale_invoice' });
    expect(paypal.sends()).toBe(0);
    expect((await sponsorRow())?.status).toBe('pledged');
  });

  it('commits the invoice.create audit row before PayPal creates the invoice, then adds the PayPal id', async () => {
    let seenAtCreate: { action: string; paypalId: string | null }[] = [];
    paypal.state.onCreate = async () => {
      seenAtCreate = await db.select({ action: auditLog.action, paypalId: auditLog.paypalId }).from(auditLog);
    };

    await send();

    expect(seenAtCreate).toEqual([{ action: 'invoice.create', paypalId: null }]);
    const [created] = await db.select().from(auditLog).where(eq(auditLog.action, 'invoice.create'));
    expect(created?.paypalId).toBe('INV2-TEST-1');
  });

  it('finds an invoice whose create answer was lost by its reference, instead of invoicing the sponsor twice', async () => {
    paypal.state.loseCreateResponse = true;
    await expect(send()).rejects.toThrow('socket hang up');
    // PayPal made the invoice, but we never learned its id.
    expect(await sponsorRow()).toMatchObject({ paypalInvoiceId: null, status: 'pledged' });

    const retried = await send();

    expect(retried).toMatchObject({ paypalInvoiceId: 'INV2-TEST-1', resumed: true });
    expect(paypal.creates()).toBe(1);
    expect(paypal.sends()).toBe(1);
    expect(await sponsorRow()).toMatchObject({ paypalInvoiceId: 'INV2-TEST-1', status: 'invoiced' });
    expect(await auditActions()).toEqual(['invoice.create', 'invoice.failed', 'invoice.recovered', 'invoice.sent']);
    const [created] = await db.select().from(auditLog).where(eq(auditLog.action, 'invoice.create'));
    expect(created?.paypalId).toBe('INV2-TEST-1');
  });

  describe('after a crash between the PayPal create and recording its id', () => {
    // What a crashed attempt leaves: its committed invoice.create row, no PayPal id, no invoice.failed.
    const crashedAttempt = async (secondsAgo: number) => {
      await db.insert(auditLog).values({
        actor: 'treasurer',
        action: 'invoice.create',
        input: { sponsorId },
        createdAt: new Date(Date.now() - secondsAgo * 1000),
      });
    };

    it('refuses while the attempt may still be running, then recovers the invoice once its lease is over', async () => {
      paypal.put('INV2-TEST-7', 'DRAFT');
      await crashedAttempt(5);

      await expect(send()).rejects.toMatchObject({ code: 'in_progress' });
      expect(paypal.calls).toHaveLength(0);

      await db.update(auditLog).set({ createdAt: new Date(Date.now() - (CREATE_LEASE_SECONDS + 60) * 1000) });
      const result = await send();

      expect(result).toMatchObject({ paypalInvoiceId: 'INV2-TEST-7', resumed: true });
      expect(paypal.creates()).toBe(0);
      expect(paypal.sends()).toBe(1);
      expect(await sponsorRow()).toMatchObject({ paypalInvoiceId: 'INV2-TEST-7', status: 'invoiced' });
    });

    it('ignores a cancelled invoice it finds and creates a new one', async () => {
      paypal.put('INV2-TEST-7', 'CANCELLED');
      await crashedAttempt(CREATE_LEASE_SECONDS + 60);

      expect((await send()).paypalInvoiceId).toBe('INV2-TEST-1');
      expect(paypal.creates()).toBe(1);
    });

    it('refuses a found invoice that is not for the pledge', async () => {
      paypal.put('INV2-TEST-7', 'DRAFT', { value: '1.00' });
      await crashedAttempt(CREATE_LEASE_SECONDS + 60);

      await expect(send()).rejects.toMatchObject({ code: 'invoice_mismatch' });
      expect(paypal.creates()).toBe(0);
      expect(paypal.sends()).toBe(0);
      expect(await sponsorRow()).toMatchObject({ paypalInvoiceId: null, status: 'pledged' });
    });

    it('refuses when PayPal already holds two open invoices for the sponsor', async () => {
      paypal.put('INV2-TEST-7', 'DRAFT');
      paypal.put('INV2-TEST-8', 'SENT');
      await crashedAttempt(CREATE_LEASE_SECONDS + 60);

      await expect(send()).rejects.toMatchObject({ code: 'duplicate_invoice' });
      expect(paypal.creates()).toBe(0);
    });
  });

  it.each([
    ['amount', { value: '1.00' }],
    ['currency', { currency: 'EUR' }],
    ['sponsor', { reference: '00000000-0000-4000-8000-000000000000' }],
  ])('refuses to resume an invoice whose %s is not the pledge', async (_name, over) => {
    paypal.put('INV2-TEST-9', 'DRAFT', over);
    await db.update(sponsors).set({ paypalInvoiceId: 'INV2-TEST-9' }).where(eq(sponsors.id, sponsorId));

    await expect(send()).rejects.toMatchObject({ code: 'invoice_mismatch' });
    expect(paypal.sends()).toBe(0);
    expect((await sponsorRow())?.status).toBe('pledged');
  });

  it('never moves a paid sponsor back to invoiced', async () => {
    await db.update(sponsors).set({ status: 'paid' }).where(eq(sponsors.id, sponsorId));
    expect(await markSponsorInvoiced(db, sponsorId)).toBe(false);
    expect((await sponsorRow())?.status).toBe('paid');

    await db.update(sponsors).set({ status: 'pledged' }).where(eq(sponsors.id, sponsorId));
    expect(await markSponsorInvoiced(db, sponsorId)).toBe(true);
    expect((await sponsorRow())?.status).toBe('invoiced');
  });

  it('leaves a sponsor whose payment landed during the send as paid', async () => {
    // The INVOICING.INVOICE.PAID handler marks the sponsor paid while PayPal is creating the invoice.
    paypal.state.onCreate = async () => {
      await db.update(sponsors).set({ status: 'paid' }).where(eq(sponsors.id, sponsorId));
    };

    await expect(send()).rejects.toMatchObject({ code: 'already_paid' });
    expect(await sponsorRow()).toMatchObject({ paypalInvoiceId: 'INV2-TEST-1', status: 'paid' });
    expect(paypal.sends()).toBe(0);
  });

  it('invoices once when two sends arrive at the same time', async () => {
    const results = await Promise.allSettled([send(), send()]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected');
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(InvoiceRefusedError);
    expect(paypal.creates()).toBe(1);
    expect(paypal.sends()).toBe(1);
  });
});

describe('invoices routes', () => {
  const TOKEN = { 'x-treasurer-token': 'secret' };
  const appWith = (env: NodeJS.ProcessEnv = { TREASURER_TOKEN: 'secret' }) => {
    const app = express();
    app.use(express.json());
    app.use('/api/sponsors', invoicesRouter({ env, db: () => db, client: () => paypal.client, now: NOW }));
    return app;
  };

  it('fails closed with 503 when no treasurer token is configured', async () => {
    const res = await request(appWith({})).get(`/api/sponsors/${sponsorId}/draft`);
    expect(res.status).toBe(503);
  });

  it('answers 401 to the wrong token and does not call PayPal', async () => {
    const res = await request(appWith())
      .post(`/api/sponsors/${sponsorId}/send`)
      .set('x-treasurer-token', 'nope')
      .send({ draft: await draft(), recipientEmail: EMAIL });
    expect(res.status).toBe(401);
    expect(paypal.calls).toHaveLength(0);
  });

  it('shows the treasurer the draft before anything is sent', async () => {
    const res = await request(appWith()).get(`/api/sponsors/${sponsorId}/draft`).set(TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.sponsor).toMatchObject({ name: 'Harbor Cloud', pledged: 350_000, status: 'pledged' });
    expect(res.body.draft.items[0].unitAmount).toBe(350_000);
    expect(paypal.calls).toHaveLength(0);
  });

  it('answers 400 to an id that is not a UUID and 404 to an unknown sponsor', async () => {
    const app = appWith();
    expect((await request(app).get('/api/sponsors/not-a-uuid/draft').set(TOKEN)).status).toBe(400);
    const missing = await request(app).get('/api/sponsors/00000000-0000-4000-8000-000000000000/draft').set(TOKEN);
    expect(missing.status).toBe(404);
  });

  it('sends the confirmed draft and returns the payer link', async () => {
    const res = await request(appWith())
      .post(`/api/sponsors/${sponsorId}/send`)
      .set(TOKEN)
      .send({ draft: await draft(), recipientEmail: EMAIL });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      paypalInvoiceId: 'INV2-TEST-1',
      invoiceNumber: '0001',
      recipientViewUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-TEST-1',
      resumed: false,
    });
    expect((await sponsorRow())?.status).toBe('invoiced');
  });

  it('answers 422 to a body without a valid draft and email, before calling PayPal', async () => {
    const res = await request(appWith())
      .post(`/api/sponsors/${sponsorId}/send`)
      .set(TOKEN)
      .send({ recipientEmail: 'nope' });
    expect(res.status).toBe(422);
    expect(paypal.calls).toHaveLength(0);
  });

  it('answers 422 to a draft whose amount is not the pledge', async () => {
    const tampered = { ...(await draft()), items: [{ name: 'x', quantity: 1, unitAmount: 1 }] };
    const res = await request(appWith())
      .post(`/api/sponsors/${sponsorId}/send`)
      .set(TOKEN)
      .send({ draft: tampered, recipientEmail: EMAIL });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('draft_mismatch');
    expect(paypal.creates()).toBe(0);
  });

  it('answers 409 when the sponsor was already invoiced', async () => {
    const body = { draft: await draft(), recipientEmail: EMAIL };
    const app = appWith();
    await request(app).post(`/api/sponsors/${sponsorId}/send`).set(TOKEN).send(body);

    const again = await request(app).post(`/api/sponsors/${sponsorId}/send`).set(TOKEN).send(body);

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('already_invoiced');
    expect(paypal.creates()).toBe(1);
  });

  it('answers 502 with the PayPal debug id when PayPal rejects the invoice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    paypal.state.failCreate = true;

    const res = await request(appWith())
      .post(`/api/sponsors/${sponsorId}/send`)
      .set(TOKEN)
      .send({ draft: await draft(), recipientEmail: EMAIL });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'PayPal rejected the invoice request', debugId: 'dbg-1' });
  });
});
