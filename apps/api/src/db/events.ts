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

// The seeded demo event, which any new chat may be linked to. It is the unowned one with the demo name, so an organizer who
// names their own event the same neither shares theirs with everyone nor takes the demo's place.
export async function getDemoEvent(db: Db) {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.name, DEMO_EVENT_NAME), isNull(events.ownerSub)))
    .limit(1);
  return event;
}

const isDemoEvent = (event: { name: string; ownerSub: string | null }) =>
  event.name === DEMO_EVENT_NAME && event.ownerSub === null;

// Who sees an event. owner is ownerOf() the treasurer: null is the ops token, which sees every event. Anyone else sees the
// events they own plus the seeded demo event, which is shared by design. Unowned events from before owners existed are
// seen by no one else. A route answers an event it cannot see exactly like one that does not exist.
export function canSeeEvent(event: { name: string; ownerSub: string | null }, owner: string | null): boolean {
  return owner === null || event.ownerSub === owner || isDemoEvent(event);
}

const visibleTo = (owner: string | null) =>
  owner === null
    ? undefined
    : or(eq(events.ownerSub, owner), and(eq(events.name, DEMO_EVENT_NAME), isNull(events.ownerSub)));

export async function getVisibleEvent(db: Db, eventId: string, owner: string | null) {
  const event = await getEvent(db, eventId);
  return event && canSeeEvent(event, owner) ? event : undefined;
}

// The ids of the events this owner sees, for filtering rows that only carry an event id (approvals, spends).
export async function visibleEventIds(db: Db, owner: string | null): Promise<string[]> {
  const rows = await db.select({ id: events.id }).from(events).where(visibleTo(owner));
  return rows.map((r) => r.id);
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
    .select({ eventId: chatThreads.eventId, ownerSub: chatThreads.ownerSub })
    .from(chatThreads)
    .where(eq(chatThreads.id, threadId));
  if (!thread) throw new Error('Chat not found');
  if (thread.eventId) throw new Error('This chat already has an event. Start a new chat for another.');

  // The event belongs to whoever owns the chat that made it.
  const [event] = await db
    .insert(events)
    .values({ ...input, ownerSub: thread.ownerSub })
    .returning();
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

// The events this owner sees (canSeeEvent), soonest first, in the shared shape. Null: every event.
export async function listEvents(db: Db, owner: string | null): Promise<EventSummary[]> {
  const rows = await db
    .select()
    .from(events)
    .where(visibleTo(owner))
    .orderBy(asc(events.date), asc(events.name));
  return rows.map(toSummary);
}

// The setup flow's step 1. Sponsors, rules and the plan come later, each through its own screen or the agent.
export async function createEvent(
  db: Db,
  input: CreateEventRequest,
  owner: string | null,
): Promise<EventSummary> {
  const [event] = await db
    .insert(events)
    .values({
      name: input.name,
      date: new Date(`${input.date}T00:00:00Z`),
      headcount: input.people,
      budgetTotal: input.budget,
      currency: input.currency,
      ownerSub: owner,
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
// An event this owner cannot see is not_found.
export async function deleteEvent(
  db: Db,
  eventId: string,
  actor: string,
  owner: string | null,
): Promise<DeleteEventResult> {
  return db.transaction(async (tx) => {
    const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for('update');
    if (!event || !canSeeEvent(event, owner)) return { kind: 'not_found' };

    if (isDemoEvent(event))
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
