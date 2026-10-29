import type { BudgetFigures } from '../ui/BudgetBar';

// Sample data for Event home until P1's budget-summary endpoint exists (UX plan: missing shapes).
// Matches the seeded demo: Harbor Cloud has paid $3,000, Lumen Labs is invoiced $2,500, Pixel Foundry has
// pledged $2,500. The real screen reads cleared, committed, invoiced and pledged from that one endpoint.
export const SAMPLE_BUDGET: BudgetFigures = {
  currency: 'USD',
  cleared: 300_000,
  committed: 186_000,
  invoiced: 250_000,
  pledged: 250_000,
};

export interface RecentSpend {
  id: string;
  what: string;
  amount: number;
  result: 'Allowed' | 'Needs approval' | 'Blocked';
  paypalId: string;
}

export const SAMPLE_RECENT_SPENDS: RecentSpend[] = [
  { id: 'r1', what: 'Lanyards (200)', amount: 14_000, result: 'Allowed', paypalId: '5TY05013RG002845M' },
  { id: 'r2', what: 'USB-C adapters', amount: 36_000, result: 'Allowed', paypalId: '8GH77310MM501214K' },
  { id: 'r3', what: 'Snacks, day 1', amount: 136_000, result: 'Allowed', paypalId: '2AB33920CX771026P' },
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
