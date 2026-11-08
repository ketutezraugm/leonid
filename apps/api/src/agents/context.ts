import type { LanguageModel } from 'ai';
import { writeAudit } from '../db/audit.js';
import type { Db } from '../db/client.js';
import type { BookingChoice, VenuePick } from '@quartermaster/shared';
import type { SearchClient } from '../search/client.js';

// Everything a tool may touch, scoped to one thread and its event by the route. Tools get this by
// closure; no agent receives a raw DB handle, a PayPal client or a generic HTTP tool.
export interface AgentContext {
  db: Db;
  // The chat's own event. Null until create_event runs, which sets it for the rest of the run;
  // tools read it at call time and never fall back to another event.
  eventId: string | null;
  threadId: string;
  // The user's latest message, used as the mandate's goal when the checklist is first created.
  goal: string;
  model: LanguageModel;
  // Venue search backend. Absent means the venue scout is not offered at all.
  search?: SearchClient | null;
  // What the organizer chose to book, read by the route from their own messages. Null until they
  // choose; planning refuses to start before then.
  bookings?: BookingChoice | null;
  // The venue the organizer picked from the scout's results, read from their own messages.
  venuePick?: VenuePick | null;
  // The picked venue's plan and payment status as facts for the instructions, built by code from the event, the catalog and
  // our own payment records. Null until a catalog venue is picked in a chat with an event.
  bookingPlan?: string | null;
  // The run's clock, so tests can pin "today". Defaults to the real time.
  now?: Date;
}

// Today's date in UTC as YYYY-MM-DD, the format every agent date uses.
export function todayIso(ctx: AgentContext): string {
  return (ctx.now ?? new Date()).toISOString().slice(0, 10);
}

// Agents do not know today's date unless told; without it they ask for the year or plan in the past.
export function todayLine(ctx: AgentContext): string {
  const today = (ctx.now ?? new Date()).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    `Today is ${today} (${todayIso(ctx)}). Resolve partial and relative dates ("7 November", ` +
    '"next Saturday") to the first matching day on or after today, and never ask for the year.'
  );
}

export function requireEvent(ctx: AgentContext): string {
  if (!ctx.eventId)
    throw new Error('This chat has no event yet. Create it with create_event first.');
  return ctx.eventId;
}

// Every tool takes a one-sentence reason; it becomes the audit log's reasoning summary.
// `summarize`, when given, records what the tool produced next to the model's input, as `result`.
export function auditedExecute<Input extends { reason?: string }, Output>(
  ctx: AgentContext,
  actor: string,
  action: string,
  run: (input: Input) => Promise<Output>,
  summarize?: (output: Output) => unknown,
) {
  return async (input: Input): Promise<Output> => {
    try {
      const output = await run(input);
      const audited = summarize ? { ...input, result: summarize(output) } : input;
      await writeAudit(ctx.db, { actor, action, input: audited, reason: input.reason });
      return output;
    } catch (err) {
      await writeAudit(ctx.db, {
        actor,
        action,
        input,
        reason: `failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  };
}

// Same audit contract as auditedExecute, for tools that yield progress before their final value.
// Every yield but the last reaches the browser as a preliminary output.
export function auditedStream<Input extends { reason?: string }, Output>(
  ctx: AgentContext,
  actor: string,
  action: string,
  run: (input: Input) => AsyncGenerator<Output, void>,
) {
  return async function* (input: Input): AsyncGenerator<Output, void> {
    try {
      yield* run(input);
      await writeAudit(ctx.db, { actor, action, input, reason: input.reason });
    } catch (err) {
      await writeAudit(ctx.db, {
        actor,
        action,
        input,
        reason: `failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  };
}
