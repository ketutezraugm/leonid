CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"country_code" text,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"category" text NOT NULL,
	"sponsor_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"paypal_batch_id" text,
	"paypal_item_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "payout_status" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "paypal_item_id" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payouts_event_idx" ON "payouts" USING btree ("event_id");