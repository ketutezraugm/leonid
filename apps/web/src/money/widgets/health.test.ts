import { describe, expect, it } from 'vitest';
import {
  countsOf,
  decisionView,
  describeEntry,
  NO_REASON,
  toEntries,
  type HealthEntry,
  type HealthKeys,
} from './health';

const keys: HealthKeys = {
  id: 'rules.id',
  decision: 'rules.decision',
  reasons: 'rules.reasons',
  category: 'rules.category',
  amount: 'rules.amount',
  date: 'rules.date',
};

const row = (
  id: string,
  decision: unknown,
  reasons: unknown,
  category: unknown = null,
  amount: unknown = null,
  date: unknown = null,
) => ({
  'rules.id': id,
  'rules.decision': decision,
  'rules.reasons': reasons,
  'rules.category': category,
  'rules.amount': amount,
  'rules.date': date,
});

// The command center's sample checks.
const sample = [
  row('au_1', 'allow', 'Under the $200 approval threshold', 'swag', 140, '2027-01-14'),
  row('au_2', 'needs_approval', 'Over the $200 approval threshold', 'prizes', 420, '2027-01-14'),
  row('au_3', 'block', 'Vendor is not on the approved list', 'swag', 90, '2027-01-14'),
];

describe('toEntries', () => {
  it('reads each check with its decision, reasons, category, amount and day', () => {
    const { entries, skipped } = toEntries(sample, keys);

    expect(skipped).toBe(0);
    expect(entries).toHaveLength(3);
    expect(entries[1]).toEqual({
      id: 'au_2',
      decision: 'needs_approval',
      reasons: 'Over the $200 approval threshold',
      category: 'prizes',
      amount: 420,
      date: '2027-01-14',
    });
  });

  it('leaves out, and counts, a row whose decision the rules engine cannot return', () => {
    const { entries, skipped } = toEntries(
      [
        row('a', 'allow', 'ok'),
        row('b', 'maybe', 'huh'),
        row('c', undefined, 'x'),
        row('d', 'block', 'no'),
      ],
      keys,
    );

    expect(entries.map((e) => e.id)).toEqual(['a', 'd']);
    expect(skipped).toBe(2);
  });

  it('works with only the required fields mapped', () => {
    const { entries } = toEntries(sample, { ...keys, category: null, amount: null, date: null });

    expect(entries[0]).toMatchObject({ category: null, amount: null, date: null });
  });

  it('treats a blank category, a missing amount and unusable amounts as none', () => {
    const [blank, none, negative, text] = toEntries(
      [
        row('a', 'allow', 'r', '  ', 5),
        row('b', 'allow', 'r', null, null),
        row('c', 'allow', 'r', 'x', -3),
        row('d', 'allow', 'r', 'x', 'abc'),
      ],
      keys,
    ).entries;

    expect(blank).toMatchObject({ category: null, amount: 5 });
    expect(none?.amount).toBeNull();
    expect(negative?.amount).toBeNull();
    expect(text?.amount).toBeNull();
  });

  it('keeps a zero amount, because a $0 check is still a check', () => {
    expect(toEntries([row('a', 'allow', 'r', 'x', 0)], keys).entries[0]?.amount).toBe(0);
  });

  it('shows the day whether it arrives as text or as a Date, in any time zone', () => {
    const day = '2027-01-14';
    const [str, iso, date, junk] = toEntries(
      [
        row('a', 'allow', 'r', null, null, day),
        row('b', 'allow', 'r', null, null, '2027-01-14T16:20:00Z'),
        // Local midnight, which is how Studio builds a date. Reading it in UTC gave the day before east of
        // Greenwich; this holds wherever the tests run.
        row('c', 'allow', 'r', null, null, new Date(2027, 0, 14)),
        row('e', 'allow', 'r', null, null, 'last Tuesday'),
      ],
      keys,
    ).entries;

    expect([str, iso, date].map((e) => e?.date)).toEqual([day, day, day]);
    expect(junk?.date).toBeNull();
  });

  it('keeps a check with no reasons, to be labelled rather than dropped', () => {
    expect(toEntries([row('a', 'block', null)], keys).entries[0]?.reasons).toBe('');
  });

  it('returns nothing for no rows', () => {
    expect(toEntries([], keys)).toEqual({ entries: [], skipped: 0 });
  });
});

describe('countsOf', () => {
  it('counts the checks by decision', () => {
    expect(countsOf(toEntries(sample, keys).entries)).toEqual({
      allow: 1,
      needsApproval: 1,
      block: 1,
    });
  });

  it('is all zero for no checks', () => {
    expect(countsOf([])).toEqual({ allow: 0, needsApproval: 0, block: 0 });
  });
});

describe('decisionView and describeEntry', () => {
  const [allow, approval, block] = toEntries(sample, keys).entries as [
    HealthEntry,
    HealthEntry,
    HealthEntry,
  ];

  it('writes every decision out in words and ties it to a status tone', () => {
    expect(decisionView.allow).toEqual({ label: 'Allowed', tone: 'done' });
    expect(decisionView.needs_approval).toEqual({ label: 'Sent to approval', tone: 'risk' });
    expect(decisionView.block).toEqual({ label: 'Blocked', tone: 'blocked' });
  });

  it('puts the decision, amount, category and reasons in words for a screen reader', () => {
    expect(describeEntry(allow)).toBe('Allowed, $140.00, swag. Under the $200 approval threshold');
    expect(describeEntry(approval)).toBe(
      'Sent to approval, $420.00, prizes. Over the $200 approval threshold',
    );
    expect(describeEntry(block)).toBe('Blocked, $90.00, swag. Vendor is not on the approved list');
  });

  it('leaves out what is not known, and says when no reason was recorded', () => {
    expect(describeEntry({ ...allow, amount: null, category: null, reasons: '' })).toBe(
      `Allowed. ${NO_REASON}`,
    );
  });
});
