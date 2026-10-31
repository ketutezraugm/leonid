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

// The agent's clarifying questions (ask_user tool). The chat shows them as choices; the user picks
// options or writes their own, and the answers come back as the next user message.
export const AskUserOption = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
});
export type AskUserOption = z.infer<typeof AskUserOption>;

export const AskUserQuestion = z.object({
  header: z.string().trim().min(1).max(24).describe('Short label, e.g. "Date" or "Venue"'),
  question: z.string().trim().min(1).max(300),
  options: z.array(AskUserOption).min(2).max(4),
  multiSelect: z.boolean().default(false),
});
export type AskUserQuestion = z.infer<typeof AskUserQuestion>;

export const AskUserInput = z.object({
  questions: z.array(AskUserQuestion).min(1).max(4),
});
export type AskUserInput = z.infer<typeof AskUserInput>;

// What the organizer wants to book for the event (choose_bookings tool). The list is fixed here,
// not written by the agent, so a first-time organizer sees every usual cost and nothing invented.
export const BookingItemId = z.enum([
  'venue',
  'catering',
  'av',
  'swag',
  'prizes',
  'speakers',
  'printing',
  'photography',
]);
export type BookingItemId = z.infer<typeof BookingItemId>;

// `available: false` items are shown as in development: they cannot be ticked, and the server drops
// them from a choice. Only the venue has demo data (the seeded venue catalog) and a PayPal deposit.
export const BOOKING_ITEMS: readonly {
  id: BookingItemId;
  label: string;
  description: string;
  available: boolean;
}[] = [
  { id: 'venue', label: 'Venue', description: 'The space; often needs a deposit', available: true },
  {
    id: 'catering',
    label: 'Food & drinks',
    description: 'Usually priced per person',
    available: false,
  },
  {
    id: 'av',
    label: 'AV & Wi-Fi',
    description: 'Projector, mics, a faster connection',
    available: false,
  },
  {
    id: 'swag',
    label: 'Swag',
    description: 'Lanyards, stickers, shirts; weeks to ship',
    available: false,
  },
  {
    id: 'prizes',
    label: 'Prizes',
    description: 'For winners, if there is a competition',
    available: false,
  },
  {
    id: 'speakers',
    label: 'Speakers & volunteers',
    description: 'Travel, thank-you payments',
    available: false,
  },
  {
    id: 'printing',
    label: 'Printing & signage',
    description: 'Badges, banners, directions',
    available: false,
  },
  {
    id: 'photography',
    label: 'Photo & video',
    description: 'Someone to capture the day',
    available: false,
  },
];

export const isBookingAvailable = (id: BookingItemId) =>
  BOOKING_ITEMS.some((item) => item.id === id && item.available);

export const ChooseBookingsInput = z.object({
  suggested: z
    .array(BookingItemId)
    .max(BOOKING_ITEMS.length)
    .default([])
    .describe('Items to pre-tick for this kind of event; the organizer decides'),
});
export type ChooseBookingsInput = z.infer<typeof ChooseBookingsInput>;

export interface BookingChoice {
  chosen: BookingItemId[];
  // The organizer's own words for anything not on the list.
  extra: string | null;
}

const BOOK_PREFIX = 'Book for this event:';
const SKIP_PREFIX = 'Not needed:';
const EXTRA_PREFIX = 'Also:';

