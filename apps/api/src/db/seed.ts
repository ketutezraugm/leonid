import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { events, sponsors } from './schema.js';

export const DEMO_EVENT_NAME = 'OpenHack 2027';
export const DEMO_TICKET_PRICE = 2_500; // $25, in cents

const DEMO_SPONSORS = [
  { name: 'Harbor Cloud', tier: 'gold', pledged: 300_000 },
  { name: 'Lumen Labs', tier: 'silver', pledged: 250_000 },
  { name: 'Pixel Foundry', tier: 'bronze', pledged: 250_000 },
];

// The seeded demo event (AGENTS.md). Idempotent: running it twice leaves one event.
// Sponsor names are fictional on purpose; no real brands in seed data.
export async function seedDemoEvent(db: Db) {
  const [existing] = await db.select().from(events).where(eq(events.name, DEMO_EVENT_NAME));
  if (existing) {
    // An event seeded before tickets existed gets the demo price; one that already has a price keeps it.
    if (existing.ticketPrice === null) {
      await db.update(events).set({ ticketPrice: DEMO_TICKET_PRICE }).where(eq(events.id, existing.id));
      existing.ticketPrice = DEMO_TICKET_PRICE;
    }
    // Brings an already seeded event up to these amounts. A sponsor past 'pledged' keeps its amount: an invoice is always
    // for the full pledge, so changing it now would make the two disagree.
    for (const { name, tier, pledged } of DEMO_SPONSORS) {
      await db
        .update(sponsors)
        .set({ tier, pledged })
        .where(
          and(eq(sponsors.eventId, existing.id), eq(sponsors.name, name), eq(sponsors.status, 'pledged')),
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
