import { desc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { getChecklist, getOrCreateThread, getActiveMandate } from '../db/mandates.js';
import { seedDemoEvent } from '../db/seed.js';
import { listTasks } from '../db/tasks.js';
import { createTestDb } from '../db/testing.js';
import { ORCHESTRATOR_MAX_STEPS, createOrchestrator } from './orchestrator.js';
import { scriptedModel, type ScriptStep } from './testing.js';

let db: Db;
let eventId: string;
let threadId: string;

beforeEach(async () => {
  db = await createTestDb();
  eventId = (await seedDemoEvent(db)).id;
  threadId = crypto.randomUUID();
  await getOrCreateThread(db, threadId, eventId);
});

function run(script: ScriptStep[], opts?: { repeatLast?: boolean }) {
  const model = scriptedModel(script, opts);
  const agent = createOrchestrator({ db, model, eventId, threadId, goal: 'Plan swag' });
  return { model, result: agent.generate({ prompt: 'Plan swag for OpenHack' }) };
}

describe('orchestrator', () => {
  it('writes a checklist, delegates to the planning agent, and finishes', async () => {
    const { result } = run([
      // orchestrator
      {
        tool: 'update_checklist',
        input: {
          items: [{ title: 'Plan swag', status: 'in_progress' }],
          reason: 'Multi-step goal',
        },
      },
      { tool: 'delegate_to_planning', input: { task: 'Add swag tasks', reason: 'Plan work' } },
      // planning subagent (shares the script)
      {
        tool: 'create_tasks',
        input: {
          tasks: [
            { name: 'Order swag', start: '2027-01-05', end: '2027-02-15', deadline: '2027-02-20' },
          ],
          reason: 'Swag has a long lead time',
        },
      },
      { text: 'Added the swag order task.' },
      // orchestrator resumes
      {
        tool: 'update_checklist',
        input: { items: [{ title: 'Plan swag', status: 'done' }] },
      },
      { text: 'Swag is on the plan.' },
    ]);

    expect((await result).text).toBe('Swag is on the plan.');
    expect((await listTasks(db, eventId)).map((t) => t.name)).toEqual(['Order swag']);
    expect(await getChecklist(db, threadId)).toEqual([{ title: 'Plan swag', status: 'done' }]);
    expect((await getActiveMandate(db, threadId))?.status).toBe('done');

    const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt));
    const actions = rows.map((r) => `${r.actor}:${r.action}`).sort();
    expect(actions).toEqual(
      [
        'orchestrator:update_checklist',
        'orchestrator:delegate_to_planning',
        'planning:create_tasks',
        'orchestrator:update_checklist',
      ].sort(),
    );
    expect(rows.find((r) => r.action === 'create_tasks')?.reason).toBe('Swag has a long lead time');
  });

  it('marks the mandate waiting when an item is blocked', async () => {
    const { result } = run([
      {
        tool: 'update_checklist',
        input: {
          items: [
            { title: 'Draft invoices', status: 'blocked', blockedOn: 'Invoicing is not connected' },
          ],
        },
      },
      { text: 'Invoicing is not connected yet.' },
    ]);
    await result;
    expect((await getActiveMandate(db, threadId))?.status).toBe('waiting');
  });

  it('feeds tool failures back to the model and audits them', async () => {
    const { result } = run([
      {
        tool: 'delegate_to_planning',
        input: { task: 'Gate swag on a sponsor' },
      },
      // planning: unknown sponsor makes the tool throw
      { tool: 'link_task_to_invoice', input: { taskName: 'Nope', sponsorName: 'Nobody' } },
      { text: 'That sponsor does not exist.' },
      { text: 'Could not gate the task.' },
    ]);
    expect((await result).text).toBe('Could not gate the task.');
    const rows = await db.select().from(auditLog);
    expect(rows.find((r) => r.action === 'link_task_to_invoice')?.reason).toMatch(
      /^failed: Unknown sponsor/,
    );
  });

  it('refuses to plan tasks before the chat has an event', async () => {
    const empty = crypto.randomUUID();
    await getOrCreateThread(db, empty, null);
    const agent = createOrchestrator({
      db,
      model: scriptedModel([
        { tool: 'delegate_to_planning', input: { task: 'Add venue tasks' } },
        {
          tool: 'create_tasks',
          input: { tasks: [{ name: 'Book venue', start: '2027-01-04', end: '2027-01-10' }] },
        },
        { text: 'I need the event first.' },
        { text: 'Tell me the date, headcount and budget.' },
      ]),
      eventId: null,
      threadId: empty,
      goal: 'Plan',
    });
    await agent.generate({ prompt: 'Plan a venue' });
    expect(await listTasks(db, eventId)).toEqual([]);
    const rows = await db.select().from(auditLog);
    expect(rows.find((r) => r.action === 'create_tasks')?.reason).toMatch(/no event yet/);
  });

  it('stops at the step cap even if the model never stops calling tools', async () => {
    const { model, result } = run([{ tool: 'read_event', input: {} }], { repeatLast: true });
    await result;
    expect(model.callCount()).toBe(ORCHESTRATOR_MAX_STEPS);
  });

  it('gives the orchestrator no money or raw-access tools', () => {
    const agent = createOrchestrator({
      db,
      model: scriptedModel([{ text: 'x' }]),
      eventId,
      threadId,
      goal: '',
    });
    expect(Object.keys(agent.tools).sort()).toEqual([
      'create_event',
      'delegate_to_planning',
      'read_event',
      'update_checklist',
    ]);
  });
});
