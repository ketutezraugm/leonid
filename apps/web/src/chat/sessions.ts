import { CHAT_LOOKUP_MAX_IDS } from '@leonid/shared';

const ACTIVE_KEY = 'leonid.threadId';
const IDS_KEY = 'leonid.threadIds';

// Per-viewer conveniences only: every access is wrapped because storage can throw (private
// windows, blocked data). Without it sessions just do not survive a reload.

export function newThreadId(): string {
  return crypto.randomUUID();
}

export function loadActiveId(): string {
  try {
    const stored = localStorage.getItem(ACTIVE_KEY);
    if (stored) return stored;
  } catch {
    // fall through to a fresh id
  }
  const id = newThreadId();
  saveActiveId(id);
  return id;
}

export function saveActiveId(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
}

export function loadIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(IDS_KEY) ?? '[]');
    if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    // ignore
  }
  return [];
}

export function saveIds(ids: string[]) {
  try {
    localStorage.setItem(IDS_KEY, JSON.stringify(ids.slice(0, CHAT_LOOKUP_MAX_IDS)));
  } catch {
    // ignore
  }
}

// The agent's first message from event setup: setup saves it with a fresh chat id, and that chat
// sends it once it opens. Session storage, so a stale one never outlives the tab.
const KICKOFF_KEY = 'leonid.kickoff';

export interface Kickoff {
  threadId: string;
  eventId: string;
  eventName: string;
  text: string;
}

export function saveKickoff(kickoff: Kickoff) {
  try {
    sessionStorage.setItem(KICKOFF_KEY, JSON.stringify(kickoff));
  } catch {
    // ignore: the chat opens empty and the organizer can describe the event
  }
}

// The kickoff waiting for this chat, if any, left in place.
export function peekKickoff(threadId: string): Kickoff | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KICKOFF_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const { threadId: id, eventId, eventName, text } = parsed as Record<string, unknown>;
    if (id !== threadId || typeof eventId !== 'string' || typeof text !== 'string') return null;
    return { threadId, eventId, eventName: typeof eventName === 'string' ? eventName : '', text };
  } catch {
    return null;
  }
}

// Returns and removes the kickoff for this chat, so it is sent at most once.
export function takeKickoff(threadId: string): Kickoff | null {
  const kickoff = peekKickoff(threadId);
  if (!kickoff) return null;
  try {
    sessionStorage.removeItem(KICKOFF_KEY);
  } catch {
    return null;
  }
  return kickoff;
}

// Newest ids first, no duplicates, capped to what one lookup accepts.
export function withId(ids: string[], id: string): string[] {
  return [id, ...ids.filter((existing) => existing !== id)].slice(0, CHAT_LOOKUP_MAX_IDS);
}

export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
