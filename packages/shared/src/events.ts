import { z } from 'zod';
import { CurrencyCode, IsoDate, MinorUnits } from './common.js';

// Quartermaster runs several events (decided Oct 31). GET /api/events lists the signed-in organiser's own events
// (the seeded demo event is not in it: the web always adds it); POST /api/events creates one (the setup flow, step 1)
// and answers 201 with CreateEventResponse. Both are treasurer only.
// Every event-scoped endpoint takes ?eventId=<id>; when it is missing, a read uses the seeded demo event, so a
// client that does not send it yet keeps working. Nothing that moves money falls back: a spend with no event is
// blocked by the rules check.
// Shared by every event: the treasury PayPal account (its money is tracked per event in the ledger) and the
// agent wallet, so the kill switch stops the agent in all of them.

export const EVENT_PEOPLE_MAX = 100_000;
// budget_total is a Postgres integer, so this stays below 2^31 - 1.
export const EVENT_BUDGET_MAX_MINOR = 1_000_000_000;
export const EVENT_CATEGORIES_MAX = 12;
export const EVENT_CATEGORY_MAX_LENGTH = 40;
export const EVENT_CITY_MAX_LENGTH = 100;

const EventName = z.string().trim().min(1).max(120);

// The response schema has no caps on purpose: one odd row must not fail the parse of the whole list.
export const EventSummary = z.object({
  id: z.uuid(),
  name: EventName,
  // First day of the event; endDate is the last day (the same day for a one-day event).
  date: IsoDate,
  endDate: IsoDate,
  people: z.number().int().positive(),
  currency: CurrencyCode,
  // The event's total budget: a target the organiser plans around, not spendable money. What can be spent is the
  // unlocked budget (cleared income only).
  budget: MinorUnits,
  categories: z.array(z.string()),
  // Where the event is, when the organiser said. The agent searches venues there.
  city: z.string().nullable().default(null),
});
export type EventSummary = z.infer<typeof EventSummary>;

export const EventsResponse = z.object({ events: z.array(EventSummary) });
export type EventsResponse = z.infer<typeof EventsResponse>;

// A past date is refused by the route, which has the clock; the schema cannot. endDate is optional (one-day event).
export const CreateEventRequest = z
  .object({
  name: EventName,
  date: IsoDate,
  endDate: IsoDate.optional(),
  people: z.number().int().positive().max(EVENT_PEOPLE_MAX),
  currency: CurrencyCode,
  budget: MinorUnits.max(EVENT_BUDGET_MAX_MINOR),
  categories: z.array(z.string().trim().min(1).max(EVENT_CATEGORY_MAX_LENGTH)).max(EVENT_CATEGORIES_MAX).default([]),
  city: z.string().trim().min(1).max(EVENT_CITY_MAX_LENGTH).optional(),
  })
  .refine((e) => !e.endDate || e.endDate >= e.date, { path: ['endDate'], message: 'The last day cannot be before the first day' });
export type CreateEventRequest = z.input<typeof CreateEventRequest>;

export const CreateEventResponse = z.object({ event: EventSummary });
export type CreateEventResponse = z.infer<typeof CreateEventResponse>;

// GET /api/events/:eventId/overview: what Event home and Plan show for an event other than the demo.
export const EventTask = z.object({
  id: z.uuid(),
  name: z.string(),
  start: IsoDate,
  end: IsoDate,
  deadline: IsoDate.nullable(),
});
export type EventTask = z.infer<typeof EventTask>;

export const EventOverview = z.object({
  // Cleared income minus committed spend, never negative. Pledged and invoiced money is not in it.
  unlockedMinor: MinorUnits,
  tasks: z.array(EventTask),
});
export type EventOverview = z.infer<typeof EventOverview>;
