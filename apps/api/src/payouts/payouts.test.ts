import { PayoutsLedgerResponse, PayoutsResponse } from '@quartermaster/shared';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVolunteer } from '../claims/service.js';
import type { Db } from '../db/client.js';
import { recordLedgerEntry } from '../db/ledger.js';
import { auditLog, claims, sponsors } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { createDbApprovals, createDbAudit, createDbReferences, createDbWalletStore } from '../payments/db.js';
import { createExecutor, type Executor } from '../payments/executor.js';
import type { PayoutSender } from '../payments/ports.js';
import { createRulesCheck } from '../payments/rulesCheck.js';
import { createPayPalClient } from '../paypal/client.js';
import { payoutsRouter } from '../routes/payouts.js';
import { widgetsRouter } from '../routes/widgets.js';
import type { WebhookEvent } from '../webhooks/registry.js';
import { createPayoutItemHandler } from '../webhooks/handlers/payout-item.js';

const TREASURER = { 'x-treasurer-token': 'secret' };

let db: Db;
let eventId: string;
let sent: Parameters<PayoutSender['send']>[0][];
let executor: Executor;

beforeEach(async () => {
  db = await createTestDb();
  eventId = (await seedDemoEvent(db)).id;
  await recordLedgerEntry(db, { eventId, direction: 'in', amount: 300_000, currency: 'USD', source: 'sponsor_invoice', paypalId: 'PAY-1' });
  await createDbWalletStore(db).activate({ paymentTokenId: 'pt_1' });
  sent = [];
  executor = createExecutor({
    client: createPayPalClient({ app: 'procurement', clientId: 'i', clientSecret: 's', fetch: vi.fn<typeof fetch>() }),
    check: createRulesCheck(db),
    audit: createDbAudit(db),
    wallet: createDbWalletStore(db),
    approvals: createDbApprovals(db),
    references: createDbReferences(db),
    payouts: {
      send: async (input) => {
        sent.push(input);
        return { batchId: `BATCH-${sent.length}` };
      },
    },
  });
});

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/payouts', payoutsRouter({ env: { TREASURER_TOKEN: 'secret' }, db: () => db, payments: () => executor }));
  a.use('/api/widgets', widgetsRouter({ env: { TREASURER_TOKEN: 'secret' }, db: () => db }));
  return a;
};

const prize = (over: Record<string, unknown> = {}) => ({
  kind: 'prize',
  recipientName: 'Ravi',
  recipientEmail: 'ravi@winner.test',
  countryCode: 'IN',
  amount: 15_000,
  ...over,
});

const pay = async (body: Record<string, unknown>) => {
  const res = await request(app()).post('/api/payouts').set(TREASURER).send(body);
  expect(res.status).toBe(201);
  return PayoutsResponse.parse(res.body).payouts[0]!;
};

const listed = async () => PayoutsResponse.parse((await request(app()).get('/api/payouts').set(TREASURER)).body).payouts;

// A PayPal payout item event, as the Treasury webhook delivers it.
const itemEvent = (senderItemId: string, transactionStatus: string, id = 'WH-1'): WebhookEvent => ({
  id,
  event_type: `PAYMENT.PAYOUTS-ITEM.${transactionStatus === 'SUCCESS' ? 'SUCCEEDED' : transactionStatus}`,
  resource: {
    payout_item_id: 'ITEM-1',
    transaction_status: transactionStatus,
    payout_batch_id: 'BATCH-1',
    payout_item: { sender_item_id: senderItemId },
  },
});
const deliver = (event: WebhookEvent, appName: 'treasury' | 'procurement' = 'treasury') =>
  createPayoutItemHandler(() => db)(event, { app: appName });

const newClaim = async (amount: number) => {
  const { volunteer } = await createVolunteer(db, { eventId, name: 'Ana', payoutEmail: `ana${amount}@volunteer.test` });
  const [row] = await db
    .insert(claims)
    .values({
      eventId,
      volunteerId: volunteer.id,
      category: 'volunteer',
      receiptMime: 'image/png',
      receiptImage: Buffer.from([1]),
      currency: 'USD',
      amount,
      status: 'approved',
    })
    .returning();
  return row!;
};

