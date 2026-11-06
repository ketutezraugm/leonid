import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import type { CreateEventRequest, EventSummary } from '@quartermaster/shared';
import { writeAudit } from './audit.js';
import type { Db } from './client.js';
import {
  approvals,
  chatThreads,
  events,
  ledgerEntries,
  mandateItems,
  mandates,
  spendReferences,
  sponsorReports,
  sponsors,
  tasks,
} from './schema.js';
import { DEMO_EVENT_NAME } from './seed.js';

export async function getEvent(db: Db, eventId: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  return event;
}

// The seeded demo event, which any new chat may be linked to.
export async function getDemoEvent(db: Db) {
  const [event] = await db.select().from(events).where(eq(events.name, DEMO_EVENT_NAME)).limit(1);
  return event;
}

export interface NewEvent {
  name: string;
  date: Date;
  headcount: number;
  budgetTotal: number;
  currency: string;
}

// Creates the chat's own event and binds the thread (and a checklist written before it) to it.
// A thread that already has an event keeps it, so a chat can never be moved onto another plan.
export async function createEventForThread(db: Db, threadId: string, input: NewEvent) {
  const [thread] = await db
    .select({ eventId: chatThreads.eventId })
    .from(chatThreads)
    .where(eq(chatThreads.id, threadId));
  if (!thread) throw new Error('Chat not found');
  if (thread.eventId) throw new Error('This chat already has an event. Start a new chat for another.');

  const [event] = await db.insert(events).values(input).returning();
  if (!event) throw new Error('Could not create the event');
  await db
    .update(chatThreads)
    .set({ eventId: event.id })
    .where(and(eq(chatThreads.id, threadId), isNull(chatThreads.eventId)));
  await db
    .update(mandates)
    .set({ eventId: event.id })
    .where(and(eq(mandates.threadId, threadId), isNull(mandates.eventId)));
  return event;
}

// Every event, soonest first, in the shared shape. There is one organisation per deployment, so no owner filter.
export async function listEvents(db: Db): Promise<EventSummary[]> {
  const rows = await db.select().from(events).orderBy(asc(events.date), asc(events.name));
  return rows.map(toSummary);
}

// The setup flow's step 1. Sponsors, rules and the plan come later, each through its own screen or the agent.
export async function createEvent(db: Db, input: CreateEventRequest): Promise<EventSummary> {
  const [event] = await db
    .insert(events)
    .values({
      name: input.name,
      date: new Date(`${input.date}T00:00:00Z`),
      headcount: input.people,
      budgetTotal: input.budget,
      currency: input.currency,
    })
    .returning();
  if (!event) throw new Error('Could not create the event');
  return toSummary(event);
}

export type DeleteEventResult =
  { kind: 'deleted' } | { kind: 'not_found' } | { kind: 'refused'; reason: string };

// Deletes an event that never touched money, with its plan, sponsors and chats. Money history is never deleted:
// an event with ledger entries, spends, approvals or a sponsor invoice sent through PayPal is refused, and so is the
// seeded demo event (the seed script, video and hosted demo depend on it). The event row is locked first, so a spend
// or webhook racing the delete either waits and then fails its foreign key, or lands first and makes this refuse.
export async function deleteEvent(
  db: Db,
  eventId: string,
  actor: string,
): Promise<DeleteEventResult> {
  return db.transaction(async (tx) => {
    const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for('update');
    if (!event) return { kind: 'not_found' };

    const demo = await getDemoEvent(tx);
    if (demo?.id === eventId)
      return { kind: 'refused', reason: 'The demo event cannot be deleted.' };

    const moneyHistory = await Promise.all([
      tx
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.eventId, eventId))
        .limit(1),
      tx
        .select({ id: approvals.id })
        .from(approvals)
        .where(eq(approvals.eventId, eventId))
        .limit(1),
      tx
        .select({ id: spendReferences.referenceId })
        .from(spendReferences)
        .where(eq(spendReferences.eventId, eventId))
        .limit(1),
      tx
        .select({ id: sponsors.id })
        .from(sponsors)
        .where(
          and(
            eq(sponsors.eventId, eventId),
            or(isNotNull(sponsors.paypalInvoiceId), ne(sponsors.status, 'pledged')),
          ),
        )
        .limit(1),
    ]);
    if (moneyHistory.some((rows) => rows.length > 0)) {
      return {
        kind: 'refused',
        reason:
          'This event has money history (payments, spends or sponsor invoices), so it cannot be deleted.',
      };
    }

    const eventSponsors = tx
      .select({ id: sponsors.id })
      .from(sponsors)
      .where(eq(sponsors.eventId, eventId));
    const eventThreads = tx
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(eq(chatThreads.eventId, eventId));
    const eventMandates = tx
      .select({ id: mandates.id })
      .from(mandates)
      .where(or(eq(mandates.eventId, eventId), inArray(mandates.threadId, eventThreads)));
    await tx.delete(mandateItems).where(inArray(mandateItems.mandateId, eventMandates));
    await tx
      .delete(mandates)
      .where(or(eq(mandates.eventId, eventId), inArray(mandates.threadId, eventThreads)));
    await tx.delete(chatThreads).where(eq(chatThreads.eventId, eventId));
    await tx.delete(tasks).where(eq(tasks.eventId, eventId));
    await tx.delete(sponsorReports).where(inArray(sponsorReports.sponsorId, eventSponsors));
    await tx.delete(sponsors).where(eq(sponsors.eventId, eventId));
    await tx.delete(events).where(eq(events.id, eventId));
    await writeAudit(tx, {
      actor,
      action: 'event.delete',
      input: { eventId, name: event.name, date: event.date.toISOString().slice(0, 10) },
      reason: 'treasurer deleted an event with no money history',
    });
    return { kind: 'deleted' };
  });
}

function toSummary(row: typeof events.$inferSelect): EventSummary {
  return {
    id: row.id,
    name: row.name,
    date: row.date.toISOString().slice(0, 10),
    people: row.headcount,
    budget: row.budgetTotal,
    currency: row.currency,
  };
}

export function listSponsors(db: Db, eventId: string) {
  return db
    .select()
    .from(sponsors)
    .where(eq(sponsors.eventId, eventId))
    .orderBy(asc(sponsors.name));
}
