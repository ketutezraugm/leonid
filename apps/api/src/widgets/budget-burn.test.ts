import { readFileSync } from 'node:fs';
import { BudgetBurnResponse } from '@leonid/shared';
import express from 'express';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { recordLedgerEntry } from '../db/ledger.js';
import { approvals, events, sponsors } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { createDbApprovals, createDbAudit } from '../payments/db.js';
import type { CheckResult, Spend } from '../payments/ports.js';
import { createRulesCheck } from '../payments/rulesCheck.js';
import { widgetsRouter } from '../routes/widgets.js';
import { createInvoicePaidHandler } from '../webhooks/handlers/invoice-paid.js';
import type { WebhookEvent } from '../webhooks/registry.js';
import { getBudgetBurn, UNCATEGORISED } from './live.js';

const NOW = new Date('2026-11-02T10:00:00Z');
const UNKNOWN_EVENT = '00000000-0000-4000-8000-000000000000';

let db: Db;
let eventId: string;

// One in-memory Postgres for the file; tables are emptied between tests.
beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.execute(sql`truncate table audit_log, events restart identity cascade`);
  eventId = (await seedDemoEvent(db)).id;
});

const burn = async (filter = {}, forEvent = eventId) =>
  (await getBudgetBurn(db, forEvent, filter, NOW))!;
const category = (data: Awaited<ReturnType<typeof burn>>, name: string) =>
  data.categories.find((c) => c.category === name);

let seq = 0;
const clear = (amount: number, forEvent = eventId) =>
  recordLedgerEntry(db, {
    eventId: forEvent,
    direction: 'in',
    amount,
    currency: 'USD',
    source: 'sponsor_invoice',
    paypalId: `INV-${++seq}`,
  });

const spend = (amountMinor: number, extra: Partial<Spend> = {}): Spend => ({
  referenceId: `ref-${++seq}`,
  amountMinor,
  currency: 'USD',
  actor: 'procurement-agent',
  reason: 'x',
  category: 'prizes',
  eventId,
  ...extra,
});

const result = (decision: CheckResult['decision']): CheckResult => ({
  decision,
  reasons: [],
  ruleIds: [],
});

// What the payment executor writes for a spend: a spend.check row, then its outcome.
async function recorded(s: Spend, decision: CheckResult['decision'], outcome?: string) {
  const audit = createDbAudit(db);
  const id = await audit.record({
    actor: s.actor,
    action: 'spend.check',
    input: s,
    reason: s.reason,
    ruleResult: result(decision),
  });
  if (outcome) await audit.update(id, { outcome });
  return id;
}

async function sentToTreasurer(s: Spend) {
  const auditId = await recorded(s, 'needs_approval', 'needs_approval');
  return createDbApprovals(db).create(s, result('needs_approval'), auditId);
}

const otherEvent = async () => {
  const [event] = await db
    .insert(events)
    .values({
      name: 'Side Event',
      date: new Date('2027-05-01T09:00:00Z'),
      headcount: 50,
      budgetTotal: 100_000,
      currency: 'USD',
    })
    .returning();
  return event!.id;
};

describe('budget burn', () => {
  it('shows nothing unlocked before a sponsor pays, with the cap from the rules in force', async () => {
    const data = await burn();

    expect(data).toMatchObject({
      currency: 'USD',
      eventDate: '2027-03-14',
      daysToEvent: 132,
      clearedIncome: 0,
      committed: 0,
      unlocked: 0,
    });
    // The demo rules cap swag at $1,000.00 and nothing else.
    expect(data.categories).toEqual([{ category: 'swag', cap: 100_000, spent: 0, committed: 0 }]);
  });

  it('counts paid spend as spent and held spend as committed, and takes both off cleared income', async () => {
    await clear(300_000);
    await recorded(spend(14_000, { category: 'swag', vendor: 'Lanyard Co' }), 'allow', 'paid');
    await sentToTreasurer(spend(42_000, { category: 'prizes' }));

    const data = await burn();

    expect(data).toMatchObject({ clearedIncome: 300_000, committed: 56_000, unlocked: 244_000 });
    expect(category(data, 'swag')).toEqual({
      category: 'swag',
      cap: 100_000,
      spent: 14_000,
      committed: 0,
    });
    expect(category(data, 'prizes')).toEqual({
      category: 'prizes',
      cap: null,
      spent: 0,
      committed: 42_000,
    });
  });

  it('moves a spend from committed to spent once the treasurer approves and it is captured', async () => {
    await clear(100_000);
    const approvalId = await sentToTreasurer(spend(42_000));
    await db.update(approvals).set({ status: 'paid' }).where(eq(approvals.id, approvalId));

    expect(category(await burn(), 'prizes')).toMatchObject({ spent: 42_000, committed: 0 });
  });

  it('gives the money back for a blocked spend, a refused one and a rejected one', async () => {
    await clear(100_000);
    await recorded(spend(10_000), 'block', 'blocked');
    await recorded(spend(10_000), 'allow', 'refused');
    const approvalId = await sentToTreasurer(spend(10_000));
    await createDbApprovals(db).reject(approvalId, 'treasurer');

    expect(await burn()).toMatchObject({ committed: 0, unlocked: 100_000 });
  });

  it("leaves out other events' spends and checks that named no event, as the rules check does", async () => {
    const side = await otherEvent();
    await clear(100_000);
    await recorded(spend(10_000, { eventId: side }), 'allow', 'paid');
    await recorded(spend(10_000, { eventId: undefined }), 'allow', 'paid');

    expect(await burn()).toMatchObject({ committed: 0, unlocked: 100_000 });
    expect(await burn({}, side)).toMatchObject({
      clearedIncome: 0,
      committed: 10_000,
      unlocked: -10_000,
    });
  });

  it('is informational: the rules check does not stop a spend at the unlocked budget', async () => {
    await clear(30_000);
    await recorded(spend(15_000), 'allow', 'paid');
    const { unlocked } = await burn();
    const check = createRulesCheck(db, { now: () => NOW });

    expect(unlocked).toBe(15_000);
    expect((await check(spend(unlocked))).decision).toBe('allow');
    expect((await check(spend(unlocked + 1))).decision).toBe('allow');
  });

  it('groups categories the way the rules check does, and lists a spend with none on its own line', async () => {
    await clear(100_000);
    await recorded(spend(1_000, { category: ' Swag ', vendor: 'Lanyard Co' }), 'allow', 'paid');
    await recorded(spend(2_000, { category: undefined }), 'needs_approval', 'needs_approval');

    const data = await burn();

    expect(category(data, 'swag')).toMatchObject({ cap: 100_000, spent: 1_000 });
    expect(category(data, UNCATEGORISED)).toEqual({
      category: UNCATEGORISED,
      cap: null,
      spent: 0,
      committed: 2_000,
    });
    expect(data.committed).toBe(3_000);
  });

  it('narrows the category list by category but keeps the event-wide totals', async () => {
    await clear(100_000);
    await recorded(spend(1_000, { category: 'swag', vendor: 'Lanyard Co' }), 'allow', 'paid');
    await recorded(spend(2_000, { category: 'prizes' }), 'allow', 'paid');

    const data = await burn({ category: 'prizes' });

    expect(data.categories.map((c) => c.category)).toEqual(['prizes']);
    expect(data).toMatchObject({ committed: 3_000, unlocked: 97_000 });
  });

  it('takes the stricter of two caps on one category, and leaves out a cap in another currency', async () => {
    const rules = [
      { id: 'a', type: 'category_cap', category: 'swag', amountMinor: 50_000, currency: 'USD' },
      { id: 'b', type: 'category_cap', category: 'Swag', amountMinor: 30_000, currency: 'USD' },
      { id: 'c', type: 'category_cap', category: 'food', amountMinor: 10_000, currency: 'EUR' },
    ] as const;

    const data = (await getBudgetBurn(db, eventId, {}, NOW, [...rules]))!;

    expect(data.categories).toEqual([{ category: 'swag', cap: 30_000, spent: 0, committed: 0 }]);
  });

  it('answers nothing for an unknown event', async () => {
    expect(await getBudgetBurn(db, UNKNOWN_EVENT, {}, NOW)).toBeUndefined();
  });
});

