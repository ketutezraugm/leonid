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
});
export type EventSummary = z.infer<typeof EventSummary>;

export const EventsResponse = z.object({ events: z.array(EventSummary) });
export type EventsResponse = z.infer<typeof EventsResponse>;

export const CreateEventRequest = EventSummary.omit({ id: true });
export type CreateEventRequest = z.infer<typeof CreateEventRequest>;
