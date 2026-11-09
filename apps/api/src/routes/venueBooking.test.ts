import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';
import {
  VenueBookingHistoryResponse,
  VenueBookingPayResponse,
  VenueBookingResponse,
  venueEstimate,
  venuePickText,
} from '@leonid/shared';
import type { Db } from '../db/client.js';
import { getOrCreateThread, saveMessages } from '../db/mandates.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { createExecutor } from '../payments/executor.js';
import {
  createMemoryApprovals,
  createMemoryAudit,
  createMemoryReferences,
  createMemoryWalletStore,
} from '../payments/memory.js';
import { stubCheck } from '../payments/stub-check.js';
import { createPayPalClient } from '../paypal/client.js';
import { listingUrl, loadVenueCatalog, type VenueListing } from '../search/venueCatalog.js';
import { toUsdCents } from '../pricing/fx.js';
import { approvals, auditLog, events } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { venueBookingRouter } from './venueBooking.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const env = { TREASURER_TOKEN: 'letmein' };
const treasurer = { 'x-treasurer-token': 'letmein' };

const catalog = loadVenueCatalog();
// The seeded demo event has 200 people. A booking is the venue's whole one-day estimate in USD, which is over the $200
// auto-pay rule for every catalog venue, so it normally goes to the treasurer to approve.
const HEADCOUNT = 200;
const big = catalog.find((l) => l.price.currency !== 'IDR')!;
const idr = catalog.find((l) => l.price.currency === 'IDR')!;

const candidateOf = (l: VenueListing) => ({
  name: l.name,
  sourceUrls: [listingUrl(l)],
  capacity: null,
  price: null,
  cateringIncluded: 'unknown',
  booking: l.booking,
});

// A thread where the scout returned `listings` and the organizer picked `picked`.
function thread(
  listings: VenueListing[],
  picked?: { name: string; sourceUrl: string },
): UIMessage[] {
  const messages: UIMessage[] = [
    { id: 'u0', role: 'user', parts: [{ type: 'text', text: 'Find a venue' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-delegate_to_venue_scout',
          toolCallId: 's1',
          state: 'output-available',
          input: { city: 'Jakarta', headcount: 100 },
          output: { activity: [], candidates: listings.map(candidateOf), summary: '' },
        },
      ],
    },
  ];
  if (picked)
    messages.push({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: venuePickText(picked) }],
    });
  return messages;
}

interface OrderBody {
  purchase_units: { amount: unknown }[];
  payment_source?: { paypal?: { vault_id?: string } };
}

let db: Db;
let demoEventId: string;
beforeEach(async () => {
  db = await createTestDb();
  demoEventId = (await seedDemoEvent(db)).id;
});

// A deposit is a spend and every spend needs an event: the thread gets the seeded one unless a test passes another or null (none).
async function seedThread(messages: UIMessage[], eventId: string | null = demoEventId) {
  const id = crypto.randomUUID();
  await getOrCreateThread(db, id, eventId, null);
  await saveMessages(db, id, messages);
  return id;
}

async function build({
  wallet: connected = true,
  check = stubCheck,
}: { wallet?: boolean; check?: typeof stubCheck } = {}) {
  const calls: { key: string; requestId: string | null; body: unknown }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/oauth2/token')
      return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
    const body = init?.body ? (JSON.parse(String(init.body)) as OrderBody) : null;
    const requestId = new Headers(init?.headers).get('PayPal-Request-Id');
    calls.push({ key: `${init?.method} ${path}`, requestId, body });
    if (`${init?.method} ${path}` !== 'POST /v2/checkout/orders')
      throw new Error(`unexpected PayPal call: ${path}`);
    const amount = body?.purchase_units[0]?.amount;
    if (body?.payment_source?.paypal?.vault_id) {
      // A charge of the saved wallet captures at once.
      return json(201, {
        id: 'ORD-VAULT',
        status: 'COMPLETED',
        purchase_units: [
          { payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount }] } },
        ],
      });
    }
    return json(201, {
      id: 'ORD-APPROVE',
      status: 'PAYER_ACTION_REQUIRED',
      links: [
        {
          rel: 'payer-action',
          href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD-APPROVE',
        },
      ],
    });
  });
  const client = createPayPalClient({
    app: 'procurement',
    clientId: 'i',
    clientSecret: 's',
    fetch,
  });
  const wallet = createMemoryWalletStore();
  if (connected) await wallet.activate({ paymentTokenId: 'pt_1' });
  const approvals = createMemoryApprovals();
  const audit = createMemoryAudit();
  const executor = createExecutor({
    client,
    check,
    audit,
    wallet,
    approvals,
    references: createMemoryReferences(),
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/venue-booking',
    venueBookingRouter({
      env,
      db: () => db,
      payments: () => ({ client, wallet, executor, approvals }),
    }),
  );
  return { app, calls, approvals, audit };
}

