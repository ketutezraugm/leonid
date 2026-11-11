ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "owner_sub" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "owner_sub" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_owner_idx" ON "events" USING btree ("owner_sub");
