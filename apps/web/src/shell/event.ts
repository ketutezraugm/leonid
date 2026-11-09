import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMatch } from 'react-router-dom';
import { EventsResponse } from '@leonid/shared';
import { useFetch } from './api';

// Leonid runs several events (UX plan 3, "Multiple events"). Every event screen lives under
// /events/:eventId/ and reads its event through useEvent(), never a constant, so the API and a switcher
// change only this file.

// The seeded demo event (OpenHack 2027), shown under the route id "demo" until GET /api/events exists.
export const EVENT = {
  name: 'OpenHack 2027',
  date: '2027-03-14',
  people: 200,
  currency: 'USD',
} as const;

export const DEMO_ROUTE_ID = 'demo';

export interface EventInfo {
  /** The event's API id, sent as ?eventId=. Null for the demo fallback: the server then uses the seeded event. */
  id: string | null;
  /** The id in the URL: the API id, or "demo" for the fallback. */
  routeId: string;
  name: string;
  /** ISO date, e.g. 2027-03-14. */
  date: string;
  people: number;
  /** ISO 4217 currency code, e.g. USD. */
  currency: string;
  /** The setup answers as the agent's first message; the chat offers to start planning with it. */
  brief?: string | null;
  /** The most the agent may commit for this event, in minor units. Null or missing: none set. */
  maxSpend?: number | null;
}

const DEMO_EVENT: EventInfo = { id: null, routeId: DEMO_ROUTE_ID, ...EVENT };

const DAY_MS = 86_400_000;

export function daysUntil(isoDate: string, now = new Date()): number {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / DAY_MS);
}

export function formatEventDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatLongDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function countdown(isoDate: string): string {
  const days = daysUntil(isoDate);
  if (days > 1) return `${days} days to go`;
  if (days === 1) return '1 day to go';
  if (days === 0) return 'Today';
  return 'Event over';
}

/** A path inside one event: eventPath('demo', 'plan') is /events/demo/plan. */
export function eventPath(routeId: string, sub = ''): string {
  const rest = sub.replace(/^\/+/, '');
  return `/events/${encodeURIComponent(routeId)}${rest ? `/${rest}` : ''}`;
}

/** Adds ?eventId= for event-scoped API calls; the demo fallback sends none, so the server uses the seeded event. */
export function withEvent(url: string, event: Pick<EventInfo, 'id'>): string {
  if (!event.id) return url;
  return `${url}${url.includes('?') ? '&' : '?'}eventId=${encodeURIComponent(event.id)}`;
}

// --- The list of events

export interface EventsState {
  /** loading; ready (from the API, possibly empty); fallback (the API is missing or failed: the demo event). */
  kind: 'loading' | 'ready' | 'fallback';
  events: EventInfo[];
  /** Fetch the list again quietly (no loading state), e.g. after setup created an event. */
  refresh: () => void;
}

const FALLBACK: EventsState = { kind: 'fallback', events: [DEMO_EVENT], refresh: () => {} };
const EventsContext = createContext<EventsState>(FALLBACK);

export function EventsProvider({ children }: { children: ReactNode }) {
  const list = useFetch('/api/events', EventsResponse);
  const data = list.kind === 'ready' ? list.data : null;
  const { refresh } = list;
  const value = useMemo<EventsState>(() => {
    if (list.kind === 'loading') return { kind: 'loading', events: [], refresh };
    if (data) return { kind: 'ready', events: data.events.map((e) => ({ ...e, routeId: e.id })), refresh };
    return { ...FALLBACK, refresh };
  }, [list.kind, data, refresh]);
  return createElement(EventsContext.Provider, { value }, children);
}

export function useEvents(): EventsState {
  return useContext(EventsContext);
}

// --- The current event

const LAST_KEY = 'leonid.lastEventId';

export function rememberEvent(routeId: string) {
  try {
    localStorage.setItem(LAST_KEY, routeId);
  } catch {
    // Storage can be blocked; old links then open the first event.
  }
}

function lastEventId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/** The :eventId in the URL, from anywhere in the app (layouts included). */
export function useEventRouteId(): string | null {
  return useMatch('/events/:eventId/*')?.params.eventId ?? null;
}

/** The event the URL points at, or null outside an event (All events, Settings) or while the list loads. */
export function useCurrentEvent(): EventInfo | null {
  const routeId = useEventRouteId();
  const { events } = useEvents();
  if (!routeId) return null;
  return events.find((e) => e.routeId === routeId) ?? null;
}

/**
 * The event every screen is working on. Inside /events/:eventId/ it is that event; elsewhere it is the event
 * opened last, or the first one. Always an object, and the same object between renders.
 */
export function useEvent(): EventInfo {
  const current = useCurrentEvent();
  const { events } = useEvents();
  if (current) return current;
  const last = lastEventId();
  return events.find((e) => e.routeId === last) ?? events[0] ?? DEMO_EVENT;
}

/** Builds paths inside the current event: path('approvals') is /events/<id>/approvals. */
export function useEventPath(): (sub?: string) => string {
  const { routeId } = useEvent();
  return useCallback((sub = '') => eventPath(routeId, sub), [routeId]);
}