const allow: typeof stubCheck = () => ({ decision: 'allow', reasons: ['test'], ruleIds: [] });
const pick = (l: VenueListing) => ({ name: l.name, sourceUrl: listingUrl(l) });

describe('venue booking route', () => {
  const referenceOf = (threadId: string, l: VenueListing) => `venue-booking-${threadId}-${l.id}`;

  it('says a booking is unpaid, waiting for the treasurer, or paid, from our own records', async () => {
    const { app } = await build();
    const id = await seedThread(thread([idr], pick(idr)));
    const paymentOf = async () =>
      VenueBookingResponse.parse(
        (await request(app).get(`/api/venue-booking/${id}`).set(treasurer).expect(200)).body,
      ).payment;
    expect(await paymentOf()).toEqual({ status: 'unpaid' });

    const [approval] = await db
      .insert(approvals)
      .values({
        spend: { referenceId: referenceOf(id, idr) },
        eventId: demoEventId,
        status: 'pending',
        paypalOrderId: 'ORD-APPROVE',
      })
      .returning();
    expect(await paymentOf()).toEqual({
      status: 'awaiting_approval',
      approvalId: approval!.id,
      paypalOrderId: 'ORD-APPROVE',
    });

    await db.update(approvals).set({ status: 'paid' }).where(eq(approvals.id, approval!.id));
    expect(await paymentOf()).toEqual({ status: 'paid', reference: 'ORD-APPROVE' });
  });

  it('says a booking charged to the agent wallet is paid', async () => {
    const { app } = await build();
    const id = await seedThread(thread([idr], pick(idr)));
    await db.insert(auditLog).values({
      actor: 'treasurer',
      action: 'spend.check',
      input: { referenceId: referenceOf(id, idr) },
      outcome: 'paid',
      paypalId: 'CAP-9',
    });
    const res = await request(app).get(`/api/venue-booking/${id}`).set(treasurer).expect(200);
    expect(VenueBookingResponse.parse(res.body).payment).toEqual({
      status: 'paid',
      reference: 'CAP-9',
    });
  });

  it("summarises the picked venue: the event, the one-day estimate and its USD total from the demo rate", async () => {
    const { app } = await build();
    const id = await seedThread(thread([idr, big], pick(idr)));
    const res = await request(app).get(`/api/venue-booking/${id}`).set(treasurer).expect(200);
    const { summary } = VenueBookingResponse.parse(res.body);
    const estimate = venueEstimate(idr, HEADCOUNT)!;
    expect(summary).toMatchObject({
      event: { headcount: HEADCOUNT, maxSpend: null },
      venue: { name: idr.name, area: `${idr.area}, ${idr.city}`, sourceUrl: listingUrl(idr) },
      estimate: { ...estimate, currency: 'IDR' },
      fx: { from: 'IDR', localMinorPerUsd: 16_000 },
      payable: { amountMinor: toUsdCents(estimate.total, 'IDR'), currency: 'USD' },
      overMaxSpend: false,
    });
  });

  it('warns when the total is over the event max spend', async () => {
    const { app } = await build();
    await db.update(events).set({ maxSpendMinor: 1_000 }).where(eq(events.id, demoEventId));
    const id = await seedThread(thread([idr], pick(idr)));
    const res = await request(app).get(`/api/venue-booking/${id}`).set(treasurer).expect(200);
    expect(VenueBookingResponse.parse(res.body).summary).toMatchObject({
      event: { maxSpend: { amountMinor: 1_000, currency: 'USD' } },
      overMaxSpend: true,
    });
  });

  it('has no summary before a pick, for a venue the scout never returned, or for a chat with no event', async () => {
    const { app } = await build();
    const none = await seedThread(thread([idr]));
    const madeUp = await seedThread(thread([idr], pick(big)));
    const noEvent = await seedThread(thread([idr], pick(idr)), null);
    for (const id of [none, madeUp, noEvent]) {
      const res = await request(app).get(`/api/venue-booking/${id}`).set(treasurer).expect(200);
      expect(res.body).toEqual({ summary: null, payment: { status: 'unpaid' } });
    }
  });

  it('lists every picked plan with its payment status, and skips chats with no plan or no event', async () => {
    const { app } = await build();
    const unpaid = await seedThread(thread([idr], pick(idr)));
    const paid = await seedThread(thread([big], pick(big)));
    await seedThread(thread([idr]));
    await seedThread(thread([idr], pick(idr)), null);
    await db.insert(auditLog).values({
      actor: 'treasurer',
      action: 'spend.check',
      input: { referenceId: referenceOf(paid, big) },
      outcome: 'paid',
      paypalId: 'CAP-7',
    });
    const res = await request(app).get('/api/venue-booking').set(treasurer).expect(200);
    const { plans } = VenueBookingHistoryResponse.parse(res.body);
    expect(plans.map((p) => [p.threadId, p.payment.status].join(' ')).sort()).toEqual(
      [`${unpaid} unpaid`, `${paid} paid`].sort(),
    );
    expect(plans.find((p) => p.threadId === paid)).toMatchObject({
      eventId: demoEventId,
      payment: { status: 'paid', reference: 'CAP-7' },
    });
  });

  it('keeps the plan history for the treasurer only', async () => {
    const { app } = await build();
    await request(app).get('/api/venue-booking').expect(401);
  });

  it('only lets the treasurer see or pay', async () => {
    const { app, calls } = await build();
    const id = await seedThread(thread([idr], pick(idr)));
    await request(app).get(`/api/venue-booking/${id}`).expect(401);
    await request(app).post(`/api/venue-booking/${id}`).expect(401);
    expect(calls).toEqual([]);
  });

  it('sends the USD total, over the rules, to the treasurer as a PayPal order to approve', async () => {
    const { app, calls, approvals, audit } = await build();
    const id = await seedThread(thread([idr], pick(idr)));
    const res = await request(app).post(`/api/venue-booking/${id}`).set(treasurer).expect(200);
    const { outcome, summary } = VenueBookingPayResponse.parse(res.body);
    expect(outcome).toMatchObject({
      status: 'needs_approval',
      paypalOrderId: 'ORD-APPROVE',
      reasons: ['over the $200 approval threshold'],
    });
    expect(calls[0]?.body).not.toHaveProperty('payment_source.paypal.vault_id');
    const [approval] = await approvals.list();
    expect(approval?.spend).toMatchObject({
      amountMinor: summary.payable.amountMinor,
      currency: 'USD',
      category: 'venue',
      vendor: idr.name,
    });
    expect(audit.rows[0]?.input).toMatchObject({ eventId: demoEventId });
  });

  it('charges the agent wallet when the rules allow it, once per venue', async () => {
    const { app, calls } = await build({ check: allow });
    const id = await seedThread(thread([idr], pick(idr)));
    const res = await request(app).post(`/api/venue-booking/${id}`).set(treasurer).expect(200);
    const { outcome, summary } = VenueBookingPayResponse.parse(res.body);
    expect(outcome).toEqual({ status: 'paid', orderId: 'ORD-VAULT', captureId: 'CAP-1' });
    expect(calls[0]?.body).toMatchObject({
      purchase_units: [
        { amount: { currency_code: 'USD', value: (summary.payable.amountMinor / 100).toFixed(2) } },
      ],
      payment_source: { paypal: { vault_id: 'pt_1' } },
    });
    // A second click replays the same spend: PayPal gets the same idempotency key, so it cannot charge twice.
    await request(app).post(`/api/venue-booking/${id}`).set(treasurer).expect(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.requestId).toBe(calls[0]?.requestId);
  });

  it('refuses to pay for a chat with no event or no pick, without calling PayPal', async () => {
    const { app, calls } = await build();
    const noEvent = await seedThread(thread([idr], pick(idr)), null);
    const unpicked = await seedThread(thread([idr]));
    await request(app).post(`/api/venue-booking/${noEvent}`).set(treasurer).expect(409);
    await request(app).post(`/api/venue-booking/${unpicked}`).set(treasurer).expect(409);
    expect(calls).toEqual([]);
  });

  it('refuses to pay with no agent wallet connected', async () => {
    const { app, calls } = await build({ wallet: false, check: allow });
    const id = await seedThread(thread([idr], pick(idr)));
    const res = await request(app).post(`/api/venue-booking/${id}`).set(treasurer).expect(409);
    expect(VenueBookingPayResponse.parse(res.body).outcome).toEqual({
      status: 'refused',
      reason: 'no_wallet',
    });
    expect(calls).toEqual([]);
  });
});
