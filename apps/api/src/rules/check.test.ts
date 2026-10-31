import { describe, expect, it } from 'vitest';
import type { Spend } from '../payments/ports.js';
import { check, type Budget } from './check.js';
import { DEMO_RULES } from './demoRules.js';

const SPONSOR = 'sponsor-1';
const spend = (amountMinor: number, extra: Partial<Spend> = {}): Spend => ({
  referenceId: 'r',
  amountMinor,
  currency: 'USD',
  actor: 'procurement-agent',
  reason: 'x',
  eventId: 'event-1',
  category: 'prizes',
  ...extra,
});
const lanyards = (amountMinor = 14_000, extra: Partial<Spend> = {}) =>
  spend(amountMinor, { category: 'swag', vendor: 'Lanyard Co', ...extra });

const budget = (over: Partial<NonNullable<Budget['funds']>> = {}, rest: Partial<Budget> = {}): Budget => ({
  funds: { unlockedMinor: 300_000, committedByCategoryMinor: {}, paidSponsorIds: [SPONSOR], ...over },
  autoPaidTodayMinor: 0,
  claimedTodayMinor: 0,
  ...rest,
});

describe('check: the demo beats', () => {
  it('allows the $140 cart', () => {
    const result = check(lanyards(), DEMO_RULES, budget());
    expect(result.decision).toBe('allow');
    expect(result.ruleIds).toContain('approval-threshold');
  });

  it('sends the $420 cart to the treasurer', () => {
    expect(check(spend(42_000), DEMO_RULES, budget())).toEqual({
      decision: 'needs_approval',
      reasons: ['over the 200.00 USD approval threshold'],
      ruleIds: ['approval-threshold'],
    });
  });

  it('allows exactly the threshold and asks one cent above it', () => {
    expect(check(spend(20_000), DEMO_RULES, budget()).decision).toBe('allow');
    expect(check(spend(20_001), DEMO_RULES, budget()).decision).toBe('needs_approval');
  });

  it('blocks swag from a vendor off the approved list', () => {
    const result = check(spend(14_000, { category: 'swag', vendor: 'Mystery Goods' }), DEMO_RULES, budget());
    expect(result).toMatchObject({ decision: 'block', ruleIds: ['swag-approved-vendors'] });
    expect(result.reasons[0]).toContain('Mystery Goods');
  });

  it('blocks a spend whose sponsor has not paid', () => {
    const result = check(lanyards(14_000, { fundedBySponsorId: 'sponsor-2' }), DEMO_RULES, budget());
    expect(result).toMatchObject({ decision: 'block', ruleIds: ['sponsor-gate'] });
  });

  it('lets that spend through once the sponsor has paid', () => {
    expect(check(lanyards(14_000, { fundedBySponsorId: SPONSOR }), DEMO_RULES, budget()).decision).toBe('allow');
  });
});

describe('check: the funds gate', () => {
  it('blocks a spend with nothing unlocked, whatever else it passes: pledges are not spendable', () => {
    const result = check(lanyards(), DEMO_RULES, budget({ unlockedMinor: 0 }));
    expect(result).toEqual({
      decision: 'block',
      reasons: ['140.00 USD is more than the 0.00 USD of unlocked budget'],
      ruleIds: ['funds-gate'],
    });
  });

  it('allows spending the last unlocked cent and not one more', () => {
    expect(check(lanyards(14_000), DEMO_RULES, budget({ unlockedMinor: 14_000 })).decision).toBe('allow');
    expect(check(lanyards(14_001), DEMO_RULES, budget({ unlockedMinor: 14_000 })).decision).toBe('block');
  });

  it('blocks when income was reversed and unlocked is negative', () => {
    const result = check(lanyards(), DEMO_RULES, budget({ unlockedMinor: -5_000 }));
    expect(result.decision).toBe('block');
    expect(result.reasons[0]).toContain('-50.00 USD');
  });

  it('blocks a spend that names no event', () => {
    const result = check(lanyards(), DEMO_RULES, { ...budget(), funds: null });
    expect(result).toMatchObject({ decision: 'block', ruleIds: ['funds-gate'] });
  });

  it('a treasurer cannot be asked to approve money that has not arrived: block beats needs_approval', () => {
    const result = check(spend(42_000), DEMO_RULES, budget({ unlockedMinor: 1_000 }));
    expect(result).toMatchObject({ decision: 'block', ruleIds: ['funds-gate'] });
  });
});

describe('check: currency', () => {
  it('never compares a limit across currencies, even when the raw number is small', () => {
    const result = check(spend(100, { currency: 'GBP' }), DEMO_RULES, budget());
    expect(result.decision).toBe('needs_approval');
    expect(result.reasons[0]).toContain('GBP');
  });

  it('19,999 pence is not under $200', () => {
    expect(check(spend(19_999, { currency: 'GBP' }), DEMO_RULES, budget()).decision).toBe('needs_approval');
  });
});

