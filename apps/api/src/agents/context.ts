import type { LanguageModel } from 'ai';
import { writeAudit } from '../db/audit.js';
import type { Db } from '../db/client.js';
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
  // Web research backend. Absent means the venue scout is not offered at all.
  search?: SearchClient | null;
}

export function requireEvent(ctx: AgentContext): string {
  if (!ctx.eventId) throw new Error('This chat has no event yet. Create it with create_event first.');
  return ctx.eventId;
}

// Every tool takes a one-sentence reason; it becomes the audit log's reasoning summary.
export function auditedExecute<Input extends { reason?: string }, Output>(
  ctx: AgentContext,
  actor: string,
  action: string,
  run: (input: Input) => Promise<Output>,
) {
  return async (input: Input): Promise<Output> => {
    try {
      const output = await run(input);
      await writeAudit(ctx.db, { actor, action, input, reason: input.reason });
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
