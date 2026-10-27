import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { events } from './schema.js';

// Demo event for the video and the judges' hosted demo. Safe to run repeatedly.
const { db, pool } = createDb();

const [existing] = await db.select().from(events).where(eq(events.name, 'OpenHack 2027')).limit(1);
if (!existing) {
  await db.insert(events).values({
    name: 'OpenHack 2027',
    date: '2027-03-14',
    headcount: 200,
    budgetTotalCents: 800_000,
  });
  console.log('seeded OpenHack 2027');
} else {
  console.log('OpenHack 2027 already seeded');
}
await pool.end();
