import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './client.js';
import { createEventForThread, getDemoEvent, getEvent, listSponsors } from './events.js';
import {
  getActiveMandate,
  getChecklist,
  getOrCreateThread,
  getThread,
  replaceChecklist,
} from './mandates.js';
import { seedDemoEvent } from './seed.js';
import { createTasks, linkTaskToSponsor, listTasks } from './tasks.js';
import { createTestDb } from './testing.js';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe('seed', () => {
  it('creates OpenHack 2027 with three sponsors, and is idempotent', async () => {
    const first = await seedDemoEvent(db);
    const second = await seedDemoEvent(db);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ headcount: 200, budgetTotal: 800_000, currency: 'USD' });
    expect(await listSponsors(db, first.id)).toHaveLength(3);
    expect((await getDemoEvent(db))?.id).toBe(first.id);
  });
});

describe('tasks', () => {
  it('resolves dependencies by name and gates a task on a sponsor', async () => {
    const event = await seedDemoEvent(db);
    const [venue, swag] = await createTasks(db, event.id, [
      { name: 'Venue deposit', start: new Date('2026-12-01'), end: new Date('2026-12-05') },
      {
        name: 'Order swag',
        start: new Date('2027-01-05'),
        end: new Date('2027-02-15'),
        dependsOnNames: ['Venue deposit'],
      },
    ]);
    expect(swag?.dependsOn).toEqual([venue?.id]);

    const linked = await linkTaskToSponsor(db, event.id, 'Order swag', 'Harbor Cloud');
    expect(linked.sponsor.status).toBe('pledged');
    expect(
      (await listTasks(db, event.id)).find((t) => t.name === 'Order swag')?.fundedBySponsorId,
    ).toBe(linked.sponsor.id);
  });

  it('rejects an unknown dependency', async () => {
    const event = await seedDemoEvent(db);
    await expect(
      createTasks(db, event.id, [
        {
          name: 'A',
          start: new Date('2027-01-01'),
          end: new Date('2027-01-02'),
          dependsOnNames: ['Nope'],
        },
      ]),
    ).rejects.toThrow('Unknown dependency');
  });
});

describe('mandates', () => {
  it('replaces the checklist and derives the mandate status', async () => {
    const event = await seedDemoEvent(db);
    const threadId = crypto.randomUUID();
    await getOrCreateThread(db, threadId, event.id);
    const args = { threadId, eventId: event.id, goal: 'Plan swag' };

    const blocked = await replaceChecklist(db, {
      ...args,
      items: [
        { title: 'Find lanyards', status: 'done' },
        { title: 'Pay', status: 'blocked', blockedOn: 'Sponsor invoice' },
      ],
    });
    expect(blocked.status).toBe('waiting');

    const done = await replaceChecklist(db, {
      ...args,
      items: [{ title: 'Find lanyards', status: 'done' }],
    });
    expect(done.mandateId).toBe(blocked.mandateId);
    expect(done.status).toBe('done');
    expect(await getChecklist(db, threadId)).toEqual([{ title: 'Find lanyards', status: 'done' }]);
  });
});

describe('chat events', () => {
  const meetup = {
    name: 'Jakarta meetup',
    date: new Date('2027-02-06T07:00:00Z'),
    headcount: 30,
    budgetTotal: 200_000,
    currency: 'USD',
  };

  it('starts a thread with no event, then binds the one it creates', async () => {
    const threadId = crypto.randomUUID();
    expect((await getOrCreateThread(db, threadId, null)).eventId).toBeNull();
    await replaceChecklist(db, {
      threadId,
      eventId: null,
      goal: 'Plan a meetup',
      items: [{ title: 'Pick a date', status: 'pending' }],
    });

    const event = await createEventForThread(db, threadId, meetup);

    expect((await getThread(db, threadId))?.eventId).toBe(event.id);
    expect((await getActiveMandate(db, threadId))?.eventId).toBe(event.id);
    expect(await getEvent(db, event.id)).toMatchObject({ name: 'Jakarta meetup', headcount: 30 });
  });

  it('never moves a thread that already has an event', async () => {
    const demo = await seedDemoEvent(db);
    const threadId = crypto.randomUUID();
    await getOrCreateThread(db, threadId, demo.id);

    await expect(createEventForThread(db, threadId, meetup)).rejects.toThrow(/already has an event/);
    expect((await getThread(db, threadId))?.eventId).toBe(demo.id);
  });
});
