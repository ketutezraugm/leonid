import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { LedgerSource } from '@quartermaster/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../db/client.js';
import { clearedIncome, listLedger, recordLedgerEntry } from '../../db/ledger.js';
import { auditLog, LEDGER_SOURCES, sponsors } from '../../db/schema.js';
import { seedDemoEvent } from '../../db/seed.js';
import { createTestDb } from '../../db/testing.js';
import {
  createHandlerRegistry,
  createMemoryEventStore,
  type WebhookApp,
  type WebhookEvent,
} from '../registry.js';
import { webhookRouter } from '../router.js';
import { buildCaptureTag, createCaptureCompletedHandler } from './capture-completed.js';
import { createInvoicePaidHandler } from './invoice-paid.js';

interface Money {
  currency_code: string;
  value: string;
}
interface FixtureInvoice {
  id: string;
  status: string;
  due_amount?: Money;
  payments?: { paid_amount?: Money; transactions: { transaction_status: string }[] };
}
interface FixtureEvent {
  id: string;
  event_type: string;
  resource: { invoice: FixtureInvoice };
}

// A real INVOICING.INVOICE.PAID event from the sandbox (emails redacted). $1.00, fully paid.
const fixtureJson = readFileSync(new URL('./fixtures/invoice-paid.json', import.meta.url), 'utf8');
const INVOICE_ID = 'INV2-KUAD-G3SZ-RL4H-P6QK';

function invoiceEvent(change?: (invoice: FixtureInvoice) => void, id = 'WH-INV-1'): WebhookEvent {
  const event = JSON.parse(fixtureJson) as FixtureEvent;
  change?.(event.resource.invoice);
  return { ...event, id } as WebhookEvent;
}

let db: Db;
let eventId: string;
let sponsorId: string;
const invoicePaid = createInvoicePaidHandler(() => db);
const captureCompleted = createCaptureCompletedHandler(() => db);

// One in-memory Postgres for the whole file: every createTestDb runs all migrations, which is slow
// enough to starve other test files when it happens once per test. Tables are emptied between tests.
beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.execute(sql`truncate table audit_log, events restart identity cascade`);
  const event = await seedDemoEvent(db);
  eventId = event.id;
  const [sponsor] = await db.select().from(sponsors).where(eq(sponsors.eventId, eventId)).limit(1);
  if (!sponsor) throw new Error('seed has no sponsor');
  sponsorId = sponsor.id;
  await db
    .update(sponsors)
    .set({ paypalInvoiceId: INVOICE_ID, status: 'invoiced' })
    .where(eq(sponsors.id, sponsorId));
});

const auditActions = async () => (await db.select().from(auditLog)).map((r) => r.action);
const sponsorStatus = async () =>
  (await db.select().from(sponsors).where(eq(sponsors.id, sponsorId)))[0]?.status;
const run = (handler: typeof invoicePaid, event: WebhookEvent, app: WebhookApp = 'treasury') =>
  handler(event, { app });

