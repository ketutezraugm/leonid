import { z } from 'zod';

// API contract shared by apps/web and apps/api. Change by pull request only.

export const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.string(),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ApiError = z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiError>;

// Agent chat (Event home). The server owns the thread history; the client sends only the new message.

export const CHAT_MESSAGE_MAX_LENGTH = 4000;

export const ChecklistItem = z.object({
  title: z.string().trim().min(1).max(200),
  status: z.enum(['pending', 'in_progress', 'done', 'blocked']),
  note: z.string().trim().max(500).optional(),
  blockedOn: z.string().trim().max(200).optional(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

// The event a chat works on. Each chat sees only its own event, never another chat's plan.
export const ChatEventRef = z.object({ id: z.uuid(), name: z.string() });
export type ChatEventRef = z.infer<typeof ChatEventRef>;

export const AgentChatRequest = z.object({
  threadId: z.uuid(),
  // Read only when this message creates the thread: the existing event the user chose to let this
  // chat see. Omitted, the chat starts with no event and the agent creates one when asked.
  eventId: z.uuid().optional(),
  message: z.object({
    id: z.string().min(1).max(100),
    role: z.literal('user'),
    parts: z
      .array(
        z.object({
          type: z.literal('text'),
          text: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
        }),
      )
      .length(1),
  }),
});
export type AgentChatRequest = z.infer<typeof AgentChatRequest>;

// GET /api/chat/:threadId. Messages are AI SDK UI messages; the web validates them in useChat.
export const ChatThreadResponse = z.object({
  messages: z.array(z.unknown()),
  checklist: z.array(ChecklistItem),
  event: ChatEventRef.nullable().default(null),
});
export type ChatThreadResponse = z.infer<typeof ChatThreadResponse>;

// Chat sessions. The browser remembers its own thread ids and asks for their summaries, so one
// visitor never sees another's chats until there is a login to scope them by.

export const CHAT_TITLE_MAX_LENGTH = 80;
export const CHAT_LOOKUP_MAX_IDS = 50;

export const ChatThreadSummary = z.object({
  id: z.uuid(),
  title: z.string(),
  updatedAt: z.string(),
  event: ChatEventRef.nullable().default(null),
});
export type ChatThreadSummary = z.infer<typeof ChatThreadSummary>;

export const ChatThreadLookupRequest = z.object({
  ids: z.array(z.uuid()).min(1).max(CHAT_LOOKUP_MAX_IDS),
});
export type ChatThreadLookupRequest = z.infer<typeof ChatThreadLookupRequest>;

// demoEvent is the seeded event, which any new chat may be pointed at.
export const ChatThreadListResponse = z.object({
  threads: z.array(ChatThreadSummary),
  demoEvent: ChatEventRef.nullable().default(null),
});
export type ChatThreadListResponse = z.infer<typeof ChatThreadListResponse>;

export const ChatThreadPatchRequest = z
  .object({
    title: z.string().trim().min(1).max(CHAT_TITLE_MAX_LENGTH),
    archived: z.boolean(),
  })
  .partial()
  .refine((patch) => patch.title !== undefined || patch.archived !== undefined, {
    message: 'Nothing to change',
  });
export type ChatThreadPatchRequest = z.infer<typeof ChatThreadPatchRequest>;

// Venue research (venue scout agent). Every figure carries a quote copied from a page the agent
// read; the server drops any figure whose quote is not on such a page. All of it is unverified
// until the organizer confirms with the venue.

export const VenueCandidate = z.object({
  name: z.string().trim().min(1).max(120),
  area: z.string().trim().max(120).optional(),
  sourceUrls: z.array(z.url()).min(1).max(5),
  capacity: z.object({ value: z.number().int().positive(), quote: z.string().max(300) }).nullable(),
  price: z
    .object({
      // IDR has no minor unit, so this is whole rupiah.
      amountMinor: z.number().int().positive(),
      currency: z.string().length(3),
      per: z.enum(['pax', 'package', 'hour', 'day']),
      quote: z.string().max(300),
    })
    .nullable(),
  cateringIncluded: z.enum(['yes', 'no', 'unknown']),
  cateringQuote: z.string().max(300).optional(),
  booking: z.enum(['whatsapp', 'phone', 'website', 'unknown']),
  contact: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});
export type VenueCandidate = z.infer<typeof VenueCandidate>;
export * from './common.js';
export * from './sponsor.js';
export * from './invoice.js';
export * from './ledger.js';
export * from './payout.js';
export * from './claim.js';
export * from './widgets.js';
export * from './approvals.js';
export * from './treasury.js';
