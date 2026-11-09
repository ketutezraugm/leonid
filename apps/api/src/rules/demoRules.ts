import { CompiledRules } from '@leonid/shared';

// The demo's rules, in force until the rules compiler (F8) and the rules table land. Then the confirmed version replaces
// this constant. The first three are what the treasurer types in the demo script. The PRD gives no figures for the
// others, so those amounts are ours.
export const DEMO_RULES = CompiledRules.parse([
  { id: 'approval-threshold', type: 'approval_threshold', amountMinor: 20_000, currency: 'USD' },
  { id: 'swag-approved-vendors', type: 'approved_vendors', category: 'swag', vendors: ['Lanyard Co'] },
  { id: 'volunteer-claim-cap', type: 'claim_daily_cap', amountMinor: 5_000, currency: 'USD' },
  { id: 'swag-budget-cap', type: 'category_cap', category: 'swag', amountMinor: 100_000, currency: 'USD' },
  { id: 'payout-threshold', type: 'payout_threshold', amountMinor: 20_000, currency: 'USD' },
  { id: 'daily-auto-spend-cap', type: 'daily_auto_spend_cap', amountMinor: 100_000, currency: 'USD' },
]);