describe('prize and speaker payouts (F17)', () => {
  it('sends a prize under the payout threshold through the rules engine to its winner', async () => {
    const item = await pay(prize());

    expect(item).toMatchObject({ status: 'processing', payoutId: 'BATCH-1', kind: 'prize', senderItemId: `payout:${item.id}` });
    expect(item.destination).toEqual({ recipientType: 'EMAIL', receiver: 'r***@winner.test', countryCode: 'IN' });
    expect(sent).toEqual([
      expect.objectContaining({ recipientEmail: 'ravi@winner.test', amountMinor: 15_000, referenceId: `payout:${item.id}` }),
    ]);
  });

  it('holds a prize over the threshold for the treasurer, and sends it once approved', async () => {
    const item = await pay(prize({ amount: 50_000 }));
    expect(item.status).toBe('pending_approval');
    expect(sent).toHaveLength(0);

    const approval = await createDbApprovals(db).findByReference(`payout:${item.id}`);
    await executor.captureApproved(approval!.id, 'treasurer');

    expect(sent).toHaveLength(1);
    expect((await listed())[0]).toMatchObject({ id: item.id, status: 'processing' });
  });

  it("blocks a prize funded by a sponsor whose invoice is not paid (the Gantt gate)", async () => {
    const [sponsor] = await db.select().from(sponsors).where(eq(sponsors.eventId, eventId));

    const item = await pay(prize({ sponsorId: sponsor!.id }));

    expect(item.status).toBe('blocked');
    expect(item.note).toMatch(/sponsor's invoice/);
    expect(sent).toHaveLength(0);
  });

  it('is treasurer-only and checks its body', async () => {
    expect((await request(app()).post('/api/payouts').send(prize())).status).toBe(401);
    expect((await request(app()).post('/api/payouts').set(TREASURER).send(prize({ amount: -1 }))).status).toBe(422);
    expect((await request(app()).post('/api/payouts').set(TREASURER).send(prize({ recipientEmail: 'nope' }))).status).toBe(422);
  });
});

describe('payout item webhooks: what PayPal says is the truth', () => {
  it('marks a prize paid, and a late pending never turns it back', async () => {
    const item = await pay(prize());

    await deliver(itemEvent(`payout:${item.id}`, 'SUCCESS'));
    await deliver(itemEvent(`payout:${item.id}`, 'PENDING', 'WH-2'));

    expect((await listed())[0]).toMatchObject({ status: 'paid', paypalItemId: 'ITEM-1' });
    const audits = (await db.select().from(auditLog)).filter((r) => r.action === 'payout.status');
    expect(audits).toHaveLength(1);
  });

  it('marks a claim paid, and tells the volunteer when PayPal sends it back', async () => {
    const paid = await newClaim(3_000);
    const returned = await newClaim(1_000);

    await deliver(itemEvent(`claim:${paid.id}`, 'SUCCESS'));
    await deliver(itemEvent(`claim:${returned.id}`, 'RETURNED', 'WH-3'));
    const rows = await db.select().from(claims);

    expect(rows.find((r) => r.id === paid.id)).toMatchObject({ status: 'paid', payoutStatus: 'paid' });
    expect(rows.find((r) => r.id === returned.id)).toMatchObject({ status: 'rejected', payoutStatus: 'returned' });
  });

  it('never guesses: an unknown status, an unknown item or a broken event is audited and changes nothing', async () => {
    const item = await pay(prize());

    await deliver(itemEvent(`payout:${item.id}`, 'SOMETHING_NEW'));
    await deliver(itemEvent('payout:00000000-0000-4000-8000-000000000000', 'SUCCESS', 'WH-4'));
    await deliver({ id: 'WH-5', event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: { nope: true } });
    await deliver(itemEvent(`payout:${item.id}`, 'SUCCESS', 'WH-6'), 'procurement');

    expect((await listed())[0]!.status).toBe('processing');
    const actions = (await db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['payout.status_unknown', 'payout.status_unmatched', 'payout.status_ignored']));
  });
});

describe('payouts ledger widget, live', () => {
  it('lists prizes and claims together, and filters by category', async () => {
    const item = await pay(prize());
    await newClaim(3_000);
    await deliver(itemEvent(`payout:${item.id}`, 'SUCCESS'));

    const all = PayoutsLedgerResponse.parse((await request(app()).get('/api/widgets/payouts').set(TREASURER)).body);
    const prizes = PayoutsLedgerResponse.parse(
      (await request(app()).get('/api/widgets/payouts?category=prizes').set(TREASURER)).body,
    );

    expect(all.source).toBe('live');
    expect(all.data.rows.map((r) => [r.kind, r.recipientName, r.status])).toEqual([
      ['prize', 'Ravi', 'paid'],
      ['claim', 'Ana', 'processing'],
    ]);
    expect(prizes.data.rows.map((r) => r.kind)).toEqual(['prize']);
  });
});