describe('INVOICING.INVOICE.PAID', () => {
  it('records a fully paid invoice as cleared income and marks the sponsor paid', async () => {
    await run(invoicePaid, invoiceEvent());

    const ledger = await listLedger(db, eventId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      eventId,
      sponsorId,
      direction: 'in',
      amount: 100,
      currency: 'USD',
      source: 'sponsor_invoice',
      paypalId: INVOICE_ID,
    });
    expect(await sponsorStatus()).toBe('paid');
    expect(await clearedIncome(db, eventId, 'USD')).toBe(100);
    expect(await auditActions()).toEqual(['ledger.income_recorded']);
  });

  it('counts the money once when PayPal replays the event, even under a new event id', async () => {
    await run(invoicePaid, invoiceEvent());
    await run(invoicePaid, invoiceEvent(undefined, 'WH-INV-1'));
    await run(invoicePaid, invoiceEvent(undefined, 'WH-INV-2'));

    expect(await listLedger(db, eventId)).toHaveLength(1);
    expect(await clearedIncome(db, eventId, 'USD')).toBe(100);
    expect(await auditActions()).toEqual(['ledger.income_recorded']);
  });

  it.each([
    [
      'partially paid',
      (i: FixtureInvoice) => {
        i.status = 'PARTIALLY_PAID';
        i.due_amount = { currency_code: 'USD', value: '0.50' };
        i.payments = { paid_amount: { currency_code: 'USD', value: '0.50' }, transactions: [{ transaction_status: 'SUCCESS' }] };
      },
    ],
    ['payment pending', (i: FixtureInvoice) => (i.status = 'PAYMENT_PENDING')],
    ['marked as paid by the invoicer', (i: FixtureInvoice) => (i.status = 'MARKED_AS_PAID')],
    [
      'PAID but money still due',
      (i: FixtureInvoice) => (i.due_amount = { currency_code: 'USD', value: '0.01' }),
    ],
    [
      'PAID but the PayPal transaction is not settled',
      (i: FixtureInvoice) => {
        if (i.payments) i.payments.transactions = [{ transaction_status: 'PENDING' }];
      },
    ],
  ])('does not count an invoice that is %s', async (_name, change) => {
    await run(invoicePaid, invoiceEvent(change));

    expect(await listLedger(db, eventId)).toHaveLength(0);
    expect(await sponsorStatus()).toBe('invoiced');
  });

  it('ignores the Procurement webhook, which never carries sponsor money', async () => {
    await run(invoicePaid, invoiceEvent(), 'procurement');
    expect(await listLedger(db, eventId)).toHaveLength(0);
  });

  it('leaves an audit trace, and no income, for an invoice that is not a sponsor invoice', async () => {
    await db.update(sponsors).set({ paypalInvoiceId: null }).where(eq(sponsors.id, sponsorId));
    await run(invoicePaid, invoiceEvent());

    expect(await listLedger(db, eventId)).toHaveLength(0);
    expect(await auditActions()).toEqual(['ledger.invoice_unmatched']);
  });

  it('audits and skips a PAID invoice with no paid amount instead of crediting a guess', async () => {
    await run(
      invoicePaid,
      invoiceEvent((i) => {
        if (i.payments) delete i.payments.paid_amount;
      }),
    );

    expect(await listLedger(db, eventId)).toHaveLength(0);
    expect(await auditActions()).toEqual(['ledger.invoice_ignored']);
  });

  it('audits and skips a resource that is not an invoice', async () => {
    await run(invoicePaid, { id: 'WH-X', event_type: 'INVOICING.INVOICE.PAID', resource: { nope: 1 } });

    expect(await listLedger(db, eventId)).toHaveLength(0);
    expect(await auditActions()).toEqual(['ledger.invoice_ignored']);
  });
});

describe('PAYMENT.CAPTURE.COMPLETED', () => {
  const capture = (resource: Record<string, unknown> = {}, id = 'WH-CAP-1'): WebhookEvent => ({
    id,
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAP-1',
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '140.00' },
      custom_id: buildCaptureTag(eventId, 'donation'),
      ...resource,
    },
  });

  it('records a tagged Treasury capture as income for that event', async () => {
    await run(captureCompleted, capture());

    const ledger = await listLedger(db, eventId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      eventId,
      sponsorId: null,
      direction: 'in',
      amount: 14_000,
      currency: 'USD',
      source: 'donation',
      paypalId: 'CAP-1',
    });
    expect(await clearedIncome(db, eventId, 'USD')).toBe(14_000);
  });

  it('attaches the sponsor when the tag names one of the event sponsors', async () => {
    await run(captureCompleted, capture({ custom_id: buildCaptureTag(eventId, 'ticket', sponsorId) }));
    expect((await listLedger(db, eventId))[0]).toMatchObject({ source: 'ticket', sponsorId });
  });

  it('counts a replayed capture once', async () => {
    await run(captureCompleted, capture());
    await run(captureCompleted, capture({}, 'WH-CAP-2'));
    expect(await listLedger(db, eventId)).toHaveLength(1);
  });

  it.each([
    ['has no custom_id', { custom_id: undefined }],
    ['has a custom_id that is not ours', { custom_id: 'order-42' }],
    ['names an event that does not exist', { custom_id: buildCaptureTag('00000000-0000-4000-8000-000000000000', 'donation') }],
    [
      'names a sponsor outside the event',
      { custom_id: buildCaptureTag('00000000-0000-4000-8000-000000000000', 'ticket', '00000000-0000-4000-8000-000000000001') },
    ],
  ])('audits and does not guess income for a capture that %s', async (_name, resource) => {
    await run(captureCompleted, capture(resource));

    expect(await listLedger(db, eventId)).toHaveLength(0);
    expect(await auditActions()).toEqual(['ledger.capture_unmatched']);
  });

  it('does not count a capture that is not COMPLETED', async () => {
    await run(captureCompleted, capture({ status: 'PENDING' }));
    expect(await listLedger(db, eventId)).toHaveLength(0);
  });

  it('ignores the Procurement webhook, whose captures are spend', async () => {
    await run(captureCompleted, capture(), 'procurement');
    expect(await listLedger(db, eventId)).toHaveLength(0);
  });

  it('audits and skips an amount it cannot read', async () => {
    await run(captureCompleted, capture({ amount: { currency_code: 'USD', value: 'abc' } }));
    expect(await listLedger(db, eventId)).toHaveLength(0);
    expect(await auditActions()).toEqual(['ledger.capture_ignored']);
  });
});

