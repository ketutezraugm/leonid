import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { events, sponsors, tasks, type TASK_KINDS, type WORKSTREAMS } from './schema.js';

export const DEMO_EVENT_NAME = 'OpenHack 2027';
export const DEMO_TICKET_PRICE = 2_500; // $25, in cents

const DEMO_SPONSORS = [
  { name: 'Harbor Cloud', tier: 'gold', pledged: 300_000 },
  { name: 'Lumen Labs', tier: 'silver', pledged: 250_000 },
  { name: 'Pixel Foundry', tier: 'bronze', pledged: 250_000 },
];

// The demo plan: 22 linked tasks counting down to event day (Mar 14, 2027) and the load-out after it, in workstreams, with
// the event-week spine a real event runs on (final confirmations, load-in, rehearsal, event day, load-out). `after` names
// earlier tasks in this list. `funded` and `invoice` name a sponsor from DEMO_SPONSORS. Days are 'YYYY-MM-DD'; a task ends
// at the end of its end day, and a milestone is a moment at the start of its day.
type TaskKind = (typeof TASK_KINDS)[number];
type Workstream = (typeof WORKSTREAMS)[number];
interface DemoTask {
  name: string;
  start: string;
  end: string;
  kind: TaskKind;
  workstream: Workstream;
  deadline?: string;
  after?: string[];
  funded?: string;
  invoice?: string;
}

export const DEMO_TASKS: DemoTask[] = [
  { name: 'Venue deposit', start: '2027-01-11', end: '2027-01-12', kind: 'payment', workstream: 'venue' },
  {
    name: 'Harbor Cloud invoice, $3,000',
    start: '2027-01-11',
    end: '2027-01-31',
    kind: 'task',
    workstream: 'sponsors',
    invoice: 'Harbor Cloud',
  },
  {
    name: 'Lumen Labs invoice, $2,500',
    start: '2027-01-11',
    end: '2027-01-24',
    kind: 'task',
    workstream: 'sponsors',
    invoice: 'Lumen Labs',
  },
  {
    name: 'Pixel Foundry invoice, $2,500',
    start: '2027-01-18',
    end: '2027-02-07',
    kind: 'task',
    workstream: 'sponsors',
    invoice: 'Pixel Foundry',
  },
  {
    name: 'Order swag (lanyards, T-shirts)',
    start: '2027-02-01',
    end: '2027-02-02',
    kind: 'payment',
    workstream: 'swag',
    funded: 'Harbor Cloud',
  },
  {
    name: 'Swag delivery',
    start: '2027-02-03',
    end: '2027-02-23',
    kind: 'task',
    workstream: 'swag',
    deadline: '2027-03-07',
    after: ['Order swag (lanyards, T-shirts)'],
  },
  {
    name: 'Speaker travel',
    start: '2027-02-01',
    end: '2027-02-03',
    kind: 'payment',
    workstream: 'people',
    funded: 'Harbor Cloud',
  },
  {
    name: 'Buy prizes',
    start: '2027-01-25',
    end: '2027-01-27',
    kind: 'payment',
    workstream: 'prizes',
    funded: 'Lumen Labs',
  },
  {
    name: 'Prize delivery',
    start: '2027-01-28',
    end: '2027-02-06',
    kind: 'task',
    workstream: 'prizes',
    deadline: '2027-03-10',
    after: ['Buy prizes'],
  },
  {
    name: 'Book AV',
    start: '2027-01-13',
    end: '2027-01-17',
    kind: 'payment',
    workstream: 'av',
    deadline: '2027-03-01',
    after: ['Venue deposit'],
  },
  {
    name: 'Catering deposit',
    start: '2027-02-08',
    end: '2027-02-09',
    kind: 'payment',
    workstream: 'catering',
    funded: 'Pixel Foundry',
  },
  {
    name: 'Snacks and drinks order',
    start: '2027-03-01',
    end: '2027-03-02',
    kind: 'payment',
    workstream: 'catering',
    deadline: '2027-03-12',
    funded: 'Pixel Foundry',
    after: ['Catering deposit'],
  },
  {
    name: 'Badges and adapters printed',
    start: '2027-03-01',
    end: '2027-03-03',
    kind: 'task',
    workstream: 'printing',
    deadline: '2027-03-10',
  },
  { name: 'Volunteer briefing', start: '2027-03-08', end: '2027-03-08', kind: 'task', workstream: 'people' },
  {
    name: 'Book photographer',
    start: '2027-02-15',
    end: '2027-02-16',
    kind: 'payment',
    workstream: 'photo_video',
    deadline: '2027-03-07',
    after: ['Venue deposit'],
  },
  {
    name: 'Signage print order',
    start: '2027-02-22',
    end: '2027-02-26',
    kind: 'task',
    workstream: 'printing',
    deadline: '2027-03-10',
  },
  {
    name: 'Pay printer',
    start: '2027-02-26',
    end: '2027-02-26',
    kind: 'payment',
    workstream: 'printing',
    after: ['Signage print order'],
  },
  {
    name: 'Final confirmations with vendors',
    start: '2027-03-07',
    end: '2027-03-07',
    kind: 'milestone',
    workstream: 'venue',
    after: ['Book AV', 'Book photographer', 'Snacks and drinks order', 'Swag delivery'],
  },
  {
    name: 'Load-in and AV/wifi test',
    start: '2027-03-13',
    end: '2027-03-13',
    kind: 'task',
    workstream: 'av',
    after: [
      'Final confirmations with vendors',
      'Prize delivery',
      'Badges and adapters printed',
      'Pay printer',
    ],
  },
  {
    name: 'Final rehearsal',
    start: '2027-03-13',
    end: '2027-03-13',
    kind: 'milestone',
    workstream: 'people',
    after: ['Load-in and AV/wifi test', 'Volunteer briefing'],
  },
  {
    name: 'Event day',
    start: '2027-03-14',
    end: '2027-03-14',
    kind: 'milestone',
    workstream: 'venue',
    after: ['Final rehearsal', 'Speaker travel'],
  },
  {
    name: 'Load-out and thank-yous',
    start: '2027-03-15',
    end: '2027-03-15',
    kind: 'task',
    workstream: 'venue',
    after: ['Event day'],
  },
];

