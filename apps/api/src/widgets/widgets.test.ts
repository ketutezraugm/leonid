import { CommandCenterResponse, FundingThermometerResponse, RulesHealthResponse } from '@quartermaster/shared';
import express from 'express';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, sign } from '../auth/session.js';
import { writeAudit } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { createEvent } from '../db/events.js';
import { clearedIncome, recordLedgerEntry } from '../db/ledger.js';
import { events, sponsors } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { widgetsRouter } from '../routes/widgets.js';
import { getFundingThermometer, getRulesHealth, RULES_HEALTH_RECENT } from './live.js';

const NOW = new Date('2026-11-02T10:00:00Z');

let db: Db;
let eventId: string;
let id: Record<'harbor' | 'lumen' | 'pixel', string>;
let pledge: Record<'harbor' | 'lumen' | 'pixel', number>;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.execute(sql`truncate table audit_log, events restart identity cascade`);
  eventId = (await seedDemoEvent(db)).id;
  const rows = await db.select().from(sponsors);
  const by = (name: string) => rows.find((r) => r.name === name)!.id;
  id = { harbor: by('Harbor Cloud'), lumen: by('Lumen Labs'), pixel: by('Pixel Foundry') };
  const pledgeOf = (name: string) => rows.find((r) => r.name === name)!.pledged;
  pledge = {
    harbor: pledgeOf('Harbor Cloud'),
    lumen: pledgeOf('Lumen Labs'),
    pixel: pledgeOf('Pixel Foundry'),
  };
});

let seq = 0;
const income = (sponsorId: string | null, amount: number, over: Record<string, unknown> = {}) =>
  recordLedgerEntry(db, {
    eventId,
    direction: 'in',
    amount,
    currency: 'USD',
    source: 'sponsor_invoice',
    paypalId: `INV-${++seq}`,
    sponsorId,
    ...over,
  });
const reversal = (sponsorId: string, amount: number) =>
  recordLedgerEntry(db, {
    eventId,
    direction: 'out',
    amount,
    currency: 'USD',
    source: 'income_reversal',
    paypalId: `REF-${++seq}`,
    sponsorId,
  });
const setStatus = (sponsorId: string, status: 'pledged' | 'invoiced' | 'paid') =>
  db.update(sponsors).set({ status }).where(eq(sponsors.id, sponsorId));

const funding = async (filter = {}) => (await getFundingThermometer(db, eventId, filter, NOW))!;
const row = (data: Awaited<ReturnType<typeof funding>>, sponsorId: string) =>
  data.sponsors.find((s) => s.sponsorId === sponsorId)!;

