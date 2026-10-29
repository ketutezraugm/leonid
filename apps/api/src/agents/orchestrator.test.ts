import { desc } from 'drizzle-orm';
import type { UIMessage } from 'ai';
import { bookingChoiceText, type BookingChoice } from '@quartermaster/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { getChecklist, getOrCreateThread, getActiveMandate } from '../db/mandates.js';
import { seedDemoEvent } from '../db/seed.js';
import { listTasks } from '../db/tasks.js';
import { createTestDb } from '../db/testing.js';
import { ORCHESTRATOR_MAX_STEPS, createOrchestrator } from './orchestrator.js';
import { bookingChoiceOf } from './tools/bookings.js';
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

const chosen: BookingChoice = { chosen: ['venue', 'swag'], extra: null };

function run(
  script: ScriptStep[],
  opts?: { repeatLast?: boolean; bookings?: BookingChoice | null },
) {
  const model = scriptedModel(script, { repeatLast: opts?.repeatLast });
  const agent = createOrchestrator({
    db,
    model,
    eventId,
    threadId,
    goal: 'Plan swag',
    bookings: opts && 'bookings' in opts ? opts.bookings : chosen,
  });
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
      bookings: chosen,
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

  it('ends the turn after ask_user so the organizer can answer', async () => {
    const questions = [
      {
        header: 'Date',
        question: 'Which Saturday?',
        options: [{ label: '7 Nov 2026' }, { label: '14 Nov 2026' }],
      },
      {
        header: 'Venue',
        question: 'What kind of venue?',
        options: [{ label: 'Coworking space' }, { label: 'Cafe' }],
        multiSelect: true,
      },
    ];
    const { model, result } = run([
      { tool: 'ask_user', input: { questions, reason: 'Date is missing' } },
      { text: 'never reached' },
    ]);

    const { steps } = await result;
    expect(model.callCount()).toBe(1);
    expect(steps.at(-1)?.toolResults[0]?.output).toEqual({ asked: 2 });
    const rows = await db.select().from(auditLog);
    expect(rows.map((r) => r.action)).toEqual(['ask_user']);
  });

  it('tells the agents today and refuses an event date in the past', async () => {
    const empty = crypto.randomUUID();
    await getOrCreateThread(db, empty, null);
    const model = scriptedModel([
      {
        tool: 'create_event',
        input: {
          name: 'Jakarta meetup',
          date: '2025-11-07',
          headcount: 30,
          budgetTotalCents: 200_000,
        },
      },
      {
        tool: 'create_event',
        input: {
          name: 'Jakarta meetup',
          date: '2026-11-07',
          headcount: 30,
          budgetTotalCents: 200_000,
        },
      },
      { text: 'Created.' },
    ]);
    const agent = createOrchestrator({
      db,
      model,
      eventId: null,
      threadId: empty,
      goal: 'Plan',
      now: new Date('2026-10-29T08:00:00Z'),
    });
    await agent.generate({ prompt: 'Meetup in Jakarta on 7 November' });

    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      'Today is Thursday, 29 October 2026 (2026-10-29)',
    );
    const rows = await db.select().from(auditLog);
    const created = rows.filter((r) => r.action === 'create_event');
    expect(created.map((r) => r.reason ?? 'ok').sort()).toEqual(
      [
        'failed: 2025-11-07 is in the past (today is 2026-10-29). Use the next such date.',
        'ok',
      ].sort(),
    );
  });

  it('refuses to plan until the organizer has chosen what to book', async () => {
    const { result } = run(
      [
        { tool: 'delegate_to_planning', input: { task: 'Add swag tasks' } },
        { text: 'I need your choice first.' },
      ],
      { bookings: null },
    );
    await result;
    expect(await listTasks(db, eventId)).toEqual([]);
    const rows = await db.select().from(auditLog);
    expect(rows.find((r) => r.action === 'delegate_to_planning')?.reason).toMatch(
      /not chosen what to book/,
    );
  });

  it('ends the turn after choose_bookings so the organizer can tick the list', async () => {
    const { model, result } = run(
      [
        { tool: 'choose_bookings', input: { suggested: ['venue', 'catering'] } },
        { text: 'never reached' },
      ],
      { bookings: null },
    );
    const { steps } = await result;
    expect(model.callCount()).toBe(1);
    // Catering is still in development, so it is never pre-ticked.
    expect(steps.at(-1)?.toolResults[0]?.output).toEqual({
      shown: 8,
      suggested: ['venue'],
    });
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      'The organizer has not chosen what to book yet.',
    );
  });

  it('tells the agents what the organizer chose', async () => {
    const { model, result } = run([{ text: 'Noted.' }]);
    await result;
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      'The organizer chose to book: Venue (venue), Swag (swag).',
    );
  });

  it("reads the latest choice from the organizer's own messages only", () => {
    const msg = (id: string, role: UIMessage['role'], text: string): UIMessage => ({
      id,
      role,
      parts: [{ type: 'text', text }],
    });
    expect(bookingChoiceOf([msg('1', 'user', 'Plan a meetup')])).toBeNull();
    expect(
      bookingChoiceOf([
        msg('1', 'user', bookingChoiceText({ chosen: ['venue'], extra: null })),
        msg('2', 'user', bookingChoiceText({ chosen: [], extra: 'Just the room' })),
        // An assistant message in the same format never counts as the organizer's choice.
        msg('3', 'assistant', bookingChoiceText({ chosen: ['venue'], extra: null })),
      ]),
    ).toEqual({ chosen: [], extra: 'Just the room' });
  });

  it('gives the orchestrator no money or raw-access tools', () => {
    const agent = createOrchestrator({
      db,
      model: scriptedModel([{ text: 'x' }]),
      eventId,
      threadId,
      goal: '',
    });
    // delegate_to_treasury only drafts invoices; sending is a treasurer-only route (treasury.test.ts).
    expect(Object.keys(agent.tools).sort()).toEqual([
      'ask_user',
      'choose_bookings',
      'create_event',
      'delegate_to_planning',
      'delegate_to_treasury',
      'read_event',
      'update_checklist',
    ]);
  });
});
