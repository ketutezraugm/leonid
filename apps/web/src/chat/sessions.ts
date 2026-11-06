import { CHAT_LOOKUP_MAX_IDS } from '@quartermaster/shared';

const ACTIVE_KEY = 'quartermaster.threadId';
const IDS_KEY = 'quartermaster.threadIds';

// Per-viewer conveniences only: every access is wrapped because storage can throw (private
// windows, blocked data). Without it sessions just do not survive a reload.

export function newThreadId(): string {
  return crypto.randomUUID();
}

// Each event remembers its own open chat. The demo event, and screens outside any event, keep the original key, so a
// browser that already has a chat open still finds it.
const activeKey = (scope?: string | null) => (scope && scope !== 'demo' ? `${ACTIVE_KEY}.${scope}` : ACTIVE_KEY);

export function loadActiveId(scope?: string | null): string {
  try {
    const stored = localStorage.getItem(activeKey(scope));
    if (stored) return stored;
  } catch {
    // fall through to a fresh id
  }
  const id = newThreadId();
  saveActiveId(id, scope);
  return id;
}

export function saveActiveId(id: string, scope?: string | null) {
  try {
    localStorage.setItem(activeKey(scope), id);
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