describe('funding thermometer', () => {
  it('shows every sponsor pledged, with nothing invoiced or cleared yet', async () => {
    const data = await funding();

    expect(data.currency).toBe('USD');
    expect(data.asOf).toBe('2026-11-02T10:00:00.000Z');
    expect(data.sponsors.map((s) => [s.name, s.pledged, s.invoiced, s.cleared])).toEqual([
      // The seed's pledges, pinned to P4's mockups ($3,000 / $2,500 / $2,500): they add up to the $8,000 budget.
      ['Harbor Cloud', 300_000, 0, 0],
      ['Lumen Labs', 250_000, 0, 0],
      ['Pixel Foundry', 250_000, 0, 0],
    ]);
    expect(data.totals).toEqual({ pledged: 800_000, invoiced: 0, cleared: 0 });
  });

  it('counts an invoiced sponsor as invoiced but not cleared, and a paid one as both', async () => {
    await setStatus(id.harbor, 'invoiced');
    await setStatus(id.lumen, 'paid');
    await income(id.lumen, pledge.lumen);

    const data = await funding();

    expect(row(data, id.harbor)).toMatchObject({ invoiced: pledge.harbor, cleared: 0 });
    expect(row(data, id.lumen)).toMatchObject({ invoiced: pledge.lumen, cleared: pledge.lumen });
    expect(row(data, id.pixel)).toMatchObject({ invoiced: 0, cleared: 0 });
    expect(data.totals).toEqual({
      pledged: pledge.harbor + pledge.lumen + pledge.pixel,
      invoiced: pledge.harbor + pledge.lumen,
      cleared: pledge.lumen,
    });
  });

  it('takes refunds off cleared money, and never goes below zero', async () => {
    await setStatus(id.harbor, 'paid');
    await income(id.harbor, pledge.harbor);
    await reversal(id.harbor, 50_000);
    expect(row(await funding(), id.harbor).cleared).toBe(pledge.harbor - 50_000);

    await reversal(id.harbor, 400_000);
    expect(row(await funding(), id.harbor).cleared).toBe(0);
  });

  it('leaves out income in another currency and income with no sponsor', async () => {
    await income(id.harbor, 10_000);
    await income(id.harbor, 99_999, { currency: 'EUR' });
    await income(null, 77_777, { source: 'ticket' });

    const data = await funding();

    expect(row(data, id.harbor).cleared).toBe(10_000);
    expect(data.totals.cleared).toBe(10_000);
  });

  it('adds up to the same total as clearedIncome when all income is sponsor money', async () => {
    await income(id.harbor, pledge.harbor);
    await income(id.lumen, 120_000);
    await reversal(id.lumen, 20_000);

    const data = await funding();

    expect(data.totals.cleared).toBe(await clearedIncome(db, eventId, 'USD'));
    expect(data.totals.cleared).toBe(pledge.harbor + 100_000);
  });

  it('narrows to one sponsor, rows and totals together', async () => {
    await income(id.harbor, pledge.harbor);

    const data = await funding({ sponsorId: id.harbor });

    expect(data.sponsors).toHaveLength(1);
    expect(data.totals).toEqual({ pledged: pledge.harbor, invoiced: 0, cleared: pledge.harbor });
  });

  it('answers an unknown sponsor with an empty widget, and an unknown event with nothing', async () => {
    const empty = await funding({ sponsorId: '00000000-0000-4000-8000-000000000000' });
    expect(empty.sponsors).toEqual([]);
    expect(empty.totals).toEqual({ pledged: 0, invoiced: 0, cleared: 0 });

    expect(
      await getFundingThermometer(db, '00000000-0000-4000-8000-000000000000', {}, NOW),
    ).toBeUndefined();
  });

  it('ignores the category filter, which means nothing for a sponsor', async () => {
    expect((await funding({ category: 'swag' })).sponsors).toHaveLength(3);
  });
});

const decision = (d: 'allow' | 'needs_approval' | 'block', reason = 'because') =>
  JSON.stringify({ decision: d, reasons: [reason], ruleIds: ['stub-approval-threshold'] });

const spendCheck = (
  d: 'allow' | 'needs_approval' | 'block',
  input: Record<string, unknown> = { amountMinor: 14_000, currency: 'USD', category: 'swag' },
  action = 'spend.check',
) =>
  writeAudit(db, {
    actor: 'procurement-agent',
    action,
    input,
    ruleResult: decision(d),
    reason: 'agent reasoning',
  });

const health = async (filter = {}, forEvent = eventId) =>
  (await getRulesHealth(db, forEvent, filter, NOW))!;

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

