import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog } from '../db/schema.js';
import { createTestDb } from '../db/testing.js';
import type { Db } from '../db/client.js';
import { workflowsRouter, type WorkflowRunner } from './workflows.js';

const treasurer = { 'x-treasurer-token': 'letmein' };
const env = { TREASURER_TOKEN: 'letmein' };

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

function build(runner?: Partial<WorkflowRunner>, options: { env?: NodeJS.ProcessEnv; db?: () => Db } = {}) {
  const full: WorkflowRunner = {
    start: vi.fn(async () => ({ runId: 'trn-1' })),
    status: vi.fn(async () => ({ status: 'succeeded', results: [{ unlockedMinor: 1 }] })),
    ...runner,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRouter({ env: options.env ?? env, runner: runner === undefined && options.env ? undefined : () => full, db: options.db ?? (() => db) }));
  return { app, full };
}

describe('workflow demo controls', () => {
  it('are treasurer-only', async () => {
    const { app, full } = build();
    await request(app).post('/api/workflows/budget-recompute/run').expect(401);
    await request(app).get('/api/workflows/runs/trn-1').expect(401);
    expect(full.start).not.toHaveBeenCalled();
  });

  it('answer 503 when Render is not configured on this server', async () => {
    const { app } = build(undefined, { env });
    await request(app).post('/api/workflows/budget-recompute/run').set(treasurer).expect(503);
    await request(app).get('/api/workflows/runs/trn-1').set(treasurer).expect(503);
  });

  it('start a known workflow, answer with the run id and audit who started it', async () => {
    const { app, full } = build();
    const res = await request(app).post('/api/workflows/budget-recompute/run').set(treasurer).expect(202);
    expect(res.body).toEqual({ runId: 'trn-1' });
    expect(full.start).toHaveBeenCalledWith('budget-recompute');
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'workflow.trigger'));
    expect(row).toMatchObject({ actor: 'treasurer:ops-token', input: { workflow: 'budget-recompute', runId: 'trn-1' } });
  });

  it('refuse a name that is not one of our workflows, without calling Render', async () => {
    const { app, full } = build();
    for (const name of ['nope', '__proto__', 'constructor']) {
      await request(app).post(`/api/workflows/${name}/run`).set(treasurer).expect(404);
    }
    expect(full.start).not.toHaveBeenCalled();
  });

  it('still hand over the run id when the audit row cannot be written, and answer 502 when Render fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const broken = build(undefined, { db: () => { throw new Error('no database'); } });
      const res = await request(broken.app).post('/api/workflows/budget-recompute/run').set(treasurer).expect(202);
      expect(res.body).toEqual({ runId: 'trn-1' });

      const down = build({ start: async () => { throw new Error('Render is down'); } });
      await request(down.app).post('/api/workflows/budget-recompute/run').set(treasurer).expect(502);
    } finally {
      error.mockRestore();
    }
  });

  it('report how a run is going', async () => {
    const { app, full } = build();
    const res = await request(app).get('/api/workflows/runs/trn-1').set(treasurer).expect(200);
    expect(res.body).toEqual({ status: 'succeeded', results: [{ unlockedMinor: 1 }] });
    expect(full.status).toHaveBeenCalledWith('trn-1');
  });
});
