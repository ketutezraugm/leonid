import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

// Money is integer minor units (cents) plus an ISO currency code.

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  headcount: integer('headcount').notNull(),
  budgetTotal: integer('budget_total').notNull(),
  currency: text('currency').notNull().default('USD'),
  treasuryMerchantId: text('treasury_merchant_id'),
}).enableRLS();

export const sponsors = pgTable('sponsors', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id),
  name: text('name').notNull(),
  tier: text('tier').notNull(),
  pledged: integer('pledged').notNull(),
  paypalInvoiceId: text('paypal_invoice_id'),
  status: text('status', { enum: ['pledged', 'invoiced', 'paid'] })
    .notNull()
    .default('pledged'),
}).enableRLS();

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    name: text('name').notNull(),
    start: timestamp('start', { withTimezone: true }).notNull(),
    end: timestamp('end', { withTimezone: true }).notNull(),
    dependsOn: uuid('depends_on').array().notNull().default([]),
    deadline: timestamp('deadline', { withTimezone: true }),
    fundedBySponsorId: uuid('funded_by_sponsor_id').references(() => sponsors.id),
  },
  (t) => [index('tasks_event_idx').on(t.eventId)],
).enableRLS();

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    input: jsonb('input'),
    reason: text('reason'),
    ruleResult: text('rule_result'),
    paypalId: text('paypal_id'),
    // Filled in after the PayPal call (money-safety.md: write the row first, update it with the result).
    outcome: text('outcome'),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt)],
).enableRLS();

// The agent's PayPal wallet (a Vault payment token). 'revoked' with deleted_at null = still to be deleted at PayPal.
export const agentWallet = pgTable(
  'agent_wallet',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentTokenId: text('payment_token_id').notNull().unique(),
    customerId: text('customer_id'),
    payerEmail: text('payer_email'),
    status: text('status', { enum: ['active', 'revoked'] }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // At most one live token: a second one would stay chargeable with nothing left that can delete it.
  (t) => [uniqueIndex('agent_wallet_one_active').on(t.status).where(sql`${t.status} = 'active'`)],
).enableRLS();

// Vault setup tokens we created; each is accepted once on the return redirect, then deleted.
export const walletSetups = pgTable('wallet_setups', {
  setupTokenId: text('setup_token_id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// One reference id = one spend; PayPal's idempotency key comes from it. The fingerprint detects reuse for a different spend.
export const spendReferences = pgTable('spend_references', {
  referenceId: text('reference_id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spend: jsonb('spend').notNull(),
    reasons: text('reasons').array().notNull().default([]),
    // pending -> capturing -> paid, or pending -> rejected; see ApprovalsPort in payments/ports.ts
    status: text('status', { enum: ['pending', 'capturing', 'rejected', 'paid'] })
      .notNull()
      .default('pending'),
    paypalOrderId: text('paypal_order_id'),
    auditId: uuid('audit_id').references(() => auditLog.id),
    rejectedBy: text('rejected_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('approvals_created_idx').on(t.createdAt),
    // One approval per PayPal order, so an order id always resolves to a single row to capture.
    uniqueIndex('approvals_paypal_order_unique').on(t.paypalOrderId),
  ],
).enableRLS();

export const chatThreads = pgTable(
  'chat_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Null until the chat creates its event or the user links one; a chat never sees other events.
    eventId: uuid('event_id').references(() => events.id),
    title: text('title'),
    messages: jsonb('messages').notNull().default([]),
    // Archived threads leave the list but keep their mandate and still open by id.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chat_threads_event_updated_idx').on(t.eventId, t.updatedAt)],
).enableRLS();

export const MANDATE_STATUSES = ['active', 'waiting', 'done', 'failed'] as const;
export const ITEM_STATUSES = ['pending', 'in_progress', 'done', 'blocked'] as const;

export const mandates = pgTable('mandates', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id')
    .notNull()
    .references(() => chatThreads.id),
  // Follows the thread: null when the checklist was written before the chat had an event.
  eventId: uuid('event_id').references(() => events.id),
  goal: text('goal').notNull(),
  status: text('status', { enum: MANDATE_STATUSES }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const mandateItems = pgTable(
  'mandate_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    status: text('status', { enum: ITEM_STATUSES }).notNull().default('pending'),
    note: text('note'),
    blockedOn: text('blocked_on'),
  },
  (t) => [index('mandate_items_mandate_idx').on(t.mandateId)],
).enableRLS();
