import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { recordLedgerEntry } from '../db/ledger.js';
import { auditLog, sponsors } from '../db/schema.js';
import { PayPalApiError } from '../paypal/errors.js';
import type { PayPalClient } from '../paypal/client.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import type { Db } from '../db/client.js';
import { jobsRouter } from './jobs.js';

const TOKEN = 'j'.repeat(40);
const NOW = new Date('2026-11-04T12:00:00Z');
const job = { 'x-job-token': TOKEN };

let db: Db;
let eventId: string;
beforeEach(async () => {
  db = await createTestDb();
  eventId = (await seedDemoEvent(db)).id;
});

const appWith = (env: NodeJS.ProcessEnv) => {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', jobsRouter({ env, db: () => db, now: () => NOW }));
  return app;
};

describe('job endpoints (called by the Render Workflow service)', () => {
  it('stay shut without a long JOBS_TOKEN, and refuse a wrong or missing one', async () => {
    for (const env of [{}, { JOBS_TOKEN: 'short' }]) {
      expect((await request(appWith(env)).get('/api/jobs/events')).status).toBe(503);
    }
    const app = appWith({ JOBS_TOKEN: TOKEN });
    expect((await request(app).get('/api/jobs/events')).status).toBe(401);
    expect((await request(app).get('/api/jobs/events').set('x-job-token', 'x'.repeat(40))).status).toBe(401);
    expect((await request(app).post('/api/jobs/budget-recompute').send({ eventId })).status).toBe(401);
  });

  it('list the events for a task to fan out over', async () => {
    const res = await request(appWith({ JOBS_TOKEN: TOKEN })).get('/api/jobs/events').set(job).expect(200);
    expect(res.body).toEqual({ eventIds: [eventId] });
  });

  it('recompute the unlocked budget from the ledger, and write what they found to the audit log', async () => {
    await recordLedgerEntry(db, { eventId, direction: 'in', amount: 300_000, currency: 'USD', source: 'sponsor_invoice', paypalId: 'PAY-1' });
    const res = await request(appWith({ JOBS_TOKEN: TOKEN })).post('/api/jobs/budget-recompute').set(job).send({ eventId }).expect(200);
    expect(res.body).toEqual({
      eventId,
      currency: 'USD',
      clearedIncomeMinor: 300_000,
      committedMinor: 0,
      unlockedMinor: 300_000,
      asOf: NOW.toISOString(),
    });
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'workflow.budget_recompute'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'workflow:budget-recompute', input: res.body });
  });

  it('answer 422 to a body without an event id and 404 to an event that does not exist, writing nothing', async () => {
    const app = appWith({ JOBS_TOKEN: TOKEN });
    await request(app).post('/api/jobs/budget-recompute').set(job).send({}).expect(422);
    await request(app).post('/api/jobs/budget-recompute').set(job).send({ eventId: 'nope' }).expect(422);
    await request(app).post('/api/jobs/budget-recompute').set(job).send({ eventId: crypto.randomUUID() }).expect(404);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'workflow.budget_recompute'))).toHaveLength(0);
  });

  it('invoice reminders: need the job token, list invoiced sponsors, and answer 422 / 404 / 502 / outcome', async () => {
    const [sponsor] = await db.select().from(sponsors);
    await db.update(sponsors).set({ status: 'invoiced', paypalInvoiceId: 'INV2-TEST' }).where(eq(sponsors.id, sponsor!.id));
    let remindFails = false;
    const client = {
      request: async (req: { method: string; schema: { parse(v: unknown): unknown } }) => {
        if (req.method === 'GET') return req.schema.parse({ id: 'INV2-TEST', status: 'SENT', detail: {} });
        if (remindFails) throw new PayPalApiError({ status: 500, errorName: 'INTERNAL_SERVER_ERROR' });
        return undefined;
      },
    } as unknown as PayPalClient;
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter({ env: { JOBS_TOKEN: TOKEN }, db: () => db, now: () => NOW, client: () => client }));

    expect((await request(app).get('/api/jobs/unpaid-invoices')).status).toBe(401);
    expect((await request(app).post('/api/jobs/invoice-reminder').send({ sponsorId: sponsor!.id })).status).toBe(401);
    expect((await request(app).get('/api/jobs/unpaid-invoices').set(job).expect(200)).body).toEqual({ sponsorIds: [sponsor!.id] });
    await request(app).post('/api/jobs/invoice-reminder').set(job).send({ sponsorId: 'nope' }).expect(422);
    await request(app).post('/api/jobs/invoice-reminder').set(job).send({ sponsorId: crypto.randomUUID() }).expect(404);
    remindFails = true;
    await request(app).post('/api/jobs/invoice-reminder').set(job).send({ sponsorId: sponsor!.id }).expect(502);
    remindFails = false;
    const ok = await request(app).post('/api/jobs/invoice-reminder').set(job).send({ sponsorId: sponsor!.id }).expect(200);
    expect(ok.body).toEqual({ sponsorId: sponsor!.id, outcome: 'reminded' });
    expect((await request(app).post('/api/jobs/invoice-reminder').set(job).send({ sponsorId: sponsor!.id })).body.outcome).toBe('recent');
  });
});
