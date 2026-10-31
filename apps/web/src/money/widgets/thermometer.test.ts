import { describe, expect, it } from 'vitest';
import { describeBar, formatDollars, toBars, totalsOf, type ThermometerKeys } from './thermometer';

const keys: ThermometerKeys = {
  sponsor: 'sponsors.name',
  pledged: 'sponsors.pledged.sum',
  invoiced: 'sponsors.invoiced.sum',
  cleared: 'sponsors.cleared.sum',
};

const row = (name: string, pledged: unknown, invoiced: unknown, cleared: unknown) => ({
  'sponsors.name': name,
  'sponsors.pledged.sum': pledged,
  'sponsors.invoiced.sum': invoiced,
  'sponsors.cleared.sum': cleared,
});

const sample = [
  row('Alder Labs', 3000, 3000, 3000),
  row('Brightwave', 2000, 2000, 0),
  row('Cobalt Works', 1000, 0, 0),
];

describe('toBars', () => {
  it('splits each track into cleared, outstanding and uninvoiced money', () => {
    const [alder, brightwave, cobalt] = toBars(sample, keys);

    expect(alder).toMatchObject({ clearedShare: 1, outstandingShare: 0, uninvoicedShare: 0 });
    expect(brightwave).toMatchObject({ clearedShare: 0, outstandingShare: 1, uninvoicedShare: 0 });
    expect(cobalt).toMatchObject({ clearedShare: 0, outstandingShare: 0, uninvoicedShare: 1 });
  });

  it('shows a part-paid sponsor in three segments that add up to the whole track', () => {
    const [bar] = toBars([row('Part Paid', 1000, 800, 300)], keys);

    expect(bar?.clearedShare).toBeCloseTo(0.3);
    expect(bar?.outstandingShare).toBeCloseTo(0.5);
    expect(bar?.uninvoicedShare).toBeCloseTo(0.2);
    expect(
      (bar?.clearedShare ?? 0) + (bar?.outstandingShare ?? 0) + (bar?.uninvoicedShare ?? 0),
    ).toBeCloseTo(1);
  });

  it('draws tracks in proportion to each sponsor next to the largest', () => {
    const shares = toBars(sample, keys).map((b) => b.trackShare);

    expect(shares[0]).toBe(1);
    expect(shares[1]).toBeCloseTo(2 / 3);
    expect(shares[2]).toBeCloseTo(1 / 3);
  });

  it('keeps an overpaying sponsor inside its track instead of past 100 percent', () => {
    const [bar] = toBars([row('Generous', 1000, 1000, 1500)], keys);

    expect(bar?.clearedShare).toBe(1);
    expect(bar?.outstandingShare).toBe(0);
    expect(bar?.uninvoicedShare).toBe(0);
  });

  it('never shows negative outstanding money when more is cleared than invoiced', () => {
    const [bar] = toBars([row('Odd', 1000, 400, 600)], keys);

    expect(bar?.outstandingShare).toBe(0);
    expect(bar?.clearedShare).toBeCloseTo(0.6);
    // The rest of the pledge is neither cleared nor invoiced beyond what was paid, so it stays hatched.
    expect(bar?.uninvoicedShare).toBeCloseTo(0.4);
    expect(
      (bar?.clearedShare ?? 0) + (bar?.outstandingShare ?? 0) + (bar?.uninvoicedShare ?? 0),
    ).toBeCloseTo(1);
  });

  it('draws an empty track, not NaN, for a sponsor with nothing pledged', () => {
    const [bar] = toBars([row('Nothing', 0, 0, 0)], keys);

    expect(bar).toMatchObject({
      clearedShare: 0,
      outstandingShare: 0,
      uninvoicedShare: 0,
      trackShare: 0,
    });
  });

  it.each([
    ['numbers sent as text', '2500', 2500],
    ['a missing value', undefined, 0],
    ['null', null, 0],
    ['a negative amount', -50, 0],
    ['not a number', 'abc', 0],
    ['NaN', Number.NaN, 0],
  ])('reads %s as an amount', (_name, raw, expected) => {
    const [bar] = toBars([row('S', raw, 0, 0)], keys);

    expect(bar?.pledged).toBe(expected);
  });

  it('gives back nothing for no rows, and reads the name as text', () => {
    expect(toBars([], keys)).toEqual([]);
    expect(toBars([row(undefined as unknown as string, 1, 0, 0)], keys)[0]?.name).toBe('');
  });
});

describe('totalsOf', () => {
  it('adds up the three figures across sponsors', () => {
    expect(totalsOf(toBars(sample, keys))).toEqual({
      pledged: 6000,
      invoiced: 5000,
      cleared: 3000,
    });
  });

  it('is all zero for no sponsors', () => {
    expect(totalsOf([])).toEqual({ pledged: 0, invoiced: 0, cleared: 0 });
  });
});

describe('formatting', () => {
  it('formats dollars with the symbol, grouping and two decimals', () => {
    expect(formatDollars(3000)).toBe('$3,000.00');
    expect(formatDollars(0.5)).toBe('$0.50');
    expect(formatDollars(1234567.891)).toBe('$1,234,567.89');
  });

  it('describes a bar in words, since colour and hatching carry no text', () => {
    const [bar] = toBars([row('Brightwave', 2000, 2000, 0)], keys);

    expect(describeBar(bar!)).toBe(
      'Brightwave: pledged $2,000.00, invoiced $2,000.00, cleared $0.00',
    );
  });
});
