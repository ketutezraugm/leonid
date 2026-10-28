import { asc, eq } from 'drizzle-orm';
import type { ChecklistItem } from '@quartermaster/shared';
import type { Db } from './client.js';
import { chatThreads, mandateItems, mandates } from './schema.js';

export async function getThread(db: Db, threadId: string) {
  const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, threadId));
  return thread;
}

// The client mints thread ids, so the first message for an unknown id creates the thread. The
// event is set only on creation; an existing thread keeps the event it has.
export async function getOrCreateThread(db: Db, threadId: string, eventId: string | null) {
  await db.insert(chatThreads).values({ id: threadId, eventId }).onConflictDoNothing();
  const thread = await getThread(db, threadId);
  if (!thread) throw new Error('Could not load chat thread');
  return thread;
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