// Kept apart from seedDemoEvent (only scripts/seed.ts calls it) so tests that start from the bare demo event begin with an
// empty plan. Idempotent: inserts the demo tasks the event does not have yet (by name), and gives a demo task seeded before
// kinds and workstreams existed its kind and workstream. Tasks the organizer or the agent added are not touched.
export async function seedDemoPlan(db: Db, eventId: string) {
  const existing = await db
    .select({ id: tasks.id, name: tasks.name, workstream: tasks.workstream, dependsOn: tasks.dependsOn })
    .from(tasks)
    .where(eq(tasks.eventId, eventId));
  const idByName = new Map(existing.map((t) => [t.name, t.id]));
  const demo = new Map(DEMO_TASKS.map((t) => [t.name, t]));
  for (const row of existing) {
    const t = demo.get(row.name);
    if (!t || row.workstream !== null) continue;
    await db.update(tasks).set({ kind: t.kind, workstream: t.workstream }).where(eq(tasks.id, row.id));
  }

  const missing = DEMO_TASKS.filter((t) => !idByName.has(t.name));
  if (missing.length === 0) return;
  for (const t of missing) idByName.set(t.name, crypto.randomUUID());
  const rows = await db.select().from(sponsors).where(eq(sponsors.eventId, eventId));
  const sponsorId = (name?: string) => rows.find((s) => s.name === name)?.id ?? null;
  await db.insert(tasks).values(
    missing.map((t) => ({
      id: idByName.get(t.name),
      eventId,
      name: t.name,
      start: new Date(`${t.start}T00:00:00Z`),
      end: new Date(t.kind === 'milestone' ? `${t.end}T00:00:00Z` : `${t.end}T23:59:59Z`),
      deadline: t.deadline ? new Date(`${t.deadline}T23:59:59Z`) : null,
      dependsOn: (t.after ?? []).map((name) => idByName.get(name) as string),
      fundedBySponsorId: sponsorId(t.funded),
      invoiceOfSponsorId: sponsorId(t.invoice),
      kind: t.kind,
      workstream: t.workstream,
    })),
  );

  // An event day seeded before the spine existed also waits on the new rehearsal and travel, as a fresh seed's does.
  const eventDay = existing.find((t) => t.name === 'Event day');
  if (!eventDay) return;
  const extra = (demo.get('Event day')?.after ?? [])
    .map((name) => idByName.get(name))
    .filter((id): id is string => id !== undefined && !eventDay.dependsOn.includes(id));
  if (extra.length > 0) {
    await db
      .update(tasks)
      .set({ dependsOn: [...eventDay.dependsOn, ...extra] })
      .where(eq(tasks.id, eventDay.id));
  }
}

// The seeded demo event (AGENTS.md). Idempotent: running it twice leaves one event.
// Sponsor names are fictional on purpose; no real brands in seed data.
export async function seedDemoEvent(db: Db) {
  const [existing] = await db.select().from(events).where(eq(events.name, DEMO_EVENT_NAME));
  if (existing) {
    // An event seeded before tickets existed gets the demo price; one that already has a price keeps it.
    if (existing.ticketPrice === null) {
      await db
        .update(events)
        .set({ ticketPrice: DEMO_TICKET_PRICE })
        .where(eq(events.id, existing.id));
      existing.ticketPrice = DEMO_TICKET_PRICE;
    }
    // Brings an already seeded event up to these amounts. A sponsor past 'pledged' keeps its amount: an invoice is always
    // for the full pledge, so changing it now would make the two disagree.
    for (const { name, tier, pledged } of DEMO_SPONSORS) {
      await db
        .update(sponsors)
        .set({ tier, pledged })
        .where(
          and(
            eq(sponsors.eventId, existing.id),
            eq(sponsors.name, name),
            eq(sponsors.status, 'pledged'),
          ),
        );
    }
    return existing;
  }

  const [event] = await db
    .insert(events)
    .values({
      name: DEMO_EVENT_NAME,
      date: new Date('2027-03-14T09:00:00Z'),
      headcount: 200,
      budgetTotal: 800_000,
      currency: 'USD',
      ticketPrice: DEMO_TICKET_PRICE,
    })
    .returning();
  if (!event) throw new Error('Could not seed the demo event');

  await db.insert(sponsors).values(DEMO_SPONSORS.map((s) => ({ eventId: event.id, ...s })));
  return event;
}
