import { z } from 'zod';
import { CurrencyCode, IsoDateTime, MinorUnits, RuleDecision } from './common.js';

// GET /api/spends/recent?limit=20&eventId=<uuid> (treasurer only): the latest spend requests the payment executor decided,
// newest first, for Event home's "Recent spends". One entry per request: what was asked, what the rules said, how it ended.
// Without eventId every event's spends are listed; with it, only spends the caller tagged with that event.
export const SPEND_RECENT_MAX = 50;

// How a spend ended. A request that the rules sent to the treasurer reads 'needs_approval' while it waits, then follows
// its approval: 'capturing', 'paid' or 'rejected'. 'unknown' means no result was recorded (still in flight, or the server
// stopped mid-call).
export const SpendStatus = z.enum([
  'paid',
  'needs_approval',
  'capturing',
  'rejected',
  'blocked', // the rules said no
  'refused', // no active wallet, or PayPal refused the charge (for example after the kill switch)
  'failed',
  'error',
  'mismatch',
  'unknown',
]);
export type SpendStatus = z.infer<typeof SpendStatus>;

export const SpendEntry = z.object({
  id: z.string(), // the audit row id
  at: IsoDateTime,
  actor: z.string(),
  amountMinor: MinorUnits.nullable(),
  currency: CurrencyCode.nullable(),
  category: z.string().nullable(),
  vendor: z.string().nullable(),
  agentReason: z.string().nullable(), // the requester's own reasoning summary
  decision: RuleDecision,
  reasons: z.array(z.string()), // why the rules decided that
  status: SpendStatus,
  paypalId: z.string().nullable(), // the PayPal order or capture id, to show and copy
  eventId: z.string().nullable(),
});
export type SpendEntry = z.infer<typeof SpendEntry>;

export const SpendsResponse = z.object({ spends: z.array(SpendEntry) });
export type SpendsResponse = z.infer<typeof SpendsResponse>;
