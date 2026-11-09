import { z } from 'zod';
import { CurrencyCode, IsoDate, MinorUnits } from './common.js';

// Quartermaster runs several events (decided Oct 31). GET /api/events lists the events, soonest first;
// POST /api/events creates one (the setup flow, step 1) and answers 201 with its EventSummary. Both are
// treasurer only. Every event-scoped endpoint takes ?eventId=<id>; when it is
// missing, a read uses the seeded demo event, so a client that does not send it yet keeps working. Nothing that
// moves money falls back: a spend with no event is blocked by the rules check.
// Shared by every event: the treasury PayPal account (its money is tracked per event in the ledger) and the
// agent wallet, so the kill switch stops the agent in all of them.
export const EventSummary = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  date: IsoDate,
  people: z.number().int().positive(),
  budget: MinorUnits.positive(), // the event's total budget, in minor units; only cleared income is ever spendable
  currency: CurrencyCode,
  // Every setup answer as the agent's first message (kind, city, venue, what to book...). Saved with the event so
  // the organizer can start planning later from the agent chat. Null for events made without the setup interview.
  // At most CHAT_MESSAGE_MAX_LENGTH (not imported: index.ts re-exports this file).
  brief: z.string().trim().min(1).max(4000).nullable().optional(),
  // The most the agent may commit for this event, set by the organizer. Null or missing: no maximum is set.
  maxSpend: MinorUnits.positive().nullable().optional(),
});
export type EventSummary = z.infer<typeof EventSummary>;

export const EventsResponse = z.object({ events: z.array(EventSummary) });
export type EventsResponse = z.infer<typeof EventsResponse>;

export const CreateEventRequest = EventSummary.omit({ id: true, maxSpend: true });
export type CreateEventRequest = z.infer<typeof CreateEventRequest>;

// PUT /api/events/:id/max-spend (treasurer only) sets the event's maximum spend and answers its EventSummary. null clears it.
export const SetMaxSpendRequest = z.object({ maxSpend: MinorUnits.positive().nullable() });
export type SetMaxSpendRequest = z.infer<typeof SetMaxSpendRequest>;
