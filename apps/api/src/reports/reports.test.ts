import { SponsorReportView } from '@quartermaster/shared';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { recordLedgerEntry } from '../db/ledger.js';
import { auditLog, sponsors } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { jobsRouter } from '../routes/jobs.js';
import { createRateLimiter } from '../routes/rateLimit.js';
import { reportsRouter } from '../routes/reports.js';
import { generateSponsorReport } from './generate.js';
import { getReportLink } from './store.js';

const NOW = new Date('2026-11-05T12:00:00Z');
const JOBS = 'j'.repeat(40);
const job = { 'x-job-token': JOBS };
const treasurer = { 'x-treasurer-token': 'letmein' };

let db: Db;
let eventId: string;
let harbor: string; // gold, $3,000 cleared
let lumen: string; // silver, $1,000 cleared

// An executed spend, as the executor records it: a spend.check row with the rule result and the outcome.
async function paidSpend(referenceId: string, over: Record<string, unknown> = {}) {
  const input = { referenceId, amountMinor: 14_000, currency: 'USD', category: 'swag', vendor: 'Lanyard Co', eventId, ...over };
  await db.insert(auditLog).values({
    actor: 'agent',
    action: 'spend.check',
    input,
    reason: 'agent reasoning that must never reach a sponsor',
    ruleResult: JSON.stringify({ decision: 'allow', reasons: [], ruleIds: [] }),
    outcome: 'paid',
    paypalId: `PP-${referenceId}`,
  });
}

beforeEach(async () => {
  db = await createTestDb();
  eventId = (await seedDemoEvent(db)).id;
  const rows = await db.select().from(sponsors);
  harbor = rows.find((s) => s.name === 'Harbor Cloud')!.id;
  lumen = rows.find((s) => s.name === 'Lumen Labs')!.id;
  await db.update(sponsors).set({ status: 'paid' }).where(eq(sponsors.id, harbor));
  await recordLedgerEntry(db, { eventId, direction: 'in', amount: 300_000, currency: 'USD', source: 'sponsor_invoice', paypalId: 'INV-H', sponsorId: harbor });
  await recordLedgerEntry(db, { eventId, direction: 'in', amount: 100_000, currency: 'USD', source: 'sponsor_invoice', paypalId: 'INV-L', sponsorId: lumen });
  await recordLedgerEntry(db, { eventId, direction: 'in', amount: 100_000, currency: 'USD', source: 'ticket', paypalId: 'CAP-T' });
});