// F4 step 8: the sponsor pays the invoice, PayPal says so by webhook, and the unlocked budget rises (shown, not enforced).
// Uses the real INVOICING.INVOICE.PAID event from the sandbox ($1.00, fully paid).
describe('F4 step 8: a paid sponsor invoice unlocks budget', () => {
  const fixture = readFileSync(
    new URL('../webhooks/handlers/fixtures/invoice-paid.json', import.meta.url),
    'utf8',
  );
  const INVOICE_ID = 'INV2-KUAD-G3SZ-RL4H-P6QK';

  it('raises the unlocked budget by the paid amount', async () => {
    const [sponsor] = await db
      .select()
      .from(sponsors)
      .where(eq(sponsors.eventId, eventId))
      .limit(1);
    await db
      .update(sponsors)
      .set({ paypalInvoiceId: INVOICE_ID, status: 'invoiced' })
      .where(eq(sponsors.id, sponsor!.id));
    expect((await burn()).unlocked).toBe(0);

    await createInvoicePaidHandler(() => db)(JSON.parse(fixture) as WebhookEvent, {
      app: 'treasury',
    });

    expect(await burn()).toMatchObject({ clearedIncome: 100, committed: 0, unlocked: 100 });
  });
});

describe('budget burn route', () => {
  const TOKEN = { 'x-treasurer-token': 'secret' };
  const appWith = (env: NodeJS.ProcessEnv = { TREASURER_TOKEN: 'secret' }) => {
    const app = express();
    app.use('/api/widgets', widgetsRouter({ env, db: () => db, now: () => NOW }));
    return app;
  };

  it('serves live data in the shared shape, for the seeded demo event when no event is named', async () => {
    await clear(300_000);

    const named = await request(appWith())
      .get(`/api/widgets/budget-burn?eventId=${eventId}`)
      .set(TOKEN);
    const unnamed = await request(appWith()).get('/api/widgets/budget-burn').set(TOKEN);

    expect(BudgetBurnResponse.parse(named.body)).toMatchObject({
      source: 'live',
      data: { clearedIncome: 300_000, unlocked: 300_000 },
    });
    expect(unnamed.body).toEqual(named.body);
  });

  it('fails closed without a token, refuses a wrong one, and answers 400 and 404 to bad events', async () => {
    const app = appWith();
    const url = `/api/widgets/budget-burn?eventId=${eventId}`;
    expect((await request(appWith({})).get(url)).status).toBe(503);
    expect((await request(app).get(url).set('x-treasurer-token', 'nope')).status).toBe(401);
    expect(
      (await request(app).get('/api/widgets/budget-burn?eventId=nope').set(TOKEN)).status,
    ).toBe(400);
    expect(
      (await request(app).get(`/api/widgets/budget-burn?eventId=${UNKNOWN_EVENT}`).set(TOKEN))
        .status,
    ).toBe(404);
  });

  it('answers 404 with no event id when there is no demo event to fall back on', async () => {
    await db.execute(sql`truncate table audit_log, events restart identity cascade`);
    expect((await request(appWith()).get('/api/widgets/budget-burn').set(TOKEN)).status).toBe(404);
  });
});
