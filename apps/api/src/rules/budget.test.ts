import { describe, expect, it } from 'vitest';
import { committedSpends, sumMinor, unlockedBudget, type SpendRecord } from './budget.js';

const record = (referenceId: string, over: Partial<SpendRecord> = {}): SpendRecord => ({
  referenceId,
  amountMinor: 14_000,
  category: null,
  decision: 'allow',
  outcome: 'paid',
  approval: null,
  ...over,
});
const total = (records: SpendRecord[]) => sumMinor(committedSpends(records));

describe('unlockedBudget', () => {
  it('is cleared income minus committed spend, and may go negative', () => {
    expect(unlockedBudget(300_000, 56_000)).toBe(244_000);
    expect(unlockedBudget(0, 0)).toBe(0);
    expect(unlockedBudget(10_000, 14_000)).toBe(-4_000);
  });
});

describe('committedSpends', () => {
  it('counts captured spends', () => {
    expect(total([record('a'), record('b', { amountMinor: 6_000 })])).toBe(20_000);
  });

  it('counts a spend from the moment it is allowed, before PayPal has answered', () => {
    expect(total([record('a', { outcome: null })])).toBe(14_000);
  });

  it('counts a spend waiting for the treasurer, and one mid-capture', () => {
    expect(total([record('a', { decision: 'needs_approval', outcome: 'needs_approval', approval: 'pending' })])).toBe(14_000);
    expect(total([record('a', { decision: 'needs_approval', outcome: 'needs_approval', approval: 'capturing' })])).toBe(14_000);
    expect(total([record('a', { decision: 'needs_approval', outcome: null })])).toBe(14_000);
  });

  it('gives the money back when the treasurer rejects', () => {
    expect(total([record('a', { decision: 'needs_approval', outcome: 'needs_approval', approval: 'rejected' })])).toBe(0);
  });

  it.each(['blocked', 'refused', 'failed'])('does not count a spend that ended %s', (outcome) => {
    expect(total([record('a', { outcome })])).toBe(0);
  });

  it('does not count a block, even one that crashed before its outcome was written', () => {
    expect(total([record('a', { decision: 'block', outcome: null })])).toBe(0);
  });

  it('fails closed: a dropped connection, a mismatch, an unknown outcome and an unreadable result all hold the money', () => {
    expect(total([record('a', { outcome: 'error' })])).toBe(14_000);
    expect(total([record('a', { outcome: 'mismatch' })])).toBe(14_000);
    expect(total([record('a', { outcome: 'something-new' })])).toBe(14_000);
    expect(total([record('a', { decision: null })])).toBe(14_000);
  });

  it('counts a retried spend once', () => {
    expect(total([record('a', { outcome: 'refused' }), record('a', { outcome: 'error' }), record('a')])).toBe(14_000);
  });

  it('marks only what moved with no human as auto-paid', () => {
    const spends = committedSpends([
      record('auto'),
      record('approved', { decision: 'needs_approval', outcome: 'needs_approval', approval: 'paid' }),
    ]);
    expect(spends.map((s) => [s.referenceId, s.autoPaid])).toEqual([['auto', true], ['approved', false]]);
  });
});
