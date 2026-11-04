import { EventsResponse, EventSummary } from '@quartermaster/shared';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
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
});
