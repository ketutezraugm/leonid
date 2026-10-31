import { BudgetBurnResponse, DeliveryRiskResponse } from '@quartermaster/shared';
import express from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { sponsors } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { widgetsRouter } from '../routes/widgets.js';
import { recordLedgerEntry } from '../db/ledger.js';
import {
  assessDelivery,
  AT_RISK_SLACK_DAYS,
  getBudgetBurnSample,
  getDeliveryRiskSample,
} from './sample.js';

const NOW = new Date('2026-11-02T10:00:00Z');
const UNKNOWN_EVENT = '00000000-0000-4000-8000-000000000000';

let db: Db;
let eventId: string;
let budgetTotal: number;
let gold: string;
let silver: string;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.execute(sql`truncate table audit_log, events restart identity cascade`);
  const event = await seedDemoEvent(db);
  eventId = event.id;
  budgetTotal = event.budgetTotal;
  const rows = await db.select().from(sponsors);
  gold = rows.find((r) => r.tier === 'gold')!.id;
  silver = rows.find((r) => r.tier === 'silver')!.id;
});

const burn = async (filter = {}) => (await getBudgetBurnSample(db, eventId, filter, NOW))!;
const delivery = async (filter = {}) => (await getDeliveryRiskSample(db, eventId, filter, NOW))!;

describe('budget burn sample', () => {
  it('matches the numbers in the design mockups: cleared $3,000, committed $1,860, unlocked $1,140', async () => {
    const data = await burn();

    expect(data).toMatchObject({ clearedIncome: 300_000, committed: 186_000, unlocked: 114_000 });
    expect(data.currency).toBe('USD');
  });

  it('adds up: unlocked is cleared minus committed, and committed is every category spent plus committed', async () => {
    const data = await burn();

    expect(data.unlocked).toBe(data.clearedIncome - data.committed);
    expect(data.committed).toBe(data.categories.reduce((sum, c) => sum + c.spent + c.committed, 0));
  });

  it('has category caps that add up to the event budget, and no category over its cap', async () => {
    const data = await burn();

    expect(data.categories.reduce((sum, c) => sum + (c.cap ?? 0), 0)).toBe(budgetTotal);
    for (const c of data.categories)
      expect(c.spent + c.committed).toBeLessThanOrEqual(c.cap ?? Infinity);
  });

  it("uses the event's real date and counts the days to it from now", async () => {
    const data = await burn();

    expect(data.eventDate).toBe('2027-03-14');
    // Nov 2, 2026 to Mar 14, 2027.
    expect(data.daysToEvent).toBe(132);
  });

  it('counts the days as negative once the event has passed', async () => {
    const after = new Date('2027-03-16T08:00:00Z');
    expect((await getBudgetBurnSample(db, eventId, {}, after))!.daysToEvent).toBe(-2);
  });

  it('narrows the category list by category but keeps the event-wide totals', async () => {
    const data = await burn({ category: 'swag' });

    expect(data.categories.map((c) => c.category)).toEqual(['swag']);
    expect(data.committed).toBe(186_000);
    expect(data.unlocked).toBe(114_000);
  });

  it('ignores the sponsor filter, and answers an unknown category with an empty list', async () => {
    expect((await burn({ sponsorId: gold })).categories).toHaveLength(6);
    expect((await burn({ category: 'nonexistent' })).categories).toEqual([]);
  });

  it('does not read the ledger, so real cleared income cannot be mixed with the sample commitment', async () => {
    await recordLedgerEntry(db, {
      eventId,
      direction: 'in',
      amount: 999_999,
      currency: 'USD',
      source: 'donation',
      paypalId: 'CAP-LEDGER',
    });

    expect((await burn()).clearedIncome).toBe(300_000);
  });

  it('answers nothing for an unknown event', async () => {
    expect(await getBudgetBurnSample(db, UNKNOWN_EVENT, {}, NOW)).toBeUndefined();
  });
});

describe('delivery assessment', () => {
  it.each([
    ['expected after the deadline', '2027-03-09', '2027-03-07', 2, 'late'],
    ['expected one day after the deadline', '2027-03-08', '2027-03-07', 1, 'late'],
    ['expected on the deadline day', '2027-03-07', '2027-03-07', 0, 'at_risk'],
    ['expected a day early', '2027-03-06', '2027-03-07', -1, 'at_risk'],
    [
      'expected exactly the slack window early',
      '2027-03-05',
      '2027-03-07',
      -AT_RISK_SLACK_DAYS,
      'at_risk',
    ],
    ['expected more than the slack window early', '2027-03-04', '2027-03-07', -3, 'on_track'],
    ['expected with plenty of time', '2027-03-01', '2027-03-13', -12, 'on_track'],
    ['with no date from tracking yet', null, '2027-03-07', 0, 'unknown'],
  ])('rates an item %s', (_name, expected, deadline, daysLate, risk) => {
    expect(assessDelivery(expected, deadline)).toEqual({ daysLate, risk });
  });

  it('counts days across a month boundary', () => {
    expect(assessDelivery('2027-03-01', '2027-02-27')).toEqual({ daysLate: 2, risk: 'late' });
  });
});