// The organizer's answer travels as a normal chat message, so it reads well in the thread and the
// server can read the choice back from history with parseBookingChoice.
export function bookingChoiceText({ chosen, extra }: BookingChoice): string {
  const labels = (ids: readonly BookingItemId[]) =>
    BOOKING_ITEMS.filter((item) => ids.includes(item.id))
      .map((item) => item.label)
      .join(', ') || 'nothing from the list';
  const skipped = BOOKING_ITEMS.filter((item) => item.available && !chosen.includes(item.id)).map(
    (i) => i.id,
  );
  return [
    `${BOOK_PREFIX} ${labels(chosen)}`,
    skipped.length > 0 && `${SKIP_PREFIX} ${labels(skipped)}`,
    extra?.trim() && `${EXTRA_PREFIX} ${extra.trim()}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseBookingChoice(text: string): BookingChoice | null {
  const lines = text.split('\n').map((line) => line.trim());
  const book = lines.find((line) => line.startsWith(BOOK_PREFIX));
  if (book === undefined) return null;
  const named = book
    .slice(BOOK_PREFIX.length)
    .split(',')
    .map((label) => label.trim().toLowerCase());
  const extra = lines.find((line) => line.startsWith(EXTRA_PREFIX));
  return {
    // In-development items never count, even if typed into the message by hand.
    chosen: BOOKING_ITEMS.filter(
      (item) => item.available && named.includes(item.label.toLowerCase()),
    ).map((item) => item.id),
    extra: extra ? extra.slice(EXTRA_PREFIX.length).trim() || null : null,
  };
}

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

// How a seeded venue charges, copied from its listing by code and never by the model.
export const VenueAddOn = z.object({
  name: z.string().min(1).max(80),
  // Same currency as the venue's price. "person" scales with the headcount.
  amountMinor: z.number().int().positive(),
  unit: z.enum(['person', 'hour', 'event']),
  // Required add-ons are part of the real cost (chairs in an empty hall); the rest are extras.
  required: z.boolean(),
});
export type VenueAddOn = z.infer<typeof VenueAddOn>;

export const VenueTerms = z.object({
  // Per-person packages bill at least this many people.
  minPax: z.number().int().positive().nullable(),
  // Hourly hire bills at least this many hours.
  minHours: z.number().int().positive().nullable(),
  includes: z.array(z.string().min(1).max(120)).max(8),
  addOns: z.array(VenueAddOn).max(8),
  // Tax and service added on top of the price. 0 means the price already includes them.
  taxPercent: z.number().int().min(0).max(30),
});
export type VenueTerms = z.infer<typeof VenueTerms>;

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
  // Set by the server for seeded venues; absent on older results.
  terms: VenueTerms.optional(),
});
export type VenueCandidate = z.infer<typeof VenueCandidate>;

// The venue the organizer picked from the scout's results. Like the booking choice, it travels as a
// normal chat message so the server can read it back from history with parseVenuePick.
export interface VenuePick {
  name: string;
  sourceUrl: string;
}

const VENUE_PREFIX = 'Venue chosen:';
const SOURCE_PREFIX = 'Source:';

export function venuePickText({ name, sourceUrl }: VenuePick): string {
  return `${VENUE_PREFIX} ${name}\n${SOURCE_PREFIX} ${sourceUrl}`;
}

export function parseVenuePick(text: string): VenuePick | null {
  const lines = text.split('\n').map((line) => line.trim());
  const venue = lines.find((line) => line.startsWith(VENUE_PREFIX));
  const source = lines.find((line) => line.startsWith(SOURCE_PREFIX));
  if (venue === undefined || source === undefined) return null;
  const name = venue.slice(VENUE_PREFIX.length).trim();
  const sourceUrl = source.slice(SOURCE_PREFIX.length).trim();
  return name && sourceUrl ? { name, sourceUrl } : null;
}
export * from './common.js';
export * from './sponsor.js';
export * from './invoice.js';
export * from './ledger.js';
export * from './payout.js';
export * from './claim.js';
export * from './widgets.js';
export * from './approvals.js';
export * from './treasury.js';
export * from './session.js';
export * from './wallet.js';

// The PayPal deposit that holds the organizer's picked venue. Only seeded demo venues list one. The
// server reads the pick from the thread and the amount from its venue catalog, never from the
// browser or the agent, and pays through the rules-checked executor like every other spend.
export const VenueDeposit = z.object({
  venue: z.string(),
  area: z.string(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
});
export type VenueDeposit = z.infer<typeof VenueDeposit>;

// GET /api/venue-deposit/:threadId. Null when nothing is picked or the venue lists no deposit.
export const VenueDepositResponse = z.object({ deposit: VenueDeposit.nullable() });
export type VenueDepositResponse = z.infer<typeof VenueDepositResponse>;

// What the executor did with the deposit: paid from the agent wallet (within the rules), sent to the
// treasurer to approve in the PayPal popup, blocked by a rule, or refused (no wallet, kill switch).
export const SpendOutcome = z.discriminatedUnion('status', [
  z.object({ status: z.literal('paid'), orderId: z.string(), captureId: z.string().optional() }),
  z.object({
    status: z.literal('needs_approval'),
    approvalId: z.string(),
    paypalOrderId: z.string(),
    reasons: z.array(z.string()),
  }),
  z.object({ status: z.literal('blocked'), reasons: z.array(z.string()) }),
  z.object({ status: z.literal('refused'), reason: z.string() }),
  z.object({
    status: z.literal('failed'),
    detail: z.string(),
    retryable: z.literal(true).optional(),
  }),
]);
export type SpendOutcome = z.infer<typeof SpendOutcome>;

// POST /api/venue-deposit/:threadId (treasurer).
export const VenueDepositPayResponse = z.object({ deposit: VenueDeposit, outcome: SpendOutcome });
export type VenueDepositPayResponse = z.infer<typeof VenueDepositPayResponse>;
export * from './spends.js';
