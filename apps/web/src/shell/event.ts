import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMatch } from 'react-router-dom';
import { EventsResponse, type EventSummary } from '@quartermaster/shared';
import { getJson } from './api';

// Quartermaster runs several events (UX plan 3, "Multiple events"). Every event screen lives under
// /events/:eventId/ and reads its event through useEvent(), never a constant, so the API and a switcher
// change only this file.

// The seeded demo event (OpenHack 2027), always the first event, under the route id "demo". GET /api/events lists
// only the events a person made, so the demo is never in it and a fresh database without the seed still works.
export const EVENT = {
  name: 'OpenHack 2027',
  date: '2027-03-14',
  endDate: '2027-03-14',
  people: 200,
  currency: 'USD',
  budgetTotalMinor: 800_000,
  categories: [] as string[],
  city: null as string | null,
};

export const DEMO_ROUTE_ID = 'demo';

export interface EventInfo {
  /** The event's API id, sent as ?eventId=. Null for the demo fallback: the server then uses the seeded event. */
  id: string | null;
  /** The id in the URL: the API id, or "demo" for the fallback. */
  routeId: string;
  name: string;
  /** ISO date, e.g. 2027-03-14. */
  date: string;
  /** ISO date of the last day; equals `date` for a one-day event. */
  endDate: string;
  people: number;
  /** ISO 4217 currency code, e.g. USD. */
  currency: string;
  /** The planned total in minor units: a target, not spendable money. */
  budgetTotalMinor: number;
  categories: string[];
  /** Where the event is, when the organiser said. */
  city: string | null;
}

const DEMO_EVENT: EventInfo = { id: null, routeId: DEMO_ROUTE_ID, ...EVENT };

/** The seeded demo event has no API id; every other event does. Its screens keep the sample data they always had. */
export const isDemoEvent = (event: Pick<EventInfo, 'id'>) => event.id === null;

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

/** "Mar 14" for a one-day event, "Mar 14 – Mar 16" for a longer one. */
export function formatDateRange(start: string, end: string): string {
  return end > start ? `${formatEventDate(start)} – ${formatEventDate(end)}` : formatEventDate(start);
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
  /** loading; ready (the demo event plus the person's own); fallback (the API is missing or failed: the demo event only). */
  kind: 'loading' | 'ready' | 'fallback';
  events: EventInfo[];
  /** Fetches the list again. A failure keeps the list the screen already has. */
  refresh: () => void;
  /** Adds an event the person just created, so its screens open at once, then refreshes. Works when the list never loaded. */
  add: (event: EventSummary) => void;
}

const noop = () => {};
const FALLBACK: EventsState = { kind: 'fallback', events: [DEMO_EVENT], refresh: noop, add: noop };
const EventsContext = createContext<EventsState>(FALLBACK);

const toInfo = (e: EventSummary): EventInfo => ({ ...e, routeId: e.id });

interface OwnEvents {
  kind: EventsState['kind'];
  own: EventInfo[];
}

export function EventsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OwnEvents>({ kind: 'loading', own: [] });

  // A load merges into what is shown: an event added a moment ago stays even if a slower, older response lacks it
  // (events are never deleted here, so nothing shown can be stale-but-gone).
  const load = useCallback(() => {
    getJson('/api/events', EventsResponse).then(
      (data) =>
        setState((prev) => {
          const fresh = data.events.map(toInfo);
          const kept = prev.own.filter((e) => !fresh.some((f) => f.id === e.id));
          return { kind: 'ready', own: [...fresh, ...kept] };
        }),
      () => setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'fallback', own: [] })),
    );
  }, []);

  useEffect(load, [load]);

  const add = useCallback(
    (event: EventSummary) => {
      setState((prev) => ({
        kind: 'ready',
        own: prev.own.some((e) => e.id === event.id) ? prev.own : [...prev.own, toInfo(event)],
      }));
      load();
    },
    [load],
  );

  const value = useMemo<EventsState>(
    () => ({
      kind: state.kind,
      events: state.kind === 'loading' ? [] : [DEMO_EVENT, ...state.own],
      refresh: load,
      add,
    }),
    [state, load, add],
  );
  return createElement(EventsContext.Provider, { value }, children);
}

export function useEvents(): EventsState {
  return useContext(EventsContext);
}

// --- The current event

const LAST_KEY = 'quartermaster.lastEventId';

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

/** What the agent chat needs to follow the screen's event: its route id, and the event itself unless it is the demo. */
export function useChatEvent(): { eventScope: string | null; currentEvent: { id: string; name: string } | null } {
  const eventScope = useEventRouteId();
  const current = useCurrentEvent();
  return { eventScope, currentEvent: current?.id ? { id: current.id, name: current.name } : null };
}
