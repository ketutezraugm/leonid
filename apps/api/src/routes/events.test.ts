import { CreateEventResponse, EventOverview, EventsResponse } from '@quartermaster/shared';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { recordLedgerEntry } from '../db/ledger.js';
import { auditLog } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTasks } from '../db/tasks.js';
import { createTestDb } from '../db/testing.js';
import { sign, SESSION_COOKIE } from '../auth/session.js';
import { createRateLimiter } from './rateLimit.js';
import { eventsRouter, type EventsRouterOptions } from './events.js';

const env = { TREASURER_TOKEN: 'letmein' };
const treasurer = { 'x-treasurer-token': 'letmein' };
const sessionEnv = { SESSION_SECRET: 's'.repeat(40), APP_BASE_URL: 'http://localhost:5173' };
// A demo login: its own cookie and sub. State-changing requests must come from our own origin.
const asDemo = (sub: string) => ({
  Cookie: `${SESSION_COOKIE}=${sign('session', { sub, via: 'demo' }, sessionEnv.SESSION_SECRET, 3600)}`,
  Origin: sessionEnv.APP_BASE_URL,
});
const NOW = new Date('2026-11-02T10:00:00Z');
const valid = { name: 'Test Meetup', date: '2027-05-01', endDate: '2027-05-03', people: 80, currency: 'USD', budget: 250_000, categories: ['Venue', 'venue', 'Swag'] };

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const app = (getDb: () => Db = () => db, extra: EventsRouterOptions = {}) => {
  const a = express();
  a.use(express.json());
  a.use('/api/events', eventsRouter({ env, db: getDb, now: () => NOW, ...extra }));
  return a;
};

describe('GET /api/events', () => {
  it('is treasurer only', async () => {
    expect((await request(app()).get('/api/events')).status).toBe(401);
  });

  it('lists the events this person made, and not the demo event or anyone else\'s', async () => {
    await seedDemoEvent(db);
    const mine = await request(app()).post('/api/events').set(treasurer).send(valid);
    expect(mine.status).toBe(201);

    const res = await request(app()).get('/api/events').set(treasurer);
    expect(res.status).toBe(200);
    const body = EventsResponse.parse(res.body);
    expect(body.events.map((e) => e.name)).toEqual(['Test Meetup']);
  });

  it('answers 503 without a database and 500 without leaking the cause', async () => {
    const noDb = await request(
      app(() => {
        throw new Error('no db');
      }),
    )
      .get('/api/events')
      .set(treasurer);
    expect(noDb.status).toBe(503);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      select: () => {
        throw new Error('secret connection string');
      },
    } as unknown as Db;
    const res = await request(app(() => broken)).get('/api/events').set(treasurer);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    spy.mockRestore();
  });
});

