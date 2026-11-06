import { EventsResponse, EventSummary } from '@quartermaster/shared';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import {
  auditLog,
  chatThreads,
  events,
  ledgerEntries,
  mandateItems,
  mandates,
  sponsors,
  tasks,
} from '../db/schema.js';
import { SESSION_COOKIE, sign } from '../auth/session.js';
import { DEMO_EVENT_NAME, seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { eventsRouter } from './events.js';

const env = { TREASURER_TOKEN: 'letmein' };
const treasurer = { 'x-treasurer-token': 'letmein' };
const spring = {
  name: 'Spring Meetup',
  date: '2027-05-20',
  people: 80,
  budget: 150_000,
  currency: 'USD',
};
const openhack = {
  name: 'OpenHack 2027',
  date: '2027-03-14',
  people: 200,
  budget: 800_000,
  currency: 'USD',
};

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const app = (getDb: () => Db) => {
  const a = express();
  a.use(express.json());
  a.use('/api/events', eventsRouter({ env, db: getDb }));
  return a;
};

describe('/api/events', () => {
  it('is treasurer only', async () => {
    expect((await request(app(() => db)).get('/api/events')).status).toBe(401);
    expect(
      (
        await request(app(() => db))
          .post('/api/events')
          .send(spring)
      ).status,
    ).toBe(401);
  });

  it('creates an event and lists every event soonest first, in the shared shape', async () => {
    const created = await request(app(() => db))
      .post('/api/events')
      .set(treasurer)
      .send(spring);
    expect(created.status).toBe(201);
    expect(EventSummary.parse(created.body)).toMatchObject(spring);
    await request(app(() => db))
      .post('/api/events')
      .set(treasurer)
      .send(openhack);

    const res = await request(app(() => db))
      .get('/api/events')
      .set(treasurer);
    expect(res.status).toBe(200);
    const names = EventsResponse.parse(res.body).events.map((e) => e.name);
    expect(names.indexOf('OpenHack 2027')).toBeLessThan(names.indexOf('Spring Meetup'));
  });

  it('refuses an invalid event and names the field', async () => {
    for (const [body, field] of [
      [{ ...spring, name: ' ' }, 'name'],
      [{ ...spring, date: '14/03/2027' }, 'date'],
      [{ ...spring, people: 0 }, 'people'],
      [{ ...spring, budget: 12.5 }, 'budget'],
      [{ ...spring, currency: 'usd' }, 'currency'],
    ] as const) {
      const res = await request(app(() => db))
        .post('/api/events')
        .set(treasurer)
        .send(body);
      expect(res.status).toBe(422);
      expect(res.body.field).toBe(field);
    }
  });

  it('answers 503 without a database and 500 when the query fails, without leaking the error', async () => {
    const noDb = () => {
      throw new Error('no url');
    };
    expect((await request(app(noDb)).get('/api/events').set(treasurer)).status).toBe(503);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      select: () => {
        throw new Error('boom');
      },
    } as unknown as Db;
    const res = await request(app(() => broken))
      .get('/api/events')
      .set(treasurer);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('boom');
  });

  describe('DELETE /:id', () => {
    async function create(body = spring) {
      const res = await request(app(() => db))
        .post('/api/events')
        .set(treasurer)
        .send(body);
      return EventSummary.parse(res.body).id;
    }
    const del = (id: string) =>
      request(app(() => db))
        .delete(`/api/events/${id}`)
        .set(treasurer);

    it('is treasurer only', async () => {
      const id = await create();
      expect((await request(app(() => db)).delete(`/api/events/${id}`)).status).toBe(401);
      expect(await db.select().from(events).where(eq(events.id, id))).toHaveLength(1);
    });

    it('deletes an event with no money history, with its plan, sponsors and chats, and audits it', async () => {
      const id = await create();
      const [sponsor] = await db
        .insert(sponsors)
        .values({ eventId: id, name: 'Acme Labs', tier: 'gold', pledged: 50_000 })
        .returning();
      await db.insert(tasks).values({
        eventId: id,
        name: 'Order lanyards',
        start: new Date('2027-05-01'),
        end: new Date('2027-05-02'),
        fundedBySponsorId: sponsor!.id,
      });
      const [thread] = await db.insert(chatThreads).values({ eventId: id }).returning();
      const [mandate] = await db
        .insert(mandates)
        .values({ threadId: thread!.id, eventId: id, goal: 'Plan it' })
        .returning();
      await db
        .insert(mandateItems)
        .values({ mandateId: mandate!.id, position: 0, title: 'Book a venue' });
      const other = await create(openhack);

      expect((await del(id)).status).toBe(204);

      expect(await db.select().from(events).where(eq(events.id, id))).toHaveLength(0);
      expect(await db.select().from(sponsors).where(eq(sponsors.eventId, id))).toHaveLength(0);
      expect(await db.select().from(tasks).where(eq(tasks.eventId, id))).toHaveLength(0);
      expect(await db.select().from(chatThreads).where(eq(chatThreads.eventId, id))).toHaveLength(
        0,
      );
      expect(await db.select().from(mandateItems)).toHaveLength(0);
      expect(await db.select().from(events).where(eq(events.id, other))).toHaveLength(1);
      const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'event.delete'));
      expect(audit).toMatchObject({
        actor: 'treasurer:ops-token',
        input: { eventId: id, name: 'Spring Meetup' },
      });
    });

    it('refuses an event with money history and keeps every row', async () => {
      const paid = await create();
      await db.insert(ledgerEntries).values({
        eventId: paid,
        direction: 'in',
        amount: 5_000,
        currency: 'USD',
        source: 'ticket',
        paypalId: 'CAPTURE-1',
      });
      const invoiced = await create({ ...spring, name: 'Autumn Meetup' });
      await db.insert(sponsors).values({
        eventId: invoiced,
        name: 'Acme Labs',
        tier: 'gold',
        pledged: 50_000,
        status: 'invoiced',
        paypalInvoiceId: 'INV2-TEST',
      });

      for (const id of [paid, invoiced]) {
        const res = await del(id);
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/money history/);
        expect(await db.select().from(events).where(eq(events.id, id))).toHaveLength(1);
      }
      expect(await db.select().from(ledgerEntries)).toHaveLength(1);
      expect(await db.select().from(auditLog)).toHaveLength(0);
    });

    it('refuses the seeded demo event', async () => {
      const id = await create({ ...openhack, name: DEMO_EVENT_NAME });
      const res = await del(id);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/demo event/);
    });

    it('answers 404 for an unknown or malformed id', async () => {
      expect((await del('00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await del('not-an-id')).status).toBe(404);
    });
  });
});

