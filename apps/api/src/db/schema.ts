import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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

// Same values as LedgerSource in @quartermaster/shared; a test keeps the two in step.
export const LEDGER_SOURCES = [
  'sponsor_invoice',
  'subscription',
  'ticket',
  'donation',
  'purchase',
  'refund',
  'claim_payout',
  'speaker_payout',
  'prize_payout',
] as const;

// Money PayPal has confirmed, written by webhook handlers only. Cleared income is read from here.
// (source, paypal_id) is unique so a replayed webhook can never count the same money twice.
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    source: text('source', { enum: LEDGER_SOURCES }).notNull(),
    paypalId: text('paypal_id'),
    sponsorId: uuid('sponsor_id').references(() => sponsors.id),
    category: text('category'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ledger_entries_source_paypal_idx').on(t.source, t.paypalId),
    index('ledger_entries_event_idx').on(t.eventId),
  ],
).enableRLS();

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt)],
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
