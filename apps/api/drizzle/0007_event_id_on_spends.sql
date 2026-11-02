ALTER TABLE "approvals" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "spend_references" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_references" ADD CONSTRAINT "spend_references_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Old approvals kept their spend as JSON, event id included when the caller knew it. Copy it into the new column, but only when it
-- is a real event (compared as text, so a malformed value cannot error), so the foreign key cannot fail. Rows with no event stay null and can no longer be captured or rejected.
UPDATE "approvals" a SET "event_id" = e."id"
FROM "events" e
WHERE a."event_id" IS NULL AND e."id"::text = lower(a."spend"->>'eventId');--> statement-breakpoint
UPDATE "spend_references" r SET "event_id" = a."event_id"
FROM "approvals" a
WHERE r."event_id" IS NULL AND a."event_id" IS NOT NULL AND a."spend"->>'referenceId' = r."reference_id";
