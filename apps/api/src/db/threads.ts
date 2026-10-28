import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { CHAT_TITLE_MAX_LENGTH, type ChatThreadPatchRequest } from '@quartermaster/shared';
import type { Db } from './client.js';
import { chatThreads, events } from './schema.js';

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

// Archived and never-messaged threads are left out; newest first.
export async function listThreadSummaries(db: Db, ids: string[]) {
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

// Returns false when the thread does not exist.
export async function updateThread(db: Db, threadId: string, patch: ChatThreadPatchRequest) {
  const set: Partial<typeof chatThreads.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title.slice(0, CHAT_TITLE_MAX_LENGTH);
  if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;
  const updated = await db
    .update(chatThreads)
    .set(set)
    .where(eq(chatThreads.id, threadId))
    .returning({ id: chatThreads.id });
  return updated.length > 0;
}
