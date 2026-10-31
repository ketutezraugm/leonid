import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { events, sponsors } from './schema.js';

export const DEMO_EVENT_NAME = 'OpenHack 2027';

// The seeded demo event (AGENTS.md). Idempotent: running it twice leaves one event.
// Sponsor names are fictional on purpose; no real brands in seed data.
export async function seedDemoEvent(db: Db) {
  const [existing] = await db.select().from(events).where(eq(events.name, DEMO_EVENT_NAME));
  if (existing) return existing;

  const [event] = await db
    .insert(events)
    .values({
      name: DEMO_EVENT_NAME,
      date: new Date('2027-03-14T09:00:00Z'),
      headcount: 200,
      budgetTotal: 800_000,
      currency: 'USD',
    })
    .returning();
  if (!event) throw new Error('Could not seed the demo event');

  await db.insert(sponsors).values([
    { eventId: event.id, name: 'Harbor Cloud', tier: 'gold', pledged: 300_000 },
    { eventId: event.id, name: 'Lumen Labs', tier: 'silver', pledged: 250_000 },
    { eventId: event.id, name: 'Pixel Foundry', tier: 'bronze', pledged: 250_000 },
  ]);
  return event;
}
