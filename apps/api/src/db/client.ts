import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

// Driver-agnostic so tests can run the same queries on pglite.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export class DbNotConfiguredError extends Error {}

let cached: Db | undefined;

// DATABASE_URL is Supabase's SESSION pooler (port 5432). The transaction pooler (6543) left queries that waited
// behind another on the same connection unanswered, so requests hung. Each of the `max` connections takes one slot
// of the pooler's pool (15 by default), shared by every running copy of the API. prepare: false stays, so a URL
// pointed at the transaction pooler by mistake still works for simple queries.
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DbNotConfiguredError('DATABASE_URL must be set');
  cached = drizzle(postgres(url, { prepare: false, max: 5 }), { schema });
  return cached;
}
