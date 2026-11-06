import { sql } from 'drizzle-orm';
import { customType, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

// Money is integer minor units (cents) plus an ISO currency code.

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  headcount: integer('headcount').notNull(),
  budgetTotal: integer('budget_total').notNull(),
  currency: text('currency').notNull().default('USD'),
  // Price of one ticket in minor units. Null: this event sells no tickets, and the public checkout refuses them.
  ticketPrice: integer('ticket_price'),
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
  'income_reversal',
] as const;

// Money PayPal has confirmed, written by webhook handlers only. Cleared income is read from here.
// (source, paypal_id) is unique so a replayed webhook can never count the same money twice, which is
// why paypal_id is NOT NULL (Postgres treats NULLs as distinct, so a null would defeat the index).
// capture_id is the PayPal capture that moved the money: the capture itself for ticket/donation income,
// the invoice's PayPal transaction for sponsor income, and the original capture for an income_reversal.
// Refund and reversal webhooks find the income they undo through it.
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
    paypalId: text('paypal_id').notNull(),
    captureId: text('capture_id'),
    sponsorId: uuid('sponsor_id').references(() => sponsors.id),
    category: text('category'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ledger_entries_source_paypal_idx').on(t.source, t.paypalId),
    index('ledger_entries_event_idx').on(t.eventId),
    index('ledger_entries_capture_idx').on(t.captureId),
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

// The hosted demo's pool of pre-approved vault tokens (all one payer, created with permit_multiple_payment_tokens).
// payment_token_id null = an approval link still waiting; set = a token on standby. Nothing ever charges a standby token:
// a treasurer's Reset moves the oldest one into agent_wallet (deleting its pool row), and "end demo" deletes them all.
export const demoTokenPool = pgTable('demo_token_pool', {
  id: uuid('id').primaryKey().defaultRandom(),
  setupTokenId: text('setup_token_id').notNull().unique(),
  paymentTokenId: text('payment_token_id').unique(),
  customerId: text('customer_id'),
  payerEmail: text('payer_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// The published sponsor spend report (F22): one per sponsor, regenerated in place. share_token is the bearer secret in the public
// link /report/:shareToken, so it stays the same when the report is regenerated and is never written to the audit log.
export const sponsorReports = pgTable('sponsor_reports', {
  sponsorId: uuid('sponsor_id')
    .primaryKey()
    .references(() => sponsors.id),
  shareToken: text('share_token').notNull().unique(),
  content: jsonb('content').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// One reference id = one spend; PayPal's idempotency key comes from it. The fingerprint detects reuse for a different spend.
export const spendReferences = pgTable('spend_references', {
  referenceId: text('reference_id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  // The event that spend belongs to. Null only for rows made before every spend needed an event.
  eventId: uuid('event_id').references(() => events.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spend: jsonb('spend').notNull(),
    // Same event as spend.eventId, as a column so it has a foreign key and approvals can be listed per event. Null only for old rows.
    eventId: uuid('event_id').references(() => events.id),
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

// --- Receipt claims (F16)

// Raw bytes. postgres-js gives a Buffer, pglite a Uint8Array; both read back as a Buffer.
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => Buffer.from(value),
});

// A person the treasurer registered to claim expenses. Their claims are paid only to payout_email, and the
// claim link's token is stored as a SHA-256 hash (it can start a payout, so it is a credential).
export const volunteers = pgTable(
  'volunteers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    name: text('name').notNull(),
    payoutEmail: text('payout_email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('volunteers_event_idx').on(t.eventId)],
).enableRLS();

export const CLAIM_STATUSES = ['submitted', 'needs_review', 'pending_approval', 'approved', 'paid', 'rejected'] as const;

// One receipt claim. amount is what the receipt says (or what the treasurer confirmed), in minor units. The
// spend it becomes has the reference id `claim:<id>`, so one claim can only ever be paid once.
export const claims = pgTable(
  'claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    volunteerId: uuid('volunteer_id')
      .notNull()
      .references(() => volunteers.id),
    category: text('category').notNull(),
    receiptMime: text('receipt_mime').notNull(),
    receiptImage: bytea('receipt_image').notNull(),
    extracted: jsonb('extracted'),
    amount: integer('amount'),
    currency: text('currency').notNull(),
    status: text('status', { enum: CLAIM_STATUSES }).notNull().default('submitted'),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    paypalBatchId: text('paypal_batch_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('claims_event_idx').on(t.eventId), index('claims_volunteer_idx').on(t.volunteerId)],
).enableRLS();
