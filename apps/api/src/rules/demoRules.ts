import { CompiledRules } from '@leonid/shared';

// The demo's rules, in force until the rules compiler (F8) and the rules table land. Then the confirmed version replaces
// this constant. The PRD gives no figures for most of these, so those amounts are ours.
// No approval step (decided with #115, Nov 9): there is no approval threshold for purchases or payouts. Every spend is
// still checked here and audited, and the organizer's max spend, the daily cap and the category caps are the limits.
// The approval_threshold and payout_threshold rule types stay in the engine for rules an organizer writes later.
export const DEMO_RULES = CompiledRules.parse([
  { id: 'swag-approved-vendors', type: 'approved_vendors', category: 'swag', vendors: ['Lanyard Co'] },
  { id: 'volunteer-claim-cap', type: 'claim_daily_cap', amountMinor: 5_000, currency: 'USD' },
  { id: 'swag-budget-cap', type: 'category_cap', category: 'swag', amountMinor: 100_000, currency: 'USD' },
  { id: 'daily-auto-spend-cap', type: 'daily_auto_spend_cap', amountMinor: 100_000, currency: 'USD' },
]);