describe('events per login', () => {
  it('shows each demo login only its own events', async () => {
    const sessions = () => {
      const x = express();
      x.use(express.json());
      x.use('/api/events', eventsRouter({ env: sessionEnv, db: () => db, now: () => NOW }));
      return x;
    };
    expect((await request(sessions()).post('/api/events').set(asDemo('demo:a')).send(valid)).status).toBe(201);
    await request(sessions()).post('/api/events').set(asDemo('demo:b')).send({ ...valid, name: 'Other Meetup' });

    const seenByA = EventsResponse.parse((await request(sessions()).get('/api/events').set(asDemo('demo:a'))).body);
    const seenByB = EventsResponse.parse((await request(sessions()).get('/api/events').set(asDemo('demo:b'))).body);
    expect(seenByA.events.map((e) => e.name)).toEqual(['Test Meetup']);
    expect(seenByB.events.map((e) => e.name)).toEqual(['Other Meetup']);

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'event.create'));
    expect(rows.map((r) => r.actor)).toEqual(['treasurer:demo', 'treasurer:demo']);
  });

  it('refuses a cross-origin create from a session', async () => {
    const x = express();
    x.use(express.json());
    x.use('/api/events', eventsRouter({ env: sessionEnv, db: () => db, now: () => NOW }));
    const res = await request(x).post('/api/events').set({ ...asDemo('demo:a'), Origin: 'https://evil.example' }).send(valid);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/events', () => {
  it('creates the event, stamps the owner, dedupes categories and audits it', async () => {
    const res = await request(app()).post('/api/events').set(treasurer).send(valid);
    expect(res.status).toBe(201);
    const { event } = CreateEventResponse.parse(res.body);
    expect(event).toMatchObject({
      name: 'Test Meetup',
      date: '2027-05-01',
      endDate: '2027-05-03',
      people: 80,
      budget: 250_000,
      categories: ['venue', 'swag'],
    });

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'event.create'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'treasurer:ops-token', input: { eventId: event.id, ownerSub: 'ops-token' } });
  });

  it('refuses a bad body, a past date, and the demo name', async () => {
    for (const body of [{}, { ...valid, people: 0 }, { ...valid, budget: 12.5 }, { ...valid, name: ' ' }]) {
      expect((await request(app()).post('/api/events').set(treasurer).send(body)).status).toBe(422);
    }
    const backwards = await request(app()).post('/api/events').set(treasurer).send({ ...valid, endDate: '2027-04-30' });
    expect(backwards.status).toBe(422);
    const past = await request(app()).post('/api/events').set(treasurer).send({ ...valid, date: '2026-11-01' });
    expect(past.status).toBe(422);
    expect(past.body.error).toMatch(/past/);
    // Today is fine.
    expect((await request(app()).post('/api/events').set(treasurer).send({ ...valid, date: '2026-11-02' })).status).toBe(201);

    const demo = await request(app()).post('/api/events').set(treasurer).send({ ...valid, name: 'openhack 2027' });
    expect(demo.status).toBe(422);
    expect(demo.body.error).toMatch(/demo event/);
  });

  it('limits one person, and everyone together', async () => {
    const limited = app(() => db, { perOwnerLimiter: createRateLimiter({ max: 1, windowMs: 60_000 }) });
    expect((await request(limited).post('/api/events').set(treasurer).send(valid)).status).toBe(201);
    expect((await request(limited).post('/api/events').set(treasurer).send(valid)).status).toBe(429);

    const crowded = app(() => db, { globalLimiter: createRateLimiter({ max: 1, windowMs: 60_000 }) });
    expect((await request(crowded).post('/api/events').set(treasurer).send(valid)).status).toBe(201);
    expect((await request(crowded).post('/api/events').set(treasurer).send(valid)).status).toBe(429);
  });

  it('answers 503 without a database', async () => {
    const res = await request(
      app(() => {
        throw new Error('no db');
      }),
    )
      .post('/api/events')
      .set(treasurer)
      .send(valid);
    expect(res.status).toBe(503);
  });
});

describe('GET /api/events/:eventId/overview', () => {
  it('is 404 for an unknown or malformed id', async () => {
    expect((await request(app()).get('/api/events/nope/overview').set(treasurer)).status).toBe(404);
    expect((await request(app()).get(`/api/events/${crypto.randomUUID()}/overview`).set(treasurer)).status).toBe(404);
  });

  it('has nothing unlocked until income clears, and lists the plan tasks', async () => {
    const created = await request(app()).post('/api/events').set(treasurer).send(valid);
    const id = CreateEventResponse.parse(created.body).event.id;
    await createTasks(db, id, [{ name: 'Book venue', start: new Date('2027-03-01T00:00:00Z'), end: new Date('2027-03-05T00:00:00Z') }]);

    const first = EventOverview.parse((await request(app()).get(`/api/events/${id}/overview`).set(treasurer)).body);
    expect(first.unlockedMinor).toBe(0);
    expect(first.tasks).toMatchObject([{ name: 'Book venue', start: '2027-03-01', end: '2027-03-05', deadline: null }]);

    await recordLedgerEntry(db, { eventId: id, direction: 'in', amount: 90_000, currency: 'USD', source: 'donation', paypalId: 'CAP-9' });
    const second = EventOverview.parse((await request(app()).get(`/api/events/${id}/overview`).set(treasurer)).body);
    expect(second.unlockedMinor).toBe(90_000);
  });
});
