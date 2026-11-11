import { EventsResponse, EventSummary, PlanResponse, TaskKind, Workstream } from '@leonid/shared';
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
  TASK_KINDS,
  tasks,
  WORKSTREAMS,
} from '../db/schema.js';
import { SESSION_COOKIE, sign } from '../auth/session.js';
import { DEMO_EVENT_NAME, DEMO_TASKS, seedDemoEvent, seedDemoPlan } from '../db/seed.js';
import { createTasks } from '../db/tasks.js';
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

  it('keeps the setup answers with the event, so planning can start later', async () => {
    const brief = 'Plan our new event, Spring Meetup: a meetup for 80 people in Jakarta.';
    const created = await request(app(() => db))
      .post('/api/events')
      .set(treasurer)
      .send({ ...spring, brief });
    expect(created.status).toBe(201);
    expect(created.body.brief).toBe(brief);

    const res = await request(app(() => db))
      .get('/api/events')
      .set(treasurer);
    const listed = EventsResponse.parse(res.body).events.find((e) => e.id === created.body.id);
    expect(listed?.brief).toBe(brief);
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
    EventsResponse.parse(
      (await request(appWith()).get('/api/events').set(headers)).body,
    ).events.map((e) => e.name);

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
    const res = await request(appWith())
      .post('/api/events')
      .set(as('alice'))
      .send(spring)
      .expect(201);
    const id = EventSummary.parse(res.body).id;

    expect((await request(appWith()).delete(`/api/events/${id}`).set(as('bob'))).status).toBe(404);
    expect(await db.select().from(events).where(eq(events.id, id))).toHaveLength(1);
    expect((await request(appWith()).delete(`/api/events/${id}`).set(as('alice'))).status).toBe(
      204,
    );
  });
});

describe('GET /api/events/:id/plan', () => {
  const SECRET = 's'.repeat(40);
  const ORIGIN = 'http://app.test';
  const as = (sub: string) => ({
    Cookie: `${SESSION_COOKIE}=${sign('session', { sub, via: 'demo' }, SECRET, 3600)}`,
    Origin: ORIGIN,
  });
  const appWith = () => {
    const a = express();
    a.use(express.json());
    a.use(
      '/api/events',
      eventsRouter({ env: { ...env, SESSION_SECRET: SECRET, APP_BASE_URL: ORIGIN }, db: () => db }),
    );
    return a;
  };
  const planOf = async (id: string, sub: string) =>
    request(appWith()).get(`/api/events/${id}/plan`).set(as(sub));

  it("gives each event its own tasks and hides another treasurer's", async () => {
    const alice = (await request(appWith()).post('/api/events').set(as('alice')).send(spring)).body;
    const bob = (await request(appWith()).post('/api/events').set(as('bob')).send(openhack)).body;
    await createTasks(db, alice.id, [
      {
        name: 'Book hall',
        start: new Date('2027-04-01T00:00:00Z'),
        end: new Date('2027-04-02T23:59:59Z'),
      },
    ]);
    await createTasks(db, bob.id, [
      {
        name: 'Order swag',
        start: new Date('2027-02-01T00:00:00Z'),
        end: new Date('2027-02-02T23:59:59Z'),
      },
      {
        name: 'Swag delivery',
        start: new Date('2027-02-03T00:00:00Z'),
        end: new Date('2027-02-20T23:59:59Z'),
        dependsOnNames: ['Order swag'],
      },
    ]);

    const a = PlanResponse.parse((await planOf(alice.id, 'alice')).body);
    const b = PlanResponse.parse((await planOf(bob.id, 'bob')).body);
    expect(a.tasks.map((t) => t.name)).toEqual(['Book hall']);
    expect(b.tasks.map((t) => t.name)).toEqual(['Order swag', 'Swag delivery']);
    expect(b.tasks[1]?.dependsOn).toEqual([b.tasks[0]?.id]);
    expect(b.eventDate).toBe('2027-03-14T00:00:00.000Z');
    expect((await planOf(alice.id, 'bob')).status).toBe(404);
  });

  it('is empty for a new event and shows the seeded plan for the demo event', async () => {
    const mine = (await request(appWith()).post('/api/events').set(as('alice')).send(spring)).body;
    expect((await planOf(mine.id, 'alice')).body.tasks).toEqual([]);

    const demo = await seedDemoEvent(db);
    await seedDemoPlan(db, demo.id);
    await seedDemoPlan(db, demo.id);
    const viaId = PlanResponse.parse((await planOf(demo.id, 'alice')).body);
    const viaAlias = PlanResponse.parse((await planOf('demo', 'alice')).body);
    expect(viaId.tasks).toHaveLength(DEMO_TASKS.length);
    expect(viaAlias).toEqual(viaId);
    expect(viaId.tasks.filter((t) => t.invoiceOfSponsorId)).toHaveLength(3);
  });

  it('seeds a real event plan: workstreams, payments and the event-week milestones', async () => {
    const demo = await seedDemoEvent(db);
    await seedDemoPlan(db, demo.id);
    const rows = PlanResponse.parse((await planOf(demo.id, 'alice')).body).tasks;
    const byName = new Map(rows.map((t) => [t.name, t]));

    expect(rows.every((t) => t.workstream !== null)).toBe(true);
    expect(rows.filter((t) => t.kind === 'milestone').map((t) => t.name)).toEqual([
      'Final confirmations with vendors',
      'Final rehearsal',
      'Event day',
    ]);
    const rehearsal = byName.get('Final rehearsal');
    expect(rehearsal?.start).toBe('2027-03-13T00:00:00.000Z');
    expect(rehearsal?.end).toBe(rehearsal?.start);
    expect(rehearsal?.dependsOn).toContain(byName.get('Load-in and AV/wifi test')?.id);
    expect(byName.get('Event day')?.dependsOn).toContain(rehearsal?.id);
    expect(byName.get('Load-out and thank-yous')?.dependsOn).toEqual([byName.get('Event day')?.id]);
    expect(byName.get('Pay printer')).toMatchObject({ kind: 'payment', workstream: 'printing' });
    expect(new Set(rows.map((t) => t.workstream))).toEqual(new Set(WORKSTREAMS));
  });

  it('tops up a plan seeded before workstreams, keeping its tasks and the ones added since', async () => {
    const demo = await seedDemoEvent(db);
    const old = await createTasks(db, demo.id, [
      { name: 'Book AV', start: new Date('2027-01-13T00:00:00Z'), end: new Date('2027-01-17T23:59:59Z') },
      {
        name: 'Event day',
        start: new Date('2027-03-14T00:00:00Z'),
        end: new Date('2027-03-14T23:59:59Z'),
        dependsOnNames: ['Book AV'],
      },
      { name: 'Hire a DJ', start: new Date('2027-02-01T00:00:00Z'), end: new Date('2027-02-01T23:59:59Z') },
    ]);
    await seedDemoPlan(db, demo.id);
    await seedDemoPlan(db, demo.id);
    const rows = PlanResponse.parse((await planOf(demo.id, 'alice')).body).tasks;
    const byName = new Map(rows.map((t) => [t.name, t]));

    expect(rows).toHaveLength(DEMO_TASKS.length + 1);
    expect(byName.get('Book AV')).toMatchObject({ id: old[0]?.id, kind: 'payment', workstream: 'av' });
    expect(byName.get('Hire a DJ')).toMatchObject({ kind: 'task', workstream: null });
    const eventDay = byName.get('Event day');
    expect(eventDay).toMatchObject({ id: old[1]?.id, kind: 'milestone', workstream: 'venue' });
    expect(eventDay?.dependsOn).toEqual([
      old[0]?.id,
      byName.get('Final rehearsal')?.id,
      byName.get('Speaker travel')?.id,
    ]);
  });

  it('keeps the task kinds and workstreams in step with @leonid/shared', () => {
    expect([...TASK_KINDS]).toEqual(TaskKind.options);
    expect([...WORKSTREAMS]).toEqual(Workstream.options);
  });
});

