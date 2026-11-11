ALTER TABLE "chat_threads" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "chat_threads_event_updated_idx" ON "chat_threads" USING btree ("event_id","updated_at");