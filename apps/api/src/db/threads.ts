import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { CHAT_TITLE_MAX_LENGTH, type ChatThreadPatchRequest } from '@leonid/shared';
import type { Db } from './client.js';
import { ownerThread } from './mandates.js';
import { chatThreads, events, mandateItems, mandates } from './schema.js';

const AUTO_TITLE_MAX = 60;

// Deterministic title from the first user message: no LLM call, cut on a word boundary.
export function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= AUTO_TITLE_MAX) return flat || 'New chat';
  const cut = flat.slice(0, AUTO_TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export async function setTitleIfMissing(db: Db, threadId: string, text: string) {
  await db
    .update(chatThreads)
    .set({ title: titleFrom(text) })
    .where(and(eq(chatThreads.id, threadId), isNull(chatThreads.title)));
}

// Archived, never-messaged and other people's threads are left out; newest first.
export async function listThreadSummaries(db: Db, ids: string[], owner: string | null) {
  const rows = await db
    .select({
      id: chatThreads.id,
      title: chatThreads.title,
      updatedAt: chatThreads.updatedAt,
      eventId: events.id,
      eventName: events.name,
    })
    .from(chatThreads)
    .leftJoin(events, eq(events.id, chatThreads.eventId))
    .where(
      and(
        inArray(chatThreads.id, ids),
        owner === null ? undefined : eq(chatThreads.ownerSub, owner),
        isNull(chatThreads.archivedAt),
        sql`jsonb_array_length(${chatThreads.messages}) > 0`,
      ),
    )
    .orderBy(desc(chatThreads.updatedAt));
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? 'New chat',
    updatedAt: row.updatedAt.toISOString(),
    event: row.eventId && row.eventName ? { id: row.eventId, name: row.eventName } : null,
  }));
}

// Returns false when the thread does not exist or is not this owner's.
export async function updateThread(
  db: Db,
  threadId: string,
  patch: ChatThreadPatchRequest,
  owner: string | null,
) {
  const set: Partial<typeof chatThreads.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title.slice(0, CHAT_TITLE_MAX_LENGTH);
  if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;
  const updated = await db
    .update(chatThreads)
    .set(set)
    .where(ownerThread(threadId, owner))
    .returning({ id: chatThreads.id });
  return updated.length > 0;
}

// Removes the thread with its checklist for good. Events it created and audit rows stay: they are
// event and money history, not chat. Returns false when the thread does not exist or is not this owner's.
export async function deleteThread(db: Db, threadId: string, owner: string | null) {
  return db.transaction(async (tx) => {
    const [thread] = await tx
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(ownerThread(threadId, owner))
      .for('update');
    if (!thread) return false;
    const owned = tx
      .select({ id: mandates.id })
      .from(mandates)
      .where(eq(mandates.threadId, threadId));
    await tx.delete(mandateItems).where(inArray(mandateItems.mandateId, owned));
    await tx.delete(mandates).where(eq(mandates.threadId, threadId));
    const deleted = await tx
      .delete(chatThreads)
      .where(eq(chatThreads.id, threadId))
      .returning({ id: chatThreads.id });
    return deleted.length > 0;
  });
}
