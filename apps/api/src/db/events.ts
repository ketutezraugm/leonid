import { and, asc, eq, isNull } from 'drizzle-orm';
import type { CreateEventRequest, EventSummary } from '@quartermaster/shared';
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
