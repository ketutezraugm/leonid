ALTER TABLE "events" ADD COLUMN "owner_sub" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "categories" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "events_owner_idx" ON "events" USING btree ("owner_sub");