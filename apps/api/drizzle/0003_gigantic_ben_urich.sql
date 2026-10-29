CREATE TABLE "agent_wallet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_token_id" text NOT NULL,
	"customer_id" text,
	"payer_email" text,
	"status" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_wallet_payment_token_id_unique" UNIQUE("payment_token_id")
);
--> statement-breakpoint
ALTER TABLE "agent_wallet" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spend" jsonb NOT NULL,
	"reasons" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paypal_order_id" text,
	"audit_id" uuid,
	"rejected_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "spend_references" (
	"reference_id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spend_references" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wallet_setups" (
	"setup_token_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_setups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_audit_id_audit_log_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_wallet_one_active" ON "agent_wallet" USING btree ("status") WHERE "agent_wallet"."status" = 'active';--> statement-breakpoint
CREATE INDEX "approvals_created_idx" ON "approvals" USING btree ("created_at");