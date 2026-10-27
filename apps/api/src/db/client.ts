import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

// Driver-agnostic so tests can run the same queries on pglite.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export class DbNotConfiguredError extends Error {}

let cached: Db | undefined;

// The Supabase transaction pooler does not support prepared statements, hence prepare: false.
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DbNotConfiguredError('DATABASE_URL must be set');
  cached = drizzle(postgres(url, { prepare: false, max: 5 }), { schema });
  return cached;
}
