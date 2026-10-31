import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle/0006_revoke_api_role_grants.sql'),
  'utf8',
);

const can = async (db: PGlite, role: string, table: string, privilege: string) =>
  (await db.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', [role, table, privilege])).rows[0]!.ok;

describe('0006 revoke_api_role_grants', () => {
  it('takes every privilege away from anon and authenticated on existing and future tables, and leaves the owner alone', async () => {
    const db = new PGlite();
    // What Supabase sets up: the API roles, and default grants to them on tables created in public.
    await db.exec(`
      create role anon; create role authenticated;
      grant usage on schema public to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      create table before_t (id int);
    `);
    expect(await can(db, 'anon', 'before_t', 'select')).toBe(true);
    expect(await can(db, 'authenticated', 'before_t', 'truncate')).toBe(true);

    await db.exec(migration);
    await db.exec('create table after_t (id int)');

    for (const table of ['before_t', 'after_t']) {
      for (const role of ['anon', 'authenticated']) {
        for (const privilege of ['select', 'insert', 'update', 'delete', 'truncate']) {
          expect(await can(db, role, table, privilege), `${role} ${privilege} ${table}`).toBe(false);
        }
      }
      expect(await can(db, 'postgres', table, 'select')).toBe(true);
    }
  });

  it('is a no-op where the Supabase roles do not exist, and safe to run twice', async () => {
    const db = new PGlite();
    await db.exec('create table t (id int)');
    await db.exec(migration);
    await db.exec(migration);
    expect(await can(db, 'postgres', 't', 'select')).toBe(true);
  });
});
