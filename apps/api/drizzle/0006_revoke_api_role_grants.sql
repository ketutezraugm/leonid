-- Defense in depth for Supabase: its API roles (anon, authenticated) are granted every privilege on every public table by
-- default. Our server connects as the database owner and never uses Supabase's REST API, so they need none. Row-level
-- security already denies them everything (it is enabled on every table, with no policies); this removes the grants too,
-- so a table that ever misses ENABLE ROW LEVEL SECURITY is still closed. The default-privileges line covers future tables.
-- The roles do not exist outside Supabase (local Docker, the pglite test database), so the block does nothing there.
DO $$
DECLARE r text;
BEGIN
	FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
			EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
			EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
		END IF;
	END LOOP;
END $$;
