import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import type { ChecklistItem } from '@leonid/shared';
import type { Db } from './client.js';
import { chatThreads, mandateItems, mandates } from './schema.js';

export async function getThread(db: Db, threadId: string) {
  const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, threadId));
  return thread;
}

// A chat is seen only by the treasurer who started it; owner null (the ops token) sees every chat.
export const ownerThread = (threadId: string, owner: string | null) =>
  and(eq(chatThreads.id, threadId), owner === null ? undefined : eq(chatThreads.ownerSub, owner));

// The thread when this owner may see it; someone else's thread answers like an unknown one.
export async function getVisibleThread(db: Db, threadId: string, owner: string | null) {
  const [thread] = await db.select().from(chatThreads).where(ownerThread(threadId, owner));
  return thread;
}

// The chats this owner may see that are linked to an event, newest first: the plan history reads them.
export async function listOwnerEventThreads(db: Db, owner: string | null, limit = 50) {
  return db
    .select()
    .from(chatThreads)
    .where(
      and(isNotNull(chatThreads.eventId), owner === null ? undefined : eq(chatThreads.ownerSub, owner)),
    )
    .orderBy(desc(chatThreads.updatedAt))
    .limit(limit);
}

// The client mints thread ids, so the first message for an unknown id creates the thread, owned by
// whoever sent it. The event is set only on creation; an existing thread keeps the event it has.
// Undefined when the id is already someone else's thread.
export async function getOrCreateThread(
  db: Db,
  threadId: string,
  eventId: string | null,
  owner: string | null,
) {
  await db.insert(chatThreads).values({ id: threadId, eventId, ownerSub: owner }).onConflictDoNothing();
  return getVisibleThread(db, threadId, owner);
}

export async function saveMessages(db: Db, threadId: string, messages: unknown[]) {
  await db
    .update(chatThreads)
    .set({ messages, updatedAt: new Date() })
    .where(eq(chatThreads.id, threadId));
}

export async function getActiveMandate(db: Db, threadId: string) {
  const [mandate] = await db
    .select()
    .from(mandates)
    .where(eq(mandates.threadId, threadId))
    .orderBy(asc(mandates.createdAt));
  return mandate;
}

export async function getChecklist(db: Db, threadId: string): Promise<ChecklistItem[]> {
  const mandate = await getActiveMandate(db, threadId);
  if (!mandate) return [];
  const rows = await db
    .select()
    .from(mandateItems)
    .where(eq(mandateItems.mandateId, mandate.id))
    .orderBy(asc(mandateItems.position));
  return rows.map((row) => ({
    title: row.title,
    status: row.status,
    note: row.note ?? undefined,
    blockedOn: row.blockedOn ?? undefined,
  }));
}

export function mandateStatusOf(items: ChecklistItem[]) {
  if (items.length > 0 && items.every((item) => item.status === 'done')) return 'done' as const;
  if (items.some((item) => item.status === 'blocked')) return 'waiting' as const;
  return 'active' as const;
}

// Replaces the whole checklist, like a todo tool. Creates the mandate on first use.
export async function replaceChecklist(
  db: Db,
  args: { threadId: string; eventId: string | null; goal: string; items: ChecklistItem[] },
) {
  const status = mandateStatusOf(args.items);
  let mandate = await getActiveMandate(db, args.threadId);
  if (mandate) {
    await db
      .update(mandates)
      .set({ status, updatedAt: new Date() })
      .where(eq(mandates.id, mandate.id));
  } else {
    [mandate] = await db
      .insert(mandates)
      .values({
        threadId: args.threadId,
        eventId: args.eventId,
        goal: args.goal,
        status,
      })
      .returning();
  }
  if (!mandate) throw new Error('Could not save mandate');

  await db.delete(mandateItems).where(eq(mandateItems.mandateId, mandate.id));
  if (args.items.length > 0) {
    await db.insert(mandateItems).values(
      args.items.map((item, position) => ({
        mandateId: mandate.id,
        position,
        title: item.title,
        status: item.status,
        note: item.note ?? null,
        blockedOn: item.blockedOn ?? null,
      })),
    );
  }
  return { mandateId: mandate.id, status };
}
