import { z } from 'zod';
import { CurrencyCode, MinorUnits } from './common.js';

// The structured form of the treasurer's rules, the rules table's compiled_json (PRD section 9). The rules compiler (F8)
// drafts it and the treasurer confirms it; the rules engine (F9) enforces it. A limit carries its own currency because
// amounts in two currencies cannot be compared without a rate, and the engine has none.
const Limit = {
  id: z.string().min(1),
  amountMinor: MinorUnits,
  currency: CurrencyCode,
};
const Category = z.string().trim().min(1).max(50);

export const Rule = z.discriminatedUnion('type', [
  // "Nothing over $200 without my approval." A spend of exactly the limit is within it.
  z.object({ ...Limit, type: z.literal('approval_threshold') }),
  // The same, for payouts to people.
  z.object({ ...Limit, type: z.literal('payout_threshold') }),
  // Most the agent wallet may auto-pay in one UTC day. Past it, spends go to the treasurer.
  z.object({ ...Limit, type: z.literal('daily_auto_spend_cap') }),
  // "Volunteers can claim up to $50 per day." Per person, per UTC day.
  z.object({ ...Limit, type: z.literal('claim_daily_cap') }),
  // The most the whole event may commit (paid, in flight and waiting for approval). The organizer sets it; past it a spend is blocked.
  z.object({ ...Limit, type: z.literal('max_spend') }),
  // The most one category may commit across the whole event.
  z.object({ ...Limit, type: z.literal('category_cap'), category: Category }),
  // "Swag only from the approved list."
  z.object({
    id: z.string().min(1),
    type: z.literal('approved_vendors'),
    category: Category,
    vendors: z.array(z.string().trim().min(1).max(100)).min(1),
  }),
]);
export type Rule = z.infer<typeof Rule>;

export const CompiledRules = z.array(Rule);
export type CompiledRules = z.infer<typeof CompiledRules>;