describe('check: the daily auto-pay cap', () => {
  it('goes to the treasurer once a spend would pass the cap, and counts exactly up to it', () => {
    const atCap = budget({}, { autoPaidTodayMinor: 86_000 });
    expect(check(lanyards(14_000), DEMO_RULES, atCap).decision).toBe('allow');
    const past = check(lanyards(14_001), DEMO_RULES, atCap);
    expect(past).toMatchObject({ decision: 'needs_approval', ruleIds: ['daily-auto-spend-cap'] });
  });
});

describe('check: category rules', () => {
  it('asks when a spend leaves its category off, so that cannot dodge the swag list', () => {
    const result = check(spend(14_000, { category: undefined, vendor: 'Mystery Goods' }), DEMO_RULES, budget());
    expect(result).toMatchObject({ decision: 'needs_approval', ruleIds: ['category-required'] });
  });

  it('ignores case, spacing and lookalike forms in categories and vendors', () => {
    expect(check(spend(14_000, { category: ' SWAG ', vendor: 'lanyard   co' }), DEMO_RULES, budget()).decision).toBe('allow');
    expect(check(spend(14_000, { category: 'Swag', vendor: 'Ｌａｎｙａｒｄ Ｃｏ' }), DEMO_RULES, budget()).decision).toBe('allow');
    expect(check(spend(14_000, { category: 'SWAG', vendor: 'Other' }), DEMO_RULES, budget()).decision).toBe('block');
  });

  it('blocks a spend that would pass the category cap', () => {
    const nearly = budget({ committedByCategoryMinor: { swag: 90_000 } });
    expect(check(lanyards(10_000), DEMO_RULES, nearly).decision).toBe('allow');
    expect(check(lanyards(10_001), DEMO_RULES, nearly)).toMatchObject({ decision: 'block', ruleIds: ['swag-budget-cap'] });
  });
});

describe('check: claims and payouts', () => {
  const claim = (amountMinor: number, extra: Partial<Spend> = {}) =>
    spend(amountMinor, { kind: 'claim', payee: 'volunteer-1', ...extra });

  it('holds a volunteer to the daily cap, across the day', () => {
    expect(check(claim(5_000), DEMO_RULES, budget()).decision).toBe('allow');
    expect(check(claim(5_001), DEMO_RULES, budget())).toMatchObject({ decision: 'block', ruleIds: ['volunteer-claim-cap'] });
    expect(check(claim(2_000), DEMO_RULES, budget({}, { claimedTodayMinor: 3_001 })).decision).toBe('block');
  });

  it('asks when a claim names nobody, since the cap is per person', () => {
    expect(check(claim(1_000, { payee: undefined }), DEMO_RULES, budget())).toMatchObject({
      decision: 'needs_approval',
      ruleIds: ['volunteer-claim-cap'],
    });
  });

  it('holds payouts to the payout threshold, not the purchase one', () => {
    const payout = (amountMinor: number) => spend(amountMinor, { kind: 'payout', payee: 'speaker-1' });
    expect(check(payout(20_000), DEMO_RULES, budget()).decision).toBe('allow');
    expect(check(payout(20_001), DEMO_RULES, budget())).toMatchObject({ decision: 'needs_approval', ruleIds: ['payout-threshold'] });
  });

  it('applies the swag list to purchases only', () => {
    expect(check(claim(1_000, { category: 'swag', vendor: 'Corner Shop' }), DEMO_RULES, budget()).decision).toBe('allow');
  });
});

describe('check: failing closed', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_VALUE])('blocks the amount %s', (amountMinor) => {
    expect(check(lanyards(amountMinor), DEMO_RULES, budget())).toMatchObject({ decision: 'block', ruleIds: expect.arrayContaining(['amount']) });
  });

  it('auto-pays nothing with no confirmed rules', () => {
    expect(check(lanyards(), [], budget())).toMatchObject({ decision: 'needs_approval', ruleIds: ['no-rules'] });
  });

  it('reports every reason at the deciding level, and only those', () => {
    const result = check(
      spend(42_000, { category: 'swag', vendor: 'Mystery Goods', fundedBySponsorId: 'sponsor-2' }),
      DEMO_RULES,
      budget({ unlockedMinor: 0 }),
    );
    expect(result.decision).toBe('block');
    expect(result.ruleIds).toEqual(['funds-gate', 'sponsor-gate', 'swag-approved-vendors']);
  });

  it('is pure: the same input gives the same answer and nothing is mutated', () => {
    const input = lanyards();
    const money = budget();
    const before = JSON.stringify([input, DEMO_RULES, money]);
    expect(check(input, DEMO_RULES, money)).toEqual(check(input, DEMO_RULES, money));
    expect(JSON.stringify([input, DEMO_RULES, money])).toBe(before);
  });
});
