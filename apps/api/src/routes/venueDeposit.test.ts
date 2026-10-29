import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';
import {
  VenueDepositPayResponse,
  VenueDepositResponse,
  venuePickText,
} from '@quartermaster/shared';
import type { Db } from '../db/client.js';
import { getOrCreateThread, saveMessages } from '../db/mandates.js';
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
import { venueDepositRouter } from './venueDeposit.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const env = { TREASURER_TOKEN: 'letmein' };
const treasurer = { 'x-treasurer-token': 'letmein' };

const catalog = loadVenueCatalog();
// Within the $200 auto-pay rule, and over it.
const small = catalog.find((l) => l.deposit.amountMinor <= 20_000)!;
const big = catalog.find((l) => l.deposit.amountMinor > 20_000)!;

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
beforeEach(async () => {
  db = await createTestDb();
});

async function seedThread(messages: UIMessage[]) {
  const id = crypto.randomUUID();
  await getOrCreateThread(db, id, null);
  await saveMessages(db, id, messages);
  return id;
}

async function build({ wallet: connected = true } = {}) {
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
  const executor = createExecutor({
    client,
    check: stubCheck,
    audit: createMemoryAudit(),
    wallet,
    approvals,
    references: createMemoryReferences(),
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/venue-deposit',
    venueDepositRouter({
      env,
      db: () => db,
      payments: () => ({ client, wallet, executor, approvals }),
    }),
  );
  return { app, calls, approvals };
}

describe('venue deposit route', () => {
  it('shows the deposit of the picked catalog venue, with the amount from the catalog', async () => {
    const { app } = await build();
    const id = await seedThread(
      thread([small, big], { name: big.name, sourceUrl: listingUrl(big) }),
    );
    const res = await request(app).get(`/api/venue-deposit/${id}`).expect(200);
    expect(VenueDepositResponse.parse(res.body).deposit).toEqual({
      venue: big.name,
      area: `${big.area}, ${big.city}`,
      amountMinor: big.deposit.amountMinor,
      currency: 'USD',
    });
  });

  it('has no deposit before a pick, or for a venue the scout never returned', async () => {
    const { app } = await build();
    const none = await seedThread(thread([small]));
    expect((await request(app).get(`/api/venue-deposit/${none}`).expect(200)).body).toEqual({
      deposit: null,
    });
    const madeUp = await seedThread(
      thread([small], { name: big.name, sourceUrl: listingUrl(big) }),
    );
    expect((await request(app).get(`/api/venue-deposit/${madeUp}`).expect(200)).body).toEqual({
      deposit: null,
    });
  });

  it('only lets the treasurer pay', async () => {
    const { app, calls } = await build();
    const id = await seedThread(
      thread([small], { name: small.name, sourceUrl: listingUrl(small) }),
    );
    await request(app).post(`/api/venue-deposit/${id}`).expect(401);
    expect(calls).toEqual([]);
  });

  it('pays a deposit within the rules from the agent wallet, once per venue', async () => {
    const { app, calls } = await build();
    const id = await seedThread(
      thread([small], { name: small.name, sourceUrl: listingUrl(small) }),
    );
    const res = await request(app).post(`/api/venue-deposit/${id}`).set(treasurer).expect(200);
    expect(VenueDepositPayResponse.parse(res.body).outcome).toEqual({
      status: 'paid',
      orderId: 'ORD-VAULT',
      captureId: 'CAP-1',
    });
    expect(calls[0]?.body).toMatchObject({
      purchase_units: [
        { amount: { currency_code: 'USD', value: (small.deposit.amountMinor / 100).toFixed(2) } },
      ],
      payment_source: { paypal: { vault_id: 'pt_1' } },
    });
    // A second click replays the same spend: PayPal gets the same idempotency key, so it cannot charge twice.
    await request(app).post(`/api/venue-deposit/${id}`).set(treasurer).expect(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.requestId).toBe(calls[0]?.requestId);
  });

  it('sends a deposit over the rules to the treasurer as a PayPal order to approve', async () => {
    const { app, calls, approvals } = await build();
    const id = await seedThread(thread([big], { name: big.name, sourceUrl: listingUrl(big) }));
    const res = await request(app).post(`/api/venue-deposit/${id}`).set(treasurer).expect(200);
    const { outcome } = VenueDepositPayResponse.parse(res.body);
    expect(outcome).toMatchObject({
      status: 'needs_approval',
      paypalOrderId: 'ORD-APPROVE',
      reasons: ['over the $200 approval threshold'],
    });
    expect(calls[0]?.body).not.toHaveProperty('payment_source.paypal.vault_id');
    const [approval] = await approvals.list();
    expect(approval?.spend).toMatchObject({
      amountMinor: big.deposit.amountMinor,
      currency: 'USD',
      category: 'venue',
      vendor: big.name,
    });
  });

  it('refuses to pay with no agent wallet connected, and without a pick', async () => {
    const { app, calls } = await build({ wallet: false });
    const id = await seedThread(
      thread([small], { name: small.name, sourceUrl: listingUrl(small) }),
    );
    const res = await request(app).post(`/api/venue-deposit/${id}`).set(treasurer).expect(409);
    expect(VenueDepositPayResponse.parse(res.body).outcome).toEqual({
      status: 'refused',
      reason: 'no_wallet',
    });
    const unpicked = await seedThread(thread([small]));
    await request(app).post(`/api/venue-deposit/${unpicked}`).set(treasurer).expect(409);
    expect(calls).toEqual([]);
  });
});
