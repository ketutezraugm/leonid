import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set');

const client = postgres(url, { prepare: false, max: 1 });
await migrate(drizzle(client), {
  migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle'),
});
await client.end();
console.log('Migrations applied');
