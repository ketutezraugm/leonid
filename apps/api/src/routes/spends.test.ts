import { SpendsResponse } from '@quartermaster/shared';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { createTestDb } from '../db/testing.js';
import { createDbAudit } from '../payments/db.js';
import { spendsRouter } from './spends.js';

const env = { TREASURER_TOKEN: 'letmein' };
const treasurer = { 'x-treasurer-token': 'letmein' };

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const app = (getDb: () => Db) => {
  const a = express();
  a.use('/api/spends', spendsRouter({ env, db: getDb }));
  return a;
};

describe('GET /api/spends/recent', () => {
  it('is treasurer only', async () => {
    expect((await request(app(() => db)).get('/api/spends/recent')).status).toBe(401);
    expect((await request(app(() => db)).get('/api/spends/recent').set('x-treasurer-token', 'nope')).status).toBe(401);
  });

  it('returns the shared shape, newest first, and honours limit', async () => {
    const audit = createDbAudit(db);
    for (const amountMinor of [1_000, 2_000, 3_000]) {
      const id = await audit.record({
        actor: 'agent',
        action: 'spend.check',
        input: { referenceId: `r${amountMinor}`, amountMinor, currency: 'USD', actor: 'agent', reason: 'x' },
        reason: 'x',
        ruleResult: { decision: 'allow', reasons: ['ok'], ruleIds: ['r'] },
      });
      await audit.update(id, { outcome: 'paid', paypalId: `CAP-${amountMinor}` });
    }
    const res = await request(app(() => db)).get('/api/spends/recent?limit=2').set(treasurer);
    expect(res.status).toBe(200);
    const body = SpendsResponse.parse(res.body);
    expect(body.spends.map((s) => s.amountMinor)).toEqual([3_000, 2_000]);
    expect(body.spends[0]).toMatchObject({ status: 'paid', paypalId: 'CAP-3000', decision: 'allow' });
  });

  it('refuses a bad limit or eventId, answers 503 without a database, and 500 when the query fails', async () => {
    for (const q of ['limit=0', 'limit=51', 'limit=abc', 'eventId=not-a-uuid']) {
      expect((await request(app(() => db)).get(`/api/spends/recent?${q}`).set(treasurer)).status).toBe(422);
    }
    const noDb = () => {
      throw new Error('no url');
    };
    expect((await request(app(noDb)).get('/api/spends/recent').set(treasurer)).status).toBe(503);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      select: () => {
        throw new Error('boom');
      },
    } as unknown as Db;
    const res = await request(app(() => broken)).get('/api/spends/recent').set(treasurer);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('boom');
  });
});
