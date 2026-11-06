import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { EventSummary } from '@quartermaster/shared';
import { writeAudit } from './audit.js';
import type { Db } from './client.js';
import { chatThreads, events, mandates, sponsors } from './schema.js';
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
  endDate?: Date | null;
  headcount: number;
  budgetTotal: number;
  currency: string;
  categories?: string[];
  city?: string | null;
  ownerSub?: string | null;
}

// getDemoEvent finds the demo by name, so no one else may take it: the demo would then be whichever came first.
export class ReservedEventNameError extends Error {
  constructor() {
    super(`"${DEMO_EVENT_NAME}" is the demo event's name. Choose another name.`);
    this.name = 'ReservedEventNameError';
  }
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The one place an event row is inserted, for the form and for the agent's create_event alike.
export async function insertEvent(db: Db, input: NewEvent) {
  if (sameName(input.name, DEMO_EVENT_NAME)) throw new ReservedEventNameError();
  const [event] = await db
    .insert(events)
    .values({ ...input, name: input.name.trim(), categories: input.categories ?? [], city: input.city?.trim() || null, ownerSub: input.ownerSub ?? null })
    .returning();
  if (!event) throw new Error('Could not create the event');
  return event;
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

  const event = await insertEvent(db, input);
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

// The setup form's path: the event and its audit row are written together or not at all (invariant 7).
export async function createOwnedEvent(db: Db, input: NewEvent & { ownerSub: string }, actor: string) {
  return db.transaction(async (tx) => {
    const event = await insertEvent(tx, input);
    await writeAudit(tx, {
      actor,
      action: 'event.create',
      input: {
        eventId: event.id,
        ownerSub: input.ownerSub,
        name: event.name,
        date: event.date.toISOString().slice(0, 10),
        endDate: (event.endDate ?? event.date).toISOString().slice(0, 10),
        headcount: event.headcount,
        budgetTotal: event.budgetTotal,
        currency: event.currency,
        categories: event.categories,
        city: event.city,
      },
      reason: 'Event created from the setup form',
    });
    return event;
  });
}

// The events a person made, newest first. The seeded demo event is never in it: it has no owner.
export function listOwnedEvents(db: Db, ownerSub: string) {
  return db.select().from(events).where(eq(events.ownerSub, ownerSub)).orderBy(desc(events.date), asc(events.name));
}

const day = (d: Date) => d.toISOString().slice(0, 10);

// One events row in the shared shape.
export function toSummary(row: typeof events.$inferSelect): EventSummary {
  return {
    id: row.id,
    name: row.name,
    date: day(row.date),
    endDate: day(row.endDate ?? row.date),
    people: row.headcount,
    currency: row.currency,
    budget: row.budgetTotal,
    categories: row.categories,
    city: row.city,
  };
}

// Every event, soonest first, in the shared shape, whoever made it. For jobs that run over all events (budget recompute).
export async function listEvents(db: Db): Promise<EventSummary[]> {
  const rows = await db.select().from(events).orderBy(asc(events.date), asc(events.name));
  return rows.map(toSummary);
}

export function listSponsors(db: Db, eventId: string) {
  return db
    .select()
    .from(sponsors)
    .where(eq(sponsors.eventId, eventId))
    .orderBy(asc(sponsors.name));
}
