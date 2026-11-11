import { describe, expect, it } from 'vitest';
import {
  countsOf,
  datesLine,
  describeItem,
  riskView,
  timing,
  toItems,
  type DeliveryItem,
  type DeliveryKeys,
} from './delivery';

const keys: DeliveryKeys = {
  id: 'deliveries.id',
  name: 'deliveries.name',
  risk: 'deliveries.risk',
  category: 'categories.category',
  expected: 'deliveries.expectedDay',
  deadline: 'deliveries.deadlineDay',
  daysLate: 'deliveries.daysLate.sum',
};

const row = (
  id: string,
  name: string,
  risk: unknown,
  category: unknown = null,
  expected: unknown = null,
  deadline: unknown = null,
  daysLate: unknown = null,
) => ({
  'deliveries.id': id,
  'deliveries.name': name,
  'deliveries.risk': risk,
  'categories.category': category,
  'deliveries.expectedDay': expected,
  'deliveries.deadlineDay': deadline,
  'deliveries.daysLate.sum': daysLate,
});

// The command center's sample: lanyards two days late, adapters on the deadline, snacks three days early.
const sample = [
  row('or_3', 'Snacks', 'on_track', 'food', '2027-03-10', '2027-03-13', -3),
  row('or_2', 'USB-C adapters', 'at_risk', 'swag', '2027-03-01', '2027-03-01', 0),
  row('or_1', 'Lanyards', 'late', 'swag', '2027-03-03', '2027-03-01', 2),
];

const itemOf = (over: Partial<DeliveryItem> = {}): DeliveryItem => ({
  id: 'x',
  name: 'Lanyards',
  risk: 'late',
  category: 'swag',
  expected: '2027-03-03',
  deadline: '2027-03-01',
  daysLate: 2,
  ...over,
});

describe('toItems', () => {
  it('reads each item with its risk, category, days and how late it is', () => {
    const { items, skipped } = toItems(sample, keys);

    expect(skipped).toBe(0);
    expect(items).toHaveLength(3);
    expect(items.find((i) => i.id === 'or_1')).toEqual({
      id: 'or_1',
      name: 'Lanyards',
      risk: 'late',
      category: 'swag',
      expected: '2027-03-03',
      deadline: '2027-03-01',
      daysLate: 2,
    });
  });

  it('puts the most urgent first: late, then at risk, then no date, then on track', () => {
    const { items } = toItems(
      [
        row('a', 'On time', 'on_track', null, null, null, -5),
        row('b', 'No date', 'unknown'),
        row('c', 'Close', 'at_risk', null, null, null, -1),
        row('d', 'Behind', 'late', null, null, null, 4),
      ],
      keys,
    );

    expect(items.map((i) => i.name)).toEqual(['Behind', 'Close', 'No date', 'On time']);
  });

  it('puts the item most days late first within a group, then the one with least time to spare', () => {
    const { items } = toItems(
      [
        row('a', 'One day late', 'late', null, null, null, 1),
        row('b', 'Three days late', 'late', null, null, null, 3),
        row('c', 'Two to spare', 'on_track', null, null, null, -2),
        row('d', 'Five to spare', 'on_track', null, null, null, -5),
      ],
      keys,
    );

    expect(items.map((i) => i.name)).toEqual([
      'Three days late',
      'One day late',
      'Two to spare',
      'Five to spare',
    ]);
  });

  it('leaves out, and counts, a row whose risk the API cannot return', () => {
    const { items, skipped } = toItems(
      [row('a', 'Fine', 'on_track'), row('b', 'Odd', 'soon'), row('c', 'Missing', undefined)],
      keys,
    );

    expect(items.map((i) => i.id)).toEqual(['a']);
    expect(skipped).toBe(2);
  });

  it('works out the days late from the two days when the count is not mapped', () => {
    const { items } = toItems(
      [
        row('a', 'Late', 'late', null, '2027-03-03', '2027-03-01'),
        row('b', 'Early', 'on_track', null, '2027-03-10', '2027-03-13'),
      ],
      { ...keys, daysLate: null },
    );

    expect(items.map((i) => [i.name, i.daysLate])).toEqual([
      ['Late', 2],
      ['Early', -3],
    ]);
  });

  it('works the days out across a month end and a leap day without a time zone getting in', () => {
    const { items } = toItems([row('a', 'x', 'late', null, '2028-03-01', '2028-02-27')], {
      ...keys,
      daysLate: null,
    });

    expect(items[0]?.daysLate).toBe(3);
  });

  it('prefers the count it is given over working it out', () => {
    const { items } = toItems([row('a', 'x', 'late', null, '2027-03-03', '2027-03-01', 9)], keys);

    expect(items[0]?.daysLate).toBe(9);
  });

  it('cannot tell how late an item is with no count and no days', () => {
    const { items } = toItems([row('a', 'x', 'at_risk')], {
      ...keys,
      expected: null,
      deadline: null,
      daysLate: null,
    });

    expect(items[0]?.daysLate).toBeNull();
  });

  it('keeps only real days, and treats other text as no day', () => {
    const [item] = toItems(
      [row('a', 'x', 'on_track', null, 'soon', '2027-03-13T00:00:00')],
      keys,
    ).items;

    expect(item).toMatchObject({ expected: null, deadline: '2027-03-13' });
  });

  it('works with only the required fields mapped', () => {
    const { items } = toItems(sample, {
      ...keys,
      category: null,
      expected: null,
      deadline: null,
      daysLate: null,
    });

    expect(items[0]).toMatchObject({
      category: null,
      expected: null,
      deadline: null,
      daysLate: null,
    });
  });

  it('returns nothing for no rows', () => {
    expect(toItems([], keys)).toEqual({ items: [], skipped: 0 });
  });
});