describe('generateSponsorReport', () => {
  it('builds the report from the ledger and the executor records, and keeps the agent reasoning out of it', async () => {
    await paidSpend('r1', { amountMinor: 140_000 });
    await paidSpend('r2', { amountMinor: 20_000, vendor: 'Gold Prints', category: 'printing', fundedBySponsorId: harbor });
    await paidSpend('blocked-one'); // same shape but...
    await db.update(auditLog).set({ outcome: 'blocked' }).where(eq(auditLog.paypalId, 'PP-blocked-one'));
    const made = await generateSponsorReport(db, harbor, { now: NOW });
    const v = made!.view;
    expect(() => SponsorReportView.parse(v)).not.toThrow();
    expect(v.funds).toEqual({ pledgedMinor: 300_000, clearedMinor: 300_000, status: 'paid' });
    // $1,400 shared, split 3000 : 1000 : 1000 -> 60% = $840; plus $200 funded by Harbor alone
    expect(v.spend).toMatchObject({ directMinor: 20_000, sharedMinor: 84_000, totalMinor: 104_000 });
    // Two inserts in one millisecond tie on time, so compare the lines by vendor, not by position.
    const lines = v.spend.lines.map((l) => [l.vendor, l.attributedMinor, l.basis, l.paypalId]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(lines).toEqual([
      ['Gold Prints', 20_000, 'direct', 'PP-r2'],
      ['Lanyard Co', 84_000, 'shared', 'PP-r1'],
    ]);
    expect(v.narrative.source).toBe('template');
    expect(JSON.stringify(v)).not.toContain('agent reasoning');
  });

  it('returns nothing for an unknown sponsor', async () => {
    expect(await generateSponsorReport(db, crypto.randomUUID(), { now: NOW })).toBeUndefined();
  });

  it('keeps the same share link when the report is regenerated, and updates the content', async () => {
    await generateSponsorReport(db, harbor, { now: NOW });
    const first = await getReportLink(db, harbor);
    await paidSpend('late', { amountMinor: 50_000 });
    const made = await generateSponsorReport(db, harbor, { now: new Date('2026-11-06T00:00:00Z') });
    const second = await getReportLink(db, harbor);
    expect(second?.shareToken).toBe(first?.shareToken);
    expect(first?.shareToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(made!.view.spend.lines).toHaveLength(1);
  });
});

describe('the public report route', () => {
  const app = (limiter = createRateLimiter({ max: 100, windowMs: 60_000 })) => {
    const a = express();
    a.use(express.json());
    a.use('/api/reports', reportsRouter({ env: { TREASURER_TOKEN: 'letmein' }, db: () => db, limiter }));
    return a;
  };

  it('serves a published report to anyone with the link, without caching or indexing it', async () => {
    await paidSpend('r1');
    await generateSponsorReport(db, harbor, { now: NOW });
    const { shareToken } = (await getReportLink(db, harbor))!;
    const res = await request(app()).get(`/api/reports/${shareToken}`).expect(200);
    expect(res.body.sponsor).toEqual({ name: 'Harbor Cloud', tier: 'gold' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('says not found for an unknown or malformed token, and rate-limits guessing', async () => {
    await request(app()).get('/api/reports/short').expect(404);
    await request(app()).get(`/api/reports/${'a'.repeat(32)}`).expect(404);
    const limited = app(createRateLimiter({ max: 2, windowMs: 60_000 }));
    await request(limited).get('/api/reports/short').expect(404);
    await request(limited).get('/api/reports/short').expect(404);
    await request(limited).get('/api/reports/short').expect(429);
  });

  it('gives the treasurer, and only the treasurer, the link to send', async () => {
    const a = app();
    await request(a).get(`/api/reports/link/${harbor}`).expect(401);
    await request(a).get(`/api/reports/link/${harbor}`).set(treasurer).expect(404); // nothing published yet
    await request(a).get('/api/reports/link/not-a-uuid').set(treasurer).expect(400);
    await generateSponsorReport(db, harbor, { now: NOW });
    const res = await request(a).get(`/api/reports/link/${harbor}`).set(treasurer).expect(200);
    expect(res.body.shareToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe('when the database fails', () => {
  // A failed query's message quotes its parameters, and for these routes a parameter is the share token.
  const TOKEN = 'SECRET-share-token-0123456789abcdef';
  const failing = () => {
    const err = Object.assign(new Error(`Failed query: select ... where share_token = $1\nparams: ${TOKEN}`), { cause: { code: '57P01' } });
    return { select: () => { throw err; }, insert: () => { throw err; } } as unknown as Db;
  };
  const logged = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => c.join(' ')).join('\n');

  it('the public report route logs what kind of error it was, never the token in the error message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = express();
    a.use('/api/reports', reportsRouter({ env: {}, db: failing, limiter: createRateLimiter({ max: 100, windowMs: 60_000 }) }));
    const res = await request(a).get(`/api/reports/${'a'.repeat(32)}`).expect(500);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(logged(spy)).toContain('57P01');
    expect(logged(spy)).not.toContain(TOKEN);
    spy.mockRestore();
  });

  it('the treasurer link route and the sponsor report job log the same way', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = express();
    a.use(express.json());
    a.use('/api/reports', reportsRouter({ env: { TREASURER_TOKEN: 'letmein' }, db: failing }));
    a.use('/api/jobs', jobsRouter({ env: { JOBS_TOKEN: JOBS }, db: failing, model: () => undefined }));
    await request(a).get(`/api/reports/link/${crypto.randomUUID()}`).set(treasurer).expect(500);
    await request(a).post('/api/jobs/sponsor-report').set(job).send({ sponsorId: crypto.randomUUID() }).expect(500);
    expect(logged(spy)).toContain('57P01');
    expect(logged(spy)).not.toContain(TOKEN);
    spy.mockRestore();
  });
});

describe('the sponsor report job endpoints', () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use('/api/jobs', jobsRouter({ env: { JOBS_TOKEN: JOBS }, db: () => db, now: () => NOW, model: () => undefined }));
    return a;
  };

  it('need the job token, list the sponsors that have paid, and 422 / 404 bad requests', async () => {
    await request(app()).get('/api/jobs/report-sponsors').expect(401);
    await request(app()).post('/api/jobs/sponsor-report').send({ sponsorId: harbor }).expect(401);
    expect((await request(app()).get('/api/jobs/report-sponsors').set(job).expect(200)).body).toEqual({ sponsorIds: [harbor] });
    await request(app()).post('/api/jobs/sponsor-report').set(job).send({ sponsorId: 'nope' }).expect(422);
    await request(app()).post('/api/jobs/sponsor-report').set(job).send({ sponsorId: crypto.randomUUID() }).expect(404);
  });

  it('publish the report, answer without the share link, and keep the link out of the audit log', async () => {
    await paidSpend('r1');
    const res = await request(app()).post('/api/jobs/sponsor-report').set(job).send({ sponsorId: harbor }).expect(200);
    expect(res.body).toEqual({ sponsorId: harbor, purchases: 1, summary: 'template' });
    const { shareToken } = (await getReportLink(db, harbor))!;
    expect(JSON.stringify(res.body)).not.toContain(shareToken);
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'workflow.sponsor_report'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'workflow:sponsor-reports' });
    expect(JSON.stringify(rows[0])).not.toContain(shareToken);
  });
});
