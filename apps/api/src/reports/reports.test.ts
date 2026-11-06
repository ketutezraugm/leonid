import { SponsorReportView } from '@quartermaster/shared';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { recordLedgerEntry } from '../db/ledger.js';
import { approvals, auditLog, sponsors } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import type { FoundTransaction } from '../paypal/search.js';
import { jobsRouter } from '../routes/jobs.js';
import { createRateLimiter } from '../routes/rateLimit.js';
import { reportsRouter } from '../routes/reports.js';
import { generateSponsorReport } from './generate.js';
import { getReportLink } from './store.js';

// The test rows get the database's real clock, so "now" must not be in the past: the PayPal search window runs from a
// day before the earliest purchase up to `now`, and a fixed date before the rows were written makes it empty.
const NOW = new Date();
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

describe('checking a report against PayPal\'s transaction records', () => {
  const found = (over: Partial<FoundTransaction>): FoundTransaction => ({ transactionId: 'PP-r1', referenceId: null, status: 'S', amountMinor: 14_000, currency: 'USD', ...over });

  it('marks each purchase confirmed or not found, and records when it checked', async () => {
    await paidSpend('r1', { amountMinor: 14_000 });
    await paidSpend('r2', { amountMinor: 20_000, vendor: 'Gold Prints' });
    const search = async () => [found({})]; // PayPal lists r1 only
    const { view } = (await generateSponsorReport(db, harbor, { now: NOW, search }))!;
    const byVendor = Object.fromEntries(view.spend.lines.map((l) => [l.vendor, l.paypalCheck]));
    expect(byVendor).toEqual({ 'Lanyard Co': 'confirmed', 'Gold Prints': 'not_found' });
    expect(view.spend.paypalCheckedAt).toBe(NOW.toISOString());
  });

  it('asks for a window that covers the purchases, once', async () => {
    await paidSpend('r1');
    const windows: { start: Date; end: Date }[] = [];
    await generateSponsorReport(db, harbor, { now: new Date(), search: async (w) => { windows.push(w); return []; } });
    expect(windows).toHaveLength(1);
    expect(windows[0]!.start.getTime()).toBeLessThan(Date.now());
  });

  it('still publishes the report, with no check on it, when PayPal\'s search fails, and logs only the kind of error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await paidSpend('r1');
    const search = async (): Promise<FoundTransaction[]> => { throw Object.assign(new Error('boom SECRET-detail-in-message'), { code: 'ECONNRESET' }); };
    const made = await generateSponsorReport(db, harbor, { now: NOW, search });
    expect(made!.view.spend.lines).toHaveLength(1);
    expect(made!.view.spend.lines[0]!.paypalCheck).toBeUndefined();
    expect(made!.view.spend.paypalCheckedAt).toBeUndefined();
    expect(await getReportLink(db, harbor)).toBeDefined(); // published all the same
    const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('ECONNRESET');
    expect(logged).not.toContain('SECRET-detail');
    spy.mockRestore();
  });

  it('does nothing when no search is configured, or there is nothing to look up', async () => {
    await paidSpend('r1');
    const none = (await generateSponsorReport(db, harbor, { now: NOW }))!.view;
    expect(none.spend.paypalCheckedAt).toBeUndefined();
    let called = false;
    await db.delete(auditLog); // no purchases: no search call
    await generateSponsorReport(db, harbor, { now: NOW, search: async () => { called = true; return []; } });
    expect(called).toBe(false);
  });

  it('shows the counts in the job answer, so a workflow run says what PayPal confirmed', async () => {
    await paidSpend('r1');
    await paidSpend('r2', { amountMinor: 20_000 });
    const a = express();
    a.use(express.json());
    a.use('/api/jobs', jobsRouter({ env: { JOBS_TOKEN: JOBS }, db: () => db, now: () => NOW, model: () => undefined, search: () => async () => [found({})] }));
    const res = await request(a).post('/api/jobs/sponsor-report').set(job).send({ sponsorId: harbor }).expect(200);
    expect(res.body.paypalCheck).toEqual({ confirmed: 1, differs: 0, notFound: 1 });
  });
});

describe('a purchase the treasurer approved', () => {
  // As the executor records it: the rules row sits under the ORDER id, the approval joins them, and the capture row carries the CAPTURE id.
  async function approvedSpend(referenceId: string, order: string, capture: { id: string; outcome: string } | null) {
    const spend = { referenceId, amountMinor: 42_000, currency: 'USD', category: 'prizes', vendor: 'Prize Co', eventId };
    await db.insert(auditLog).values({
      actor: 'agent', action: 'spend.check', input: spend, reason: 'x',
      ruleResult: JSON.stringify({ decision: 'needs_approval', reasons: ['over the limit'], ruleIds: [] }),
      outcome: 'needs_approval', paypalId: order,
    });
    await db.insert(approvals).values({ spend, eventId, status: 'paid', paypalOrderId: order });
    if (capture) await db.insert(auditLog).values({ actor: 'treasurer', action: 'spend.capture', input: spend, outcome: capture.outcome, paypalId: capture.id });
  }
  const tx = (id: string): FoundTransaction => ({ transactionId: id, referenceId: 'something-else', status: 'S', amountMinor: 42_000, currency: 'USD' });

  it('is shown and checked by its capture id, the id PayPal lists, not by its order id', async () => {
    await approvedSpend('a1', 'ORDER-A', { id: 'CAP-A', outcome: 'paid' });
    const { view } = (await generateSponsorReport(db, harbor, { now: NOW, search: async () => [tx('CAP-A')] }))!;
    expect(view.spend.lines).toHaveLength(1);
    expect(view.spend.lines[0]).toMatchObject({ paypalId: 'CAP-A', paypalCheck: 'confirmed' });
    expect(JSON.stringify(view)).not.toContain('ORDER-A');
  });

  it('keeps the order id, and is not confirmed, when no capture was recorded or the capture was refused', async () => {
    await approvedSpend('a2', 'ORDER-B', null);
    await approvedSpend('a3', 'ORDER-C', { id: 'CAP-C', outcome: 'refused' });
    const { view } = (await generateSponsorReport(db, harbor, { now: NOW, search: async () => [tx('CAP-B'), tx('CAP-C')] }))!;
    expect(view.spend.lines.map((l) => [l.paypalId, l.paypalCheck]).sort()).toEqual([['ORDER-B', 'not_found'], ['ORDER-C', 'not_found']]);
  });

  it('leaves a spend paid straight from the wallet on its own id, which already is the capture id', async () => {
    await paidSpend('auto', { amountMinor: 14_000 });
    const { view } = (await generateSponsorReport(db, harbor, { now: NOW, search: async () => [{ transactionId: 'PP-auto', referenceId: 'B-agreement', status: 'S', amountMinor: 14_000, currency: 'USD' }] }))!;
    expect(view.spend.lines[0]).toMatchObject({ paypalId: 'PP-auto', paypalCheck: 'confirmed' });
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
    a.use('/api/jobs', jobsRouter({ env: { JOBS_TOKEN: JOBS }, db: () => db, now: () => NOW, model: () => undefined, search: () => undefined }));
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
    expect(res.body).toEqual({ sponsorId: harbor, purchases: 1, summary: 'template', paypalCheck: null });
    const { shareToken } = (await getReportLink(db, harbor))!;
    expect(JSON.stringify(res.body)).not.toContain(shareToken);
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'workflow.sponsor_report'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'workflow:sponsor-reports' });
    expect(JSON.stringify(rows[0])).not.toContain(shareToken);
  });
});
