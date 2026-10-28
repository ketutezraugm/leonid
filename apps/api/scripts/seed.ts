import { getDb } from '../src/db/client.js';
import { seedDemoEvent } from '../src/db/seed.js';

const event = await seedDemoEvent(getDb());
console.log(`Seeded "${event.name}" (${event.id})`);
process.exit(0);
