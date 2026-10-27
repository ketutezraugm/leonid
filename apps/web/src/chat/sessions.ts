import { CHAT_LOOKUP_MAX_IDS } from '@quartermaster/shared';

const ACTIVE_KEY = 'quartermaster.threadId';
const IDS_KEY = 'quartermaster.threadIds';

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
