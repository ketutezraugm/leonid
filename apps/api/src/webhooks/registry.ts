import { z } from 'zod';

export type WebhookApp = 'treasury' | 'procurement';

export const WebhookEvent = z.looseObject({
  id: z.string(),
  event_type: z.string(),
  create_time: z.string().optional(),
  resource: z.unknown(),
});
export type WebhookEvent = z.infer<typeof WebhookEvent>;

// Handlers must be idempotent in effect: PayPal retries, and a failed handler is retried too.
export type WebhookHandler = (event: WebhookEvent, ctx: { app: WebhookApp }) => Promise<void>;

export function createHandlerRegistry() {
  const handlers = new Map<string, WebhookHandler[]>();
  return {
    register(eventType: string, handler: WebhookHandler) {
      handlers.set(eventType, [...(handlers.get(eventType) ?? []), handler]);
    },
    async dispatch(app: WebhookApp, event: WebhookEvent) {
      for (const handler of handlers.get(event.event_type) ?? []) await handler(event, { app });
    },
  };
}
export type HandlerRegistry = ReturnType<typeof createHandlerRegistry>;

// Shared registry: P3 and P4 call registerHandler('INVOICING.INVOICE.PAID', ...) from their own files.
export const webhookHandlers = createHandlerRegistry();
export const registerHandler = webhookHandlers.register;

// Remembers which PayPal event ids were already processed.
export interface EventStore {
  claim(eventId: string): Promise<boolean>; // false when already claimed
  release(eventId: string): Promise<void>; // undo a claim after a failed handler, so PayPal's retry runs again
}

// ponytail: in memory, so a restart forgets event ids. Swap for a webhook_events table once the DB owner agrees the schema.
export function createMemoryEventStore(): EventStore {
  const seen = new Set<string>();
  return {
    async claim(id) {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    async release(id) {
      seen.delete(id);
    },
  };
}