describe('countsOf', () => {
  it('counts the items by risk', () => {
    expect(countsOf(toItems(sample, keys).items)).toEqual({
      late: 1,
      atRisk: 1,
      onTrack: 1,
      unknown: 0,
    });
  });

  it('is all zero for no items', () => {
    expect(countsOf([])).toEqual({ late: 0, atRisk: 0, onTrack: 0, unknown: 0 });
  });
});

describe('timing, datesLine and describeItem', () => {
  it('says how many days late, with the singular for one', () => {
    expect(timing(itemOf({ daysLate: 2 }))).toBe('2 days late');
    expect(timing(itemOf({ daysLate: 1 }))).toBe('1 day late');
  });

  it('says an item on its deadline arrives on it', () => {
    expect(timing(itemOf({ risk: 'at_risk', daysLate: 0 }))).toBe('Arrives on the deadline');
  });

  it('says how many days an early item has to spare', () => {
    expect(timing(itemOf({ risk: 'on_track', daysLate: -3 }))).toBe('3 days to spare');
    expect(timing(itemOf({ risk: 'on_track', daysLate: -1 }))).toBe('1 day to spare');
  });

  it('never says an item with no date arrives on the deadline, even though the API reports 0 days for it', () => {
    expect(timing(itemOf({ risk: 'unknown', daysLate: 0, expected: null }))).toBe(
      'No delivery date yet',
    );
  });

  it('says nothing about timing it cannot tell', () => {
    expect(timing(itemOf({ risk: 'on_track', daysLate: null }))).toBeNull();
  });

  it('writes out the days it knows', () => {
    expect(datesLine(itemOf())).toBe('Expected 2027-03-03, needed by 2027-03-01');
    expect(datesLine(itemOf({ expected: null }))).toBe('Needed by 2027-03-01');
    expect(datesLine(itemOf({ deadline: null }))).toBe('Expected 2027-03-03');
    expect(datesLine(itemOf({ expected: null, deadline: null }))).toBeNull();
  });

  it('writes every risk out in words and ties it to a status tone', () => {
    expect(riskView.late).toEqual({ label: 'Late', tone: 'blocked' });
    expect(riskView.at_risk).toEqual({ label: 'At risk', tone: 'risk' });
    expect(riskView.on_track).toEqual({ label: 'On track', tone: 'done' });
    expect(riskView.unknown).toEqual({ label: 'No date yet', tone: 'pending' });
  });

  it('puts the name, risk, timing, days and category in words for a screen reader', () => {
    expect(describeItem(itemOf())).toBe(
      'Lanyards: Late. 2 days late. Expected 2027-03-03, needed by 2027-03-01. Category swag',
    );
  });

  it('leaves out what is not known', () => {
    expect(
      describeItem(
        itemOf({ risk: 'unknown', daysLate: 0, expected: null, deadline: null, category: null }),
      ),
    ).toBe('Lanyards: No date yet. No delivery date yet');
  });
});
