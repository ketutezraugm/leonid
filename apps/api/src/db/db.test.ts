import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './client.js';
import {
  createEventForThread,
  createOwnedEvent,
  getDemoEvent,
  getEvent,
  insertEvent,
  listOwnedEvents,
  listSponsors,
  ReservedEventNameError,
} from './events.js';
import {
  getActiveMandate,
  getChecklist,
  getOrCreateThread,
  getThread,
  replaceChecklist,
} from './mandates.js';
import { loadUnlocked } from './budget.js';
import { recordLedgerEntry } from './ledger.js';
import { auditLog, sponsors } from './schema.js';
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

  it('brings an already seeded event up to the current pledges, and leaves an invoiced sponsor alone', async () => {
    const event = await seedDemoEvent(db);
    await db.update(sponsors).set({ pledged: 350_000 }).where(eq(sponsors.name, 'Harbor Cloud'));
    await db.update(sponsors).set({ pledged: 200_000 }).where(eq(sponsors.name, 'Lumen Labs'));
    await db.update(sponsors).set({ pledged: 100_000, status: 'invoiced' }).where(eq(sponsors.name, 'Pixel Foundry'));

    await seedDemoEvent(db);

    const pledged = (await listSponsors(db, event.id)).map((s) => [s.name, s.pledged]);
    expect(pledged).toEqual([
      ['Harbor Cloud', 300_000],
      ['Lumen Labs', 250_000],
      ['Pixel Foundry', 100_000],
    ]);
  });
});

describe('tasks', () => {
  it('resolves dependencies by name and gates a task on a sponsor', async () => {
    const event = await seedDemoEvent(db);
    const before = (await listTasks(db, event.id)).length;
    await expect(
      createTasks(db, event.id, [
        { name: 'Fine', start: new Date('2027-01-01'), end: new Date('2027-01-02') },
        { name: 'Broken', start: new Date('2027-01-01'), end: new Date('2027-01-02'), dependsOnNames: ['Nope'] },
      ]),
    ).rejects.toThrow(/Unknown dependency/);
    expect(await listTasks(db, event.id)).toHaveLength(before);

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

describe('events made by a person', () => {
  const input = {
    name: ' Test Meetup ',
    date: new Date('2027-05-01T09:00:00Z'),
    headcount: 80,
    budgetTotal: 250_000,
    currency: 'USD',
    categories: ['venue', 'swag'],
  };

  it('stores the owner and categories, and lists only the owner\'s events (never the demo)', async () => {
    await seedDemoEvent(db);
    const mine = await createOwnedEvent(db, { ...input, ownerSub: 'demo:a' }, 'treasurer:demo');
    await createOwnedEvent(db, { ...input, name: 'Other', ownerSub: 'demo:b' }, 'treasurer:demo');

    expect(mine).toMatchObject({ name: 'Test Meetup', ownerSub: 'demo:a', categories: ['venue', 'swag'] });
    const listed = await listOwnedEvents(db, 'demo:a');
    expect(listed.map((e) => e.id)).toEqual([mine.id]);
    expect(await listOwnedEvents(db, 'nobody')).toEqual([]);
  });

  it('stores the city, and none when it is blank', async () => {
    const withCity = await createOwnedEvent(db, { ...input, city: ' Jakarta ', ownerSub: 'demo:a' }, 'treasurer:demo');
    const without = await createOwnedEvent(db, { ...input, name: 'No city', city: '  ', ownerSub: 'demo:a' }, 'treasurer:demo');
    expect(withCity.city).toBe('Jakarta');
    expect(without.city).toBeNull();
  });

  it('writes the audit row with the event', async () => {
    const event = await createOwnedEvent(db, { ...input, ownerSub: 'demo:a' }, 'treasurer:demo');
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'event.create'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'treasurer:demo', input: { eventId: event.id, ownerSub: 'demo:a' } });
  });

  it('keeps the demo name for the demo, whatever the case, on both creation paths', async () => {
    await seedDemoEvent(db);
    await expect(insertEvent(db, { ...input, name: 'openhack 2027 ' })).rejects.toBeInstanceOf(ReservedEventNameError);
    await expect(createOwnedEvent(db, { ...input, name: 'OPENHACK 2027', ownerSub: 'x' }, 'a')).rejects.toBeInstanceOf(
      ReservedEventNameError,
    );
    const threadId = crypto.randomUUID();
    await getOrCreateThread(db, threadId, null);
    await expect(createEventForThread(db, threadId, { ...input, name: 'OpenHack 2027' })).rejects.toBeInstanceOf(
      ReservedEventNameError,
    );
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'event.create'))).toHaveLength(0);
  });
});

describe('loadUnlocked', () => {
  const input = { name: 'Test Meetup', date: new Date('2027-05-01T09:00:00Z'), headcount: 80, budgetTotal: 250_000, currency: 'USD' };

  it('is zero for an event with only a budget target and a sponsor pledge', async () => {
    const event = await insertEvent(db, input);
    expect(await loadUnlocked(db, event, new Date())).toBe(0);
    const demo = await seedDemoEvent(db);
    expect(await loadUnlocked(db, demo, new Date())).toBe(0);
  });

  it('is the cleared income, once it clears', async () => {
    const event = await insertEvent(db, input);
    await recordLedgerEntry(db, {
      eventId: event.id,
      direction: 'in',
      amount: 120_000,
      currency: 'USD',
      source: 'donation',
      paypalId: 'CAP-1',
    });
    expect(await loadUnlocked(db, event, new Date())).toBe(120_000);
  });
});