describe('rules health', () => {
  it('shows only the checks that carried the event, and the demo event also gets checks with none', async () => {
    const side = await otherEvent();
    await spendCheck('allow', { amountMinor: 1, currency: 'USD', eventId: side });
    await spendCheck('block', { amountMinor: 2, currency: 'USD', eventId });
    await spendCheck('needs_approval', { amountMinor: 3, currency: 'USD' });

    expect((await health({}, side)).counts).toEqual({ allow: 1, needsApproval: 0, block: 0 });
    expect((await health({}, eventId)).counts).toEqual({ allow: 0, needsApproval: 1, block: 1 });
  });

  it('answers nothing for an event that does not exist', async () => {
    expect(
      await getRulesHealth(db, '00000000-0000-4000-8000-000000000000', {}, NOW),
    ).toBeUndefined();
  });

  it('counts allowed, sent to approval and blocked, and lists the latest with their reasons', async () => {
    await spendCheck('allow', { amountMinor: 14_000, currency: 'USD', category: 'swag' });
    await spendCheck('needs_approval', {
      amountMinor: 42_000,
      currency: 'USD',
      category: 'prizes',
    });
    await spendCheck('block', { amountMinor: 90_000, currency: 'USD', category: 'swag' });
    await spendCheck('allow', { amountMinor: 500, currency: 'USD', category: 'food' });

    const data = await health();

    expect(data.counts).toEqual({ allow: 2, needsApproval: 1, block: 1 });
    expect(data.recent).toHaveLength(4);
    expect(data.recent[0]).toMatchObject({
      actor: 'procurement-agent',
      action: 'spend.check',
      sponsorId: null,
      result: { reasons: ['because'], ruleIds: ['stub-approval-threshold'] },
    });
    expect(data.recent.map((e) => e.amount).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      500, 14_000, 42_000, 90_000,
    ]);
  });

  it('lists the newest decision first', async () => {
    await spendCheck('allow', { amountMinor: 1, currency: 'USD' });
    await new Promise((r) => setTimeout(r, 15));
    await spendCheck('block', { amountMinor: 2, currency: 'USD' });

    expect((await health()).recent.map((e) => e.amount)).toEqual([2, 1]);
  });

  it('counts only spend.check rows that carry a readable decision', async () => {
    await spendCheck('allow');
    await spendCheck('allow', undefined, 'spend.rejected');
    await writeAudit(db, {
      actor: 'x',
      action: 'spend.check',
      input: {},
      ruleResult: 'not json',
      reason: 'r',
    });
    await writeAudit(db, {
      actor: 'x',
      action: 'spend.check',
      input: {},
      ruleResult: '{"decision":"maybe"}',
      reason: 'r',
    });
    await writeAudit(db, {
      actor: 'x',
      action: 'spend.check',
      input: {},
      reason: 'no decision recorded',
    });

    const data = await health();

    expect(data.counts).toEqual({ allow: 1, needsApproval: 0, block: 0 });
    expect(data.recent).toHaveLength(1);
  });

  it('shows a decision with an unusable input rather than dropping it', async () => {
    await spendCheck('block', { amountMinor: -5, currency: 'dollars' });

    const [entry] = (await health()).recent;

    expect(entry).toMatchObject({ amount: null, currency: null, category: null });
  });

  it('narrows both the counts and the list by category', async () => {
    await spendCheck('allow', { amountMinor: 1, currency: 'USD', category: 'swag' });
    await spendCheck('block', { amountMinor: 2, currency: 'USD', category: 'swag' });
    await spendCheck('needs_approval', { amountMinor: 3, currency: 'USD', category: 'prizes' });

    const data = await health({ category: 'swag' });

    expect(data.counts).toEqual({ allow: 1, needsApproval: 0, block: 1 });
    expect(data.recent.every((e) => e.category === 'swag')).toBe(true);
  });

  it('ignores the sponsor filter, because a spend has no sponsor', async () => {
    await spendCheck('allow');
    expect((await health({ sponsorId: id.harbor })).counts.allow).toBe(1);
  });

  it('lists only the latest decisions but counts all of them', async () => {
    for (let i = 0; i < RULES_HEALTH_RECENT + 5; i++) await spendCheck('allow');

    const data = await health();

    expect(data.recent).toHaveLength(RULES_HEALTH_RECENT);
    expect(data.counts.allow).toBe(RULES_HEALTH_RECENT + 5);
  });
});

