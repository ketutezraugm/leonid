CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"category" text NOT NULL,
	"receipt_mime" text NOT NULL,
	"receipt_image" "bytea" NOT NULL,
	"extracted" jsonb,
	"amount" integer,
	"currency" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"paypal_batch_id" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "volunteers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"payout_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteers_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "volunteers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claims_event_idx" ON "claims" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "claims_volunteer_idx" ON "claims" USING btree ("volunteer_id");--> statement-breakpoint
CREATE INDEX "volunteers_event_idx" ON "volunteers" USING btree ("event_id");