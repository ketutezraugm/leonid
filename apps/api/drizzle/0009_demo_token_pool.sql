CREATE TABLE "demo_token_pool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setup_token_id" text NOT NULL,
	"payment_token_id" text,
	"customer_id" text,
	"payer_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_token_pool_setup_token_id_unique" UNIQUE("setup_token_id"),
	CONSTRAINT "demo_token_pool_payment_token_id_unique" UNIQUE("payment_token_id")
);
--> statement-breakpoint
ALTER TABLE "demo_token_pool" ENABLE ROW LEVEL SECURITY;