import { bigint, date, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Money is integer cents + an ISO currency code, never floats.
// RLS is enabled on every table with no policies: on Supabase the public REST API can then
// not read or write them, and only our server (a direct Postgres connection) can.

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  date: date('date').notNull(),
  headcount: integer('headcount').notNull(),
  budgetTotalCents: bigint('budget_total_cents', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('USD'),
  treasuryMerchantId: text('treasury_merchant_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// PayPal retries webhooks for days. The event id as primary key makes handlers idempotent.
export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  app: text('app').notNull(), // 'treasury' | 'procurement'
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}).enableRLS();
