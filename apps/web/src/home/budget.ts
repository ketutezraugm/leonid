import type { BudgetBurnData, FundingThermometerData, TreasuryBalance, TreasuryResponse } from '@quartermaster/shared';
import type { BudgetFigures } from '../ui/BudgetBar';

// The funding widget's totals are cumulative (a paid sponsor counts as pledged, invoiced and cleared), while the
// budget bar draws each dollar once: invoiced means invoiced and not yet paid, pledged means not yet invoiced.
export function eventBudgetFigures(funding: FundingThermometerData, burn: BudgetBurnData): BudgetFigures {
  const { pledged, invoiced } = funding.totals;
  return {
    currency: burn.currency,
    cleared: burn.clearedIncome,
    committed: burn.committed,
    invoiced: Math.max(0, invoiced - burn.clearedIncome),
    pledged: Math.max(0, pledged - invoiced),
  };
}

// The PayPal account's balance in the event's currency; undefined when PayPal reports none in it.
export function paypalBalance(treasury: TreasuryResponse, currency: string): TreasuryBalance | undefined {
  return treasury.balances.find((b) => b.currency === currency.toUpperCase());
}

export interface RecentSpend {
  id: string;
  /** ISO date the spend was paid. */
  date: string;
  what: string;
  amount: number;
  result: 'Allowed' | 'Needs approval' | 'Blocked';
  /** The rule that decided it, in the treasurer's words. */
  reason: string;
  paypalId: string;
}

export const SAMPLE_RECENT_SPENDS: RecentSpend[] = [
  {
    id: 'r1',
    date: '2027-01-26',
    what: 'Lanyards (200)',
    amount: 14_000,
    result: 'Allowed',
    reason: 'Under $200 per order',
    paypalId: '5TY05013RG002845M',
  },
  {
    id: 'r2',
    date: '2027-01-24',
    what: 'USB-C adapters',
    amount: 36_000,
    result: 'Allowed',
    reason: 'On the approved swag list',
    paypalId: '8GH77310MM501214K',
  },
  {
    id: 'r3',
    date: '2027-01-20',
    what: 'Snacks, day 1',
    amount: 136_000,
    result: 'Allowed',
    reason: 'Catering budget, approved by you',
    paypalId: '2AB33920CX771026P',
  },
];

export interface Alert {
  id: string;
  tone: 'risk' | 'pending';
  text: string;
  to: string;
}

export const SAMPLE_ALERTS: Alert[] = [
  { id: 'a1', tone: 'risk', text: 'Lanyards arrive Mar 9, after badge printing on Mar 7.', to: '/plan' },
  { id: 'a2', tone: 'pending', text: 'Lumen Labs has been invoiced and has not paid yet.', to: '/money' },
];
