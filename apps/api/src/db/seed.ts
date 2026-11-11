import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { events, sponsors, tasks } from './schema.js';

export const DEMO_EVENT_NAME = 'OpenHack 2027';
export const DEMO_TICKET_PRICE = 2_500; // $25, in cents

const DEMO_SPONSORS = [
  { name: 'Harbor Cloud', tier: 'gold', pledged: 300_000 },
  { name: 'Lumen Labs', tier: 'silver', pledged: 250_000 },
  { name: 'Pixel Foundry', tier: 'bronze', pledged: 250_000 },
];

// The demo plan: 15 linked tasks counting down to event day (Mar 14, 2027). Dependencies are by index into this list.
// `funded` and `invoice` name a sponsor from DEMO_SPONSORS. Days are 'YYYY-MM-DD'; a task ends at the end of its end day.
interface DemoTask {
  name: string;
  start: string;
  end: string;
  deadline?: string;
  after?: number[];
  funded?: string;
  invoice?: string;
}
const DEMO_TASKS: DemoTask[] = [
  { name: 'Venue deposit', start: '2027-01-11', end: '2027-01-12' },
  {
    name: 'Harbor Cloud invoice, $3,000',
    start: '2027-01-11',
    end: '2027-01-31',
    invoice: 'Harbor Cloud',
  },
  {
    name: 'Lumen Labs invoice, $2,500',
    start: '2027-01-11',
    end: '2027-01-24',
    invoice: 'Lumen Labs',
  },
  {
    name: 'Pixel Foundry invoice, $2,500',
    start: '2027-01-18',
    end: '2027-02-07',
    invoice: 'Pixel Foundry',
  },
  {
    name: 'Order swag (lanyards, T-shirts)',
    start: '2027-02-01',
    end: '2027-02-02',
    funded: 'Harbor Cloud',
  },
  {
    name: 'Swag delivery',
    start: '2027-02-03',
    end: '2027-02-23',
    deadline: '2027-03-07',
    after: [4],
  },
  { name: 'Speaker travel', start: '2027-02-01', end: '2027-02-03', funded: 'Harbor Cloud' },
  { name: 'Buy prizes', start: '2027-01-25', end: '2027-01-27', funded: 'Lumen Labs' },
  {
    name: 'Prize delivery',
    start: '2027-01-28',
    end: '2027-02-06',
    deadline: '2027-03-10',
    after: [7],
  },
  { name: 'Book AV', start: '2027-01-13', end: '2027-01-17', deadline: '2027-03-01', after: [0] },
  { name: 'Catering deposit', start: '2027-02-08', end: '2027-02-09', funded: 'Pixel Foundry' },
  {
    name: 'Snacks and drinks order',
    start: '2027-03-01',
    end: '2027-03-02',
    deadline: '2027-03-12',
    funded: 'Pixel Foundry',
    after: [10],
  },
  {
    name: 'Badges and adapters printed',
    start: '2027-03-01',
    end: '2027-03-03',
    deadline: '2027-03-10',
  },
  { name: 'Volunteer briefing', start: '2027-03-08', end: '2027-03-08' },
  { name: 'Event day', start: '2027-03-14', end: '2027-03-14', after: [5, 6, 8, 9, 11, 12, 13] },
];

// Kept apart from seedDemoEvent (only scripts/seed.ts calls it) so tests that start from the bare demo event begin with an
// empty plan. Inserts the demo plan when the event has no tasks yet; an event that already has a plan keeps it.
export async function seedDemoPlan(db: Db, eventId: string) {
  const [any] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.eventId, eventId))
    .limit(1);
  if (any) return;
  const rows = await db.select().from(sponsors).where(eq(sponsors.eventId, eventId));
  const sponsorId = (name?: string) => rows.find((s) => s.name === name)?.id ?? null;
  const ids = DEMO_TASKS.map(() => crypto.randomUUID());
  await db.insert(tasks).values(
    DEMO_TASKS.map((t, i) => ({
      id: ids[i],
      eventId,
      name: t.name,
      start: new Date(`${t.start}T00:00:00Z`),
      end: new Date(`${t.end}T23:59:59Z`),
      deadline: t.deadline ? new Date(`${t.deadline}T23:59:59Z`) : null,
      dependsOn: (t.after ?? []).map((n) => ids[n] as string),
      fundedBySponsorId: sponsorId(t.funded),
      invoiceOfSponsorId: sponsorId(t.invoice),
    })),
  );
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
