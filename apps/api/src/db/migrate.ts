import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

const { db, pool } = createDb();
await migrate(db, { migrationsFolder: './drizzle' });
await pool.end();
console.log('migrations applied');
