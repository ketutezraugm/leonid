import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from './client.js';
import * as schema from './schema.js';

// Test-only: an in-memory Postgres running the real migrations. Never imported by the server.
export async function createTestDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  const migrationsFolder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../drizzle',
  );
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}