describe('widget routes', () => {
  const TOKEN = { 'x-treasurer-token': 'secret' };
  const appWith = (env: NodeJS.ProcessEnv = { TREASURER_TOKEN: 'secret' }) => {
    const app = express();
    app.use('/api/widgets', widgetsRouter({ env, db: () => db, now: () => NOW }));
    return app;
  };

  it('fails closed with no treasurer token configured, and refuses a wrong one', async () => {
    expect((await request(appWith({})).get(`/api/widgets/funding?eventId=${eventId}`)).status).toBe(
      503,
    );
    const wrong = await request(appWith())
      .get(`/api/widgets/funding?eventId=${eventId}`)
      .set('x-treasurer-token', 'nope');
    expect(wrong.status).toBe(401);
  });

  it('serves the funding thermometer as live data in the shared shape', async () => {
    await setStatus(id.harbor, 'paid');
    await income(id.harbor, pledge.harbor);

    const res = await request(appWith()).get(`/api/widgets/funding?eventId=${eventId}`).set(TOKEN);

    expect(res.status).toBe(200);
    const parsed = FundingThermometerResponse.parse(res.body);
    expect(parsed.source).toBe('live');
    expect(parsed.data.totals.cleared).toBe(pledge.harbor);
  });

  it('applies the sponsor filter from the query string', async () => {
    const res = await request(appWith())
      .get(`/api/widgets/funding?eventId=${eventId}&sponsorId=${id.pixel}`)
      .set(TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data.sponsors).toHaveLength(1);
    expect(res.body.data.sponsors[0].name).toBe('Pixel Foundry');
  });

  it('uses the seeded demo event when no event id is given, and answers 404 when there is none', async () => {
    const res = await request(appWith()).get('/api/widgets/funding').set(TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data.sponsors).toHaveLength(3);

    await db.execute(sql`truncate table audit_log, events restart identity cascade`);

    expect((await request(appWith()).get('/api/widgets/funding').set(TOKEN)).status).toBe(404);
  });

  it.each([
    ['an event id that is not a UUID', '/api/widgets/funding?eventId=nope'],
    [
      'an empty sponsor filter',
      '/api/widgets/funding?eventId=00000000-0000-4000-8000-000000000000&sponsorId=',
    ],
  ])('answers 400 to %s', async (_name, url) => {
    expect((await request(appWith()).get(url).set(TOKEN)).status).toBe(400);
  });

  it('answers 404 to an event that does not exist', async () => {
    const res = await request(appWith())
      .get('/api/widgets/funding?eventId=00000000-0000-4000-8000-000000000000')
      .set(TOKEN);
    expect(res.status).toBe(404);
  });

  it('serves rules health as live data, filtered by category', async () => {
    await spendCheck('allow', { amountMinor: 1, currency: 'USD', category: 'swag' });
    await spendCheck('block', { amountMinor: 2, currency: 'USD', category: 'prizes' });

    const all = await request(appWith()).get('/api/widgets/rules-health').set(TOKEN);
    const swag = await request(appWith()).get('/api/widgets/rules-health?category=swag').set(TOKEN);

    expect(RulesHealthResponse.parse(all.body).data.counts).toEqual({
      allow: 1,
      needsApproval: 0,
      block: 1,
    });
    expect(RulesHealthResponse.parse(swag.body)).toMatchObject({
      source: 'live',
      data: { counts: { allow: 1, needsApproval: 0, block: 0 } },
    });
  });

  it('scopes rules health to the event in the query, and answers 404 to one that does not exist', async () => {
    const side = await otherEvent();
    await spendCheck('allow', { amountMinor: 1, currency: 'USD', eventId: side });
    await spendCheck('block', { amountMinor: 2, currency: 'USD', eventId });

    const forSide = await request(appWith())
      .get(`/api/widgets/rules-health?eventId=${side}`)
      .set(TOKEN);
    const forDemo = await request(appWith()).get('/api/widgets/rules-health').set(TOKEN);
    const unknown = await request(appWith())
      .get('/api/widgets/rules-health?eventId=00000000-0000-4000-8000-000000000000')
      .set(TOKEN);

    expect(RulesHealthResponse.parse(forSide.body).data.counts).toEqual({
      allow: 1,
      needsApproval: 0,
      block: 0,
    });
    expect(RulesHealthResponse.parse(forDemo.body).data.counts).toEqual({
      allow: 0,
      needsApproval: 0,
      block: 1,
    });
    expect(unknown.status).toBe(404);
  });

  describe('the command center: all five widgets in one answer', () => {
    it("answers 404 for someone else's event, like the single widget routes (#105)", async () => {
      const SECRET = 's'.repeat(40);
      const as = (sub: string) => ({ Cookie: `${SESSION_COOKIE}=${sign('session', { sub, via: 'demo' }, SECRET, 3600)}` });
      const alices = await createEvent(
        db,
        { name: 'Alice meetup', date: '2027-05-20', people: 40, budget: 100_000, currency: 'USD' },
        'demo:alice',
      );
      const app = appWith({ SESSION_SECRET: SECRET, APP_BASE_URL: 'http://app.test' });
      const url = `/api/widgets/command-center?eventId=${alices.id}`;

      expect((await request(app).get(url).set(as('bob'))).status).toBe(404);
      const own = await request(app).get(url).set(as('alice'));
      expect(own.status).toBe(200);
      expect(CommandCenterResponse.parse(own.body).funding.data.sponsors).toEqual([]);
    });

    it('gives each widget exactly what its own endpoint gives, with the same source', async () => {
      await setStatus(id.harbor, 'paid');
      await income(id.harbor, pledge.harbor);
      await spendCheck('allow', { amountMinor: 1, currency: 'USD', category: 'swag' });

      const app = appWith();
      const one = await request(app).get(`/api/widgets/command-center?eventId=${eventId}`).set(TOKEN);
      const each = async (path: string) =>
        (await request(app).get(`/api/widgets/${path}?eventId=${eventId}`).set(TOKEN)).body;

      expect(one.status).toBe(200);
      const parsed = CommandCenterResponse.parse(one.body);
      expect(parsed).toEqual({
        funding: await each('funding'),
        budget: await each('budget-burn'),
        payouts: await each('payouts'),
        rules: await each('rules-health'),
        delivery: await each('delivery-risk'),
      });
      expect(parsed.funding.source).toBe('live');
      expect(parsed.payouts.source).toBe('live'); // F17: claims, prizes and speaker fees
    });

    it('uses the seeded demo event when no event id is given', async () => {
      const res = await request(appWith()).get('/api/widgets/command-center').set(TOKEN);

      expect(res.status).toBe(200);
      expect(CommandCenterResponse.parse(res.body).funding.data.sponsors).toHaveLength(3);
    });

    it('answers 400 to a bad event id, 404 to an unknown one, and is treasurer-only', async () => {
      const app = appWith();
      expect((await request(app).get('/api/widgets/command-center?eventId=nope').set(TOKEN)).status).toBe(400);
      expect(
        (await request(app).get('/api/widgets/command-center?eventId=00000000-0000-4000-8000-000000000000').set(TOKEN))
          .status,
      ).toBe(404);
      expect((await request(app).get('/api/widgets/command-center')).status).toBe(401);
    });
  });

  it('answers 500 without leaking the error when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      select: () => {
        throw new Error('connection string postgres://secret');
      },
    } as unknown as Db;
    const app = express();
    app.use(
      '/api/widgets',
      widgetsRouter({ env: { TREASURER_TOKEN: 'secret' }, db: () => broken, now: () => NOW }),
    );

    const res = await request(app).get('/api/widgets/rules-health').set(TOKEN);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('postgres://');
  });
});
