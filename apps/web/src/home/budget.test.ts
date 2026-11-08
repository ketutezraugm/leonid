import { describe, expect, it } from 'vitest';
import type { BudgetBurnData, FundingThermometerData, TreasuryResponse } from '@quartermaster/shared';
import { eventBudgetFigures, paypalBalance } from './budget';

const AS_OF = '2027-01-26T12:00:00.000Z';

// The seeded demo: one sponsor paid $3,000, one invoiced $2,500, one pledged $2,500; $1,860 committed.
const funding: FundingThermometerData = {
  asOf: AS_OF,
  currency: 'USD',
  sponsors: [],
  totals: { pledged: 800_000, invoiced: 550_000, cleared: 300_000 },
};
const burn: BudgetBurnData = {
  asOf: AS_OF,
  currency: 'USD',
  eventDate: '2027-03-14',
  daysToEvent: 47,
  clearedIncome: 300_000,
  committed: 186_000,
  unlocked: 114_000,
  categories: [],
};

describe('eventBudgetFigures', () => {
  it('draws each sponsor dollar once: cleared, invoiced but unpaid, pledged but not invoiced', () => {
    expect(eventBudgetFigures(funding, burn)).toEqual({
      currency: 'USD',
      cleared: 300_000,
      committed: 186_000,
      invoiced: 250_000,
      pledged: 250_000,
    });
  });

  it('never draws a negative segment when cleared money runs ahead of invoices', () => {
    const figures = eventBudgetFigures(
      { ...funding, totals: { pledged: 100_000, invoiced: 0, cleared: 200_000 } },
      { ...burn, clearedIncome: 200_000 },
    );
    expect(figures.invoiced).toBe(0);
    expect(figures.pledged).toBe(100_000);
  });
});

describe('paypalBalance', () => {
  const treasury: TreasuryResponse = {
    merchantId: 'M1',
    asOf: AS_OF,
    balances: [
      { currency: 'EUR', totalMinor: 5_000, availableMinor: 5_000, withheldMinor: 0 },
      { currency: 'USD', totalMinor: 1_234_500, availableMinor: 1_200_000, withheldMinor: 34_500 },
    ],
  };

  it("picks the balance in the event's currency", () => {
    expect(paypalBalance(treasury, 'usd')?.totalMinor).toBe(1_234_500);
  });

  it('is undefined when PayPal holds nothing in that currency', () => {
    expect(paypalBalance(treasury, 'GBP')).toBeUndefined();
  });
});
