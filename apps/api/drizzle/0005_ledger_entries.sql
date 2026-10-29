CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	"paypal_id" text NOT NULL,
	"capture_id" text,
	"sponsor_id" uuid,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_source_paypal_idx" ON "ledger_entries" USING btree ("source","paypal_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_event_idx" ON "ledger_entries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_capture_idx" ON "ledger_entries" USING btree ("capture_id");