describe('PUT /api/events/:id/max-spend', () => {
  const create = async () =>
    EventSummary.parse(
      (await request(app(() => db)).post('/api/events').set(treasurer).send(spring).expect(201)).body,
    );

  it('sets, shows and clears the maximum spend, and audits each change', async () => {
    const { id } = await create();
    const set = await request(app(() => db))
      .put(`/api/events/${id}/max-spend`)
      .set(treasurer)
      .send({ maxSpend: 500_000 });
    expect(set.status).toBe(200);
    expect(EventSummary.parse(set.body).maxSpend).toBe(500_000);

    const listed = EventsResponse.parse(
      (await request(app(() => db)).get('/api/events').set(treasurer)).body,
    ).events.find((e) => e.id === id);
    expect(listed?.maxSpend).toBe(500_000);

    const cleared = await request(app(() => db))
      .put(`/api/events/${id}/max-spend`)
      .set(treasurer)
      .send({ maxSpend: null });
    expect(EventSummary.parse(cleared.body).maxSpend ?? null).toBeNull();
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'event.max_spend'));
    expect(audits).toHaveLength(2);
  });

  it('refuses a zero, negative or fractional amount', async () => {
    const { id } = await create();
    for (const maxSpend of [0, -5, 10.5, '100']) {
      const res = await request(app(() => db))
        .put(`/api/events/${id}/max-spend`)
        .set(treasurer)
        .send({ maxSpend });
      expect(res.status).toBe(422);
    }
  });

  it('is treasurer only and 404s an unknown event', async () => {
    const { id } = await create();
    expect(
      (await request(app(() => db)).put(`/api/events/${id}/max-spend`).send({ maxSpend: 1000 })).status,
    ).toBe(401);
    expect(
      (
        await request(app(() => db))
          .put('/api/events/00000000-0000-4000-8000-000000000000/max-spend')
          .set(treasurer)
          .send({ maxSpend: 1000 })
      ).status,
    ).toBe(404);
  });
});
