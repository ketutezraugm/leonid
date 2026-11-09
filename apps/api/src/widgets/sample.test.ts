import { DeliveryRiskResponse, PayoutsLedgerResponse } from '@leonid/shared';
import express from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { sponsors } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { widgetsRouter } from '../routes/widgets.js';
import {
  assessDelivery,
  AT_RISK_SLACK_DAYS,
  getDeliveryRiskSample,
  getPayoutsLedgerSample,
} from './sample.js';

const NOW = new Date('2026-11-02T10:00:00Z');
const UNKNOWN_EVENT = '00000000-0000-4000-8000-000000000000';

let db: Db;
let eventId: string;
let gold: string;
let silver: string;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.execute(sql`truncate table audit_log, events restart identity cascade`);
  const event = await seedDemoEvent(db);
  eventId = event.id;
  const rows = await db.select().from(sponsors);
  gold = rows.find((r) => r.tier === 'gold')!.id;
  silver = rows.find((r) => r.tier === 'silver')!.id;
});

const delivery = async (filter = {}) => (await getDeliveryRiskSample(db, eventId, filter, NOW))!;
const payouts = async (filter = {}) => (await getPayoutsLedgerSample(db, eventId, filter, NOW))!;

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

describe('payouts ledger sample', () => {
  it('lists two prize winners and a volunteer claim, in the event currency', async () => {
    const data = await payouts();

    expect(data.rows.map((r) => [r.recipientName, r.kind, r.status])).toEqual([
      ['Ada Winner', 'prize', 'queued'],
      ['Ravi Winner', 'prize', 'pending_approval'],
      ['Sam Volunteer', 'claim', 'paid'],
    ]);
    expect(data.rows.every((r) => r.currency === 'USD' && r.eventId === eventId)).toBe(true);
  });

  it("attaches the event's real gold and silver sponsors, so a sponsor click filters it too", async () => {
    const data = await payouts();

    expect(data.rows.map((r) => r.sponsorId)).toEqual([gold, silver, null]);
  });

  it('narrows by sponsor, by category, and by both', async () => {
    const names = async (filter: object) =>
      (await payouts(filter)).rows.map((r) => r.recipientName);

    expect(await names({ sponsorId: gold })).toEqual(['Ada Winner']);
    expect(await names({ category: 'food' })).toEqual(['Sam Volunteer']);
    expect(await names({ category: 'prizes' })).toEqual(['Ada Winner', 'Ravi Winner']);
    expect(await names({ sponsorId: silver, category: 'prizes' })).toEqual(['Ravi Winner']);
    expect(await names({ sponsorId: silver, category: 'food' })).toEqual([]);
  });

  it('only gives a payout a PayPal item and a batch once it is paid, as a real one would', async () => {
    for (const row of (await payouts()).rows) {
      const paid = row.status === 'paid';
      expect(row.paypalItemId !== null, row.id).toBe(paid);
      expect(row.payoutId !== null, row.id).toBe(paid);
    }
  });

  it('gives each payout its own id, and marks the whole set as sample data by its ids', async () => {
    const ids = (await payouts()).rows.map((r) => r.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('sample-'))).toBe(true);
  });

  it('keeps amounts as whole cents and the rule results consistent with the status', async () => {
    for (const row of (await payouts()).rows) {
      expect(Number.isInteger(row.amount), row.id).toBe(true);
      if (row.status === 'pending_approval')
        expect(row.ruleResult?.decision).toBe('needs_approval');
    }
  });

  it('leaves the sponsor empty when the event has no sponsor of that tier', async () => {
    await db.execute(sql`update sponsors set tier = 'bronze' where tier = 'gold'`);

    expect((await payouts()).rows.map((r) => r.sponsorId)).toEqual([null, silver, null]);
  });

  it('answers nothing for an unknown event', async () => {
    expect(await getPayoutsLedgerSample(db, UNKNOWN_EVENT, {}, NOW)).toBeUndefined();
  });
});

describe('sample widget routes', () => {
  const TOKEN = { 'x-treasurer-token': 'secret' };
  const appWith = (env: NodeJS.ProcessEnv = { TREASURER_TOKEN: 'secret' }) => {
    const app = express();
    app.use('/api/widgets', widgetsRouter({ env, db: () => db, now: () => NOW }));
    return app;
  };

  it('labels delivery risk as sample, and applies the filters from the query string', async () => {
    const res = await request(appWith())
      .get(`/api/widgets/delivery-risk?eventId=${eventId}&sponsorId=${silver}&category=prizes`)
      .set(TOKEN);

    expect(res.status).toBe(200);
    const parsed = DeliveryRiskResponse.parse(res.body);
    expect(parsed.source).toBe('sample');
    expect(parsed.data.items.map((i) => i.name)).toEqual(['Prize trophies']);
  });

  // F17: the payouts ledger is live now (payouts/service.test.ts covers its rows); with none yet it is empty.
  it('serves payouts as live data, empty before anyone has been paid', async () => {
    const res = await request(appWith())
      .get(`/api/widgets/payouts?eventId=${eventId}&sponsorId=${silver}&category=prizes`)
      .set(TOKEN);

    expect(res.status).toBe(200);
    const parsed = PayoutsLedgerResponse.parse(res.body);
    expect(parsed.source).toBe('live');
    expect(parsed.data.rows).toEqual([]);
  });

  it.each(['delivery-risk', 'payouts'])(
    '%s fails closed without a token and refuses a wrong one',
    async (name) => {
      const url = `/api/widgets/${name}?eventId=${eventId}`;
      expect((await request(appWith({})).get(url)).status).toBe(503);
      expect((await request(appWith()).get(url).set('x-treasurer-token', 'nope')).status).toBe(401);
    },
  );

  it.each(['delivery-risk', 'payouts'])(
    '%s answers 400 to a bad event id and 404 to an unknown event',
    async (name) => {
      const app = appWith();
      expect((await request(app).get(`/api/widgets/${name}?eventId=nope`).set(TOKEN)).status).toBe(
        400,
      );
      expect(
        (await request(app).get(`/api/widgets/${name}?eventId=${UNKNOWN_EVENT}`).set(TOKEN)).status,
      ).toBe(404);
    },
  );

  // The web does not know an event's id until the Event endpoint exists, so the demo event is the default.
  it.each(['delivery-risk', 'payouts'])(
    '%s uses the seeded demo event when no event id is given',
    async (name) => {
      const res = await request(appWith()).get(`/api/widgets/${name}`).set(TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.source).toBe(name === 'payouts' ? 'live' : 'sample');
    },
  );

  it.each(['delivery-risk', 'payouts'])(
    '%s answers 404 with no event id when there is no demo event to fall back on',
    async (name) => {
      await db.execute(sql`truncate table audit_log, events restart identity cascade`);

      expect((await request(appWith()).get(`/api/widgets/${name}`).set(TOKEN)).status).toBe(404);
    },
  );
});