describe('/api/events per treasurer', () => {
  const SECRET = 's'.repeat(40);
  const ORIGIN = 'http://app.test';
  const sessions = { SESSION_SECRET: SECRET, APP_BASE_URL: ORIGIN };
  const as = (sub: string, via: 'paypal' | 'demo' = 'demo') => ({
    Cookie: `${SESSION_COOKIE}=${sign('session', { sub, via }, SECRET, 3600)}`,
    Origin: ORIGIN,
  });
  const appWith = () => {
    const a = express();
    a.use(express.json());
    a.use('/api/events', eventsRouter({ env: { ...env, ...sessions }, db: () => db }));
    return a;
  };
  const names = async (headers: Record<string, string>) =>
    EventsResponse.parse((await request(appWith()).get('/api/events').set(headers)).body).events.map(
      (e) => e.name,
    );

  it('shows each treasurer only their own events, plus the shared demo event', async () => {
    await seedDemoEvent(db);
    await request(appWith()).post('/api/events').set(as('alice')).send(spring).expect(201);
    await request(appWith())
      .post('/api/events')
      .set(as('PAYPAL-BOB', 'paypal'))
      .send({ ...spring, name: 'Bob summit' })
      .expect(201);

    expect(await names(as('alice'))).toEqual([DEMO_EVENT_NAME, 'Spring Meetup']);
    expect(await names(as('PAYPAL-BOB', 'paypal'))).toEqual([DEMO_EVENT_NAME, 'Bob summit']);
    expect(await names(as('carol'))).toEqual([DEMO_EVENT_NAME]);
    // A demo login and a PayPal login with the same id are still different people.
    expect(await names(as('PAYPAL-BOB'))).toEqual([DEMO_EVENT_NAME]);
    // The ops token (scripts, curl) sees every event.
    expect(await names(treasurer)).toEqual([DEMO_EVENT_NAME, 'Bob summit', 'Spring Meetup']);
  });

  it("hides events made before owners existed, and does not share an event that copies the demo's name", async () => {
    await db.insert(events).values({
      name: 'Old unowned event',
      date: new Date('2027-01-01'),
      headcount: 10,
      budgetTotal: 1_000,
    });
    await request(appWith())
      .post('/api/events')
      .set(as('mallory'))
      .send({ ...openhack, name: DEMO_EVENT_NAME })
      .expect(201);

    expect(await names(as('alice'))).toEqual([]);
    expect(await names(as('mallory'))).toEqual([DEMO_EVENT_NAME]);
  });

  it("answers 404 when deleting someone else's event, and keeps it", async () => {
    const res = await request(appWith()).post('/api/events').set(as('alice')).send(spring).expect(201);
    const id = EventSummary.parse(res.body).id;

    expect((await request(appWith()).delete(`/api/events/${id}`).set(as('bob'))).status).toBe(404);
    expect(await db.select().from(events).where(eq(events.id, id))).toHaveLength(1);
    expect((await request(appWith()).delete(`/api/events/${id}`).set(as('alice'))).status).toBe(204);
  });
});
