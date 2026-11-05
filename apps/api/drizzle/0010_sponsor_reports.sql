CREATE TABLE "sponsor_reports" (
	"sponsor_id" uuid PRIMARY KEY NOT NULL,
	"share_token" text NOT NULL,
	"content" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_reports_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
ALTER TABLE "sponsor_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sponsor_reports" ADD CONSTRAINT "sponsor_reports_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE no action ON UPDATE no action;