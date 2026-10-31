import { describe, expect, it } from 'vitest';
import { capNote, describeBar, toBars, totalsOf, type BurnKeys } from './burn';

const keys: BurnKeys = {
  category: 'categories.category',
  cap: 'categories.cap.sum',
  spent: 'categories.spent.sum',
  committed: 'categories.committed.sum',
};

const row = (category: string, cap: unknown, spent: unknown, committed: unknown) => ({
  'categories.category': category,
  'categories.cap.sum': cap,
  'categories.spent.sum': spent,
  'categories.committed.sum': committed,
});

// The command center's sample: swag $140 spent, prizes $420 committed, nothing in venue or food.
const sample = [
  row('swag', 1500, 140, 0),
  row('prizes', 2000, 0, 420),
  row('venue', 2500, 0, 0),
  row('food', 1000, 0, 0),
];

describe('toBars', () => {
  it('splits a capped track into spent, committed and money still free', () => {
    const [swag, prizes] = toBars(sample, keys);

    expect(swag).toMatchObject({ cap: 1500, spent: 140, committed: 0, used: 140, over: false });
    expect(swag?.spentShare).toBeCloseTo(140 / 1500);
    expect(swag?.committedShare).toBe(0);
    expect(swag?.capShare).toBe(1);
    expect(swag?.left).toBe(1360);

    expect(prizes?.spentShare).toBe(0);
    expect(prizes?.committedShare).toBeCloseTo(0.21);
    expect(prizes?.left).toBe(1580);
  });

  it('flags a category that used more than its cap and puts the cap line inside the track', () => {
    const [bar] = toBars([row('av', 500, 400, 200)], keys);

    expect(bar).toMatchObject({ used: 600, over: true, left: -100 });
    expect(bar?.capShare).toBeCloseTo(500 / 600);
    expect(bar?.spentShare).toBeCloseTo(400 / 600);
    expect(bar?.committedShare).toBeCloseTo(200 / 600);
    expect((bar?.spentShare ?? 0) + (bar?.committedShare ?? 0)).toBeCloseTo(1);
  });

  it('does not flag a category that has used exactly its cap', () => {
    const [bar] = toBars([row('av', 500, 300, 200)], keys);

    expect(bar).toMatchObject({ over: false, left: 0 });
  });

  it('compares whole cents, so 10 + 20 cents against a 30 cent cap is not over', () => {
    const [bar] = toBars([row('rounding', 0.3, 0.1, 0.2)], keys);

    expect(bar).toMatchObject({ over: false, left: 0 });
  });

  it('draws tracks in proportion to each category next to the longest', () => {
    const shares = toBars(sample, keys).map((b) => b.trackShare);

    expect(shares[0]).toBeCloseTo(0.6);
    expect(shares[1]).toBeCloseTo(0.8);
    expect(shares[2]).toBe(1);
    expect(shares[3]).toBeCloseTo(0.4);
  });

  it('lets an overspent category set the longest track', () => {
    const [capped, over] = toBars([row('a', 1000, 0, 0), row('b', 1000, 1500, 500)], keys);

    expect(over?.trackShare).toBe(1);
    expect(capped?.trackShare).toBe(0.5);
  });

  it('shows a category with no cap by what it used, and never calls it over', () => {
    const [bar] = toBars([row('misc', null, 50, 0)], keys);

    expect(bar).toMatchObject({ cap: null, over: false, left: null, capShare: null });
    expect(bar?.spentShare).toBe(1);
  });

  it('reads a cap of zero as no cap, because Studio sums a missing cap to zero', () => {
    const [zero, missing] = toBars([row('a', 0, 10, 0), row('b', undefined, 10, 0)], keys);

    expect(zero).toMatchObject({ cap: null, over: false });
    expect(missing).toMatchObject({ cap: null, over: false });
  });

  it('ignores the cap column when the widget was mapped without a cap', () => {
    const [bar] = toBars([row('swag', 1500, 140, 0)], { ...keys, cap: null });

    expect(bar).toMatchObject({ cap: null, over: false, left: null });
  });

  it('treats unusable amounts as zero instead of breaking the bar', () => {
    const [bar] = toBars([row('odd', 'abc', -5, '30')], keys);

    expect(bar).toMatchObject({ cap: null, spent: 0, committed: 30, used: 30 });
  });

  it('draws nothing for a category with no money at all', () => {
    const [bar] = toBars([row('empty', null, 0, 0)], keys);

    expect(bar).toMatchObject({ spentShare: 0, committedShare: 0, trackShare: 0 });
  });

  it('returns no bars for no rows', () => {
    expect(toBars([], keys)).toEqual([]);
  });
});

describe('totalsOf', () => {
  it('adds up what was used and the caps when every category has one', () => {
    expect(totalsOf(toBars(sample, keys))).toEqual({
      spent: 140,
      committed: 420,
      used: 560,
      capTotal: 7000,
      overCount: 0,
    });
  });

  it('counts the categories over their cap', () => {
    const totals = totalsOf(
      toBars([row('a', 100, 150, 0), row('b', 100, 10, 0), row('c', 50, 0, 60)], keys),
    );

    expect(totals.overCount).toBe(2);
  });

  it('gives no cap total when any category has no cap, rather than a misleading one', () => {
    const totals = totalsOf(toBars([row('a', 1000, 100, 0), row('b', null, 100, 0)], keys));

    expect(totals.capTotal).toBeNull();
    expect(totals.used).toBe(200);
  });

  it('is empty for no bars', () => {
    expect(totalsOf([])).toEqual({ spent: 0, committed: 0, used: 0, capTotal: null, overCount: 0 });
  });
});

describe('capNote and describeBar', () => {
  const [swag, over, uncapped] = toBars(
    [row('swag', 1500, 140, 0), row('av', 500, 400, 200), row('misc', null, 50, 0)],
    keys,
  );

  it('says how much is left under the cap', () => {
    expect(capNote(swag!)).toEqual({ text: '$1,360.00 left', tone: 'ok' });
  });

  it('says how far past the cap a category is', () => {
    expect(capNote(over!)).toEqual({ text: 'Over the cap by $100.00', tone: 'over' });
  });

  it('says when there is no cap', () => {
    expect(capNote(uncapped!)).toEqual({ text: 'No cap set', tone: 'none' });
  });

  it('puts every figure in words for a screen reader', () => {
    expect(describeBar(swag!)).toBe(
      'swag: spent $140.00, committed $0.00, cap $1,500.00. $1,360.00 left',
    );
    expect(describeBar(over!)).toBe(
      'av: spent $400.00, committed $200.00, cap $500.00. Over the cap by $100.00',
    );
    expect(describeBar(uncapped!)).toBe('misc: spent $50.00, committed $0.00, no cap. No cap set');
  });
});