describe('delivery risk sample', () => {
  it("tells P4's late-lanyards story, with the ratings computed from the dates", async () => {
    const data = await delivery();

    expect(data.items.map((i) => [i.name, i.daysLate, i.risk])).toEqual([
      ['Lanyards (200)', 2, 'late'],
      ['Prize trophies', -1, 'at_risk'],
      ['USB-C adapters', -5, 'on_track'],
      ['Snacks', 0, 'unknown'],
    ]);
    expect(data.items.find((i) => i.name === 'Snacks')).toMatchObject({
      trackingNumber: null,
      expectedDelivery: null,
    });
  });

  it("attaches the event's real gold and silver sponsors, so a sponsor click filters it too", async () => {
    const data = await delivery();

    expect(data.items.map((i) => i.sponsorId)).toEqual([gold, silver, gold, null]);
  });

  it('narrows by sponsor, by category, and by both', async () => {
    expect((await delivery({ sponsorId: gold })).items.map((i) => i.name)).toEqual([
      'Lanyards (200)',
      'USB-C adapters',
    ]);
    expect((await delivery({ category: 'prizes' })).items.map((i) => i.name)).toEqual([
      'Prize trophies',
    ]);
    expect((await delivery({ sponsorId: gold, category: 'swag' })).items).toHaveLength(2);
    expect((await delivery({ sponsorId: gold, category: 'food' })).items).toEqual([]);
  });

  it('gives every item its own order id and marks the whole set as sample data by its ids', async () => {
    const ids = (await delivery()).items.map((i) => i.orderId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('sample-'))).toBe(true);
  });

  it('leaves the sponsor empty when the event has no sponsor of that tier', async () => {
    await db.execute(sql`update sponsors set tier = 'bronze' where tier = 'gold'`);

    expect((await delivery()).items.map((i) => i.sponsorId)).toEqual([null, silver, null, null]);
  });

  it('answers nothing for an unknown event', async () => {
    expect(await getDeliveryRiskSample(db, UNKNOWN_EVENT, {}, NOW)).toBeUndefined();
  });
});

describe('sample widget routes', () => {
  const TOKEN = { 'x-treasurer-token': 'secret' };
  const appWith = (env: NodeJS.ProcessEnv = { TREASURER_TOKEN: 'secret' }) => {
    const app = express();
    app.use('/api/widgets', widgetsRouter({ env, db: () => db, now: () => NOW }));
    return app;
  };

  it('labels budget burn as sample, in the shared shape', async () => {
    const res = await request(appWith())
      .get(`/api/widgets/budget-burn?eventId=${eventId}`)
      .set(TOKEN);

    expect(res.status).toBe(200);
    const parsed = BudgetBurnResponse.parse(res.body);
    expect(parsed.source).toBe('sample');
    expect(parsed.data.unlocked).toBe(114_000);
  });

  it('labels delivery risk as sample, and applies the filters from the query string', async () => {
    const res = await request(appWith())
      .get(`/api/widgets/delivery-risk?eventId=${eventId}&sponsorId=${silver}&category=prizes`)
      .set(TOKEN);

    expect(res.status).toBe(200);
    const parsed = DeliveryRiskResponse.parse(res.body);
    expect(parsed.source).toBe('sample');
    expect(parsed.data.items.map((i) => i.name)).toEqual(['Prize trophies']);
  });

  it.each(['budget-burn', 'delivery-risk'])(
    '%s fails closed without a token and refuses a wrong one',
    async (name) => {
      const url = `/api/widgets/${name}?eventId=${eventId}`;
      expect((await request(appWith({})).get(url)).status).toBe(503);
      expect((await request(appWith()).get(url).set('x-treasurer-token', 'nope')).status).toBe(401);
    },
  );

  it.each(['budget-burn', 'delivery-risk'])(
    '%s answers 400 to a missing or bad event id and 404 to an unknown event',
    async (name) => {
      const app = appWith();
      expect((await request(app).get(`/api/widgets/${name}`).set(TOKEN)).status).toBe(400);
      expect((await request(app).get(`/api/widgets/${name}?eventId=nope`).set(TOKEN)).status).toBe(
        400,
      );
      expect(
        (await request(app).get(`/api/widgets/${name}?eventId=${UNKNOWN_EVENT}`).set(TOKEN)).status,
      ).toBe(404);
    },
  );
});
