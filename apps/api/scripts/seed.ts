import { getDb } from '../src/db/client.js';
import { seedDemoEvent, seedDemoPlan } from '../src/db/seed.js';

const db = getDb();
const event = await seedDemoEvent(db);
await seedDemoPlan(db, event.id);
console.log(`Seeded "${event.name}" (${event.id})`);
process.exit(0);