describe('ledger', () => {
  it('counts only income sources in one currency toward cleared income', async () => {
    const base = { eventId, direction: 'in' as const, currency: 'USD' };
    await recordLedgerEntry(db, { ...base, amount: 1_000, source: 'sponsor_invoice', paypalId: 'INV-A' });
    await recordLedgerEntry(db, { ...base, amount: 500, source: 'ticket', paypalId: 'CAP-A' });
    await recordLedgerEntry(db, { ...base, amount: 300, source: 'refund', paypalId: 'REF-A' });
    await recordLedgerEntry(db, { ...base, amount: 200, source: 'claim_payout', paypalId: 'PAY-A', direction: 'out' });
    await recordLedgerEntry(db, { ...base, amount: 9_999, currency: 'EUR', source: 'donation', paypalId: 'CAP-EUR' });

    expect(await clearedIncome(db, eventId, 'USD')).toBe(1_500);
    expect(await clearedIncome(db, eventId, 'EUR')).toBe(9_999);
    expect(await clearedIncome(db, eventId, 'GBP')).toBe(0);
  });

  it.each([[0], [-5], [1.5]])('refuses an amount of %s', async (amount) => {
    await expect(
      recordLedgerEntry(db, { eventId, direction: 'in', amount, currency: 'USD', source: 'donation', paypalId: 'X' }),
    ).rejects.toThrow(RangeError);
  });

  it('uses the same sources as the shared LedgerSource contract', () => {
    expect([...LEDGER_SOURCES]).toEqual(LedgerSource.options);
  });
});

describe('through the webhook router', () => {
  it('credits the ledger from a real event posted to the receiver, once, even if posted twice', async () => {
    const registry = createHandlerRegistry();
    registry.register('INVOICING.INVOICE.PAID', invoicePaid);
    const app = express();
    app.use(
      '/hook',
      webhookRouter({
        env: { PAYPAL_TREASURY_WEBHOOK_ID: 'WH-TREASURY' },
        store: createMemoryEventStore(),
        registry,
        verify: async () => true,
      }),
    );
    const headers = {
      'content-type': 'application/json',
      'paypal-transmission-id': 'T-1',
      'paypal-transmission-time': '2026-10-29T06:05:57Z',
      'paypal-transmission-sig': 'sig',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
      'paypal-auth-algo': 'SHA256withRSA',
    };

    const first = await request(app).post('/hook/treasury').set(headers).send(fixtureJson);
    const second = await request(app).post('/hook/treasury').set(headers).send(fixtureJson);

    expect(first.status).toBe(200);
    expect(second.body).toEqual({ status: 'duplicate' });
    expect(await clearedIncome(db, eventId, 'USD')).toBe(100);
  });
});
