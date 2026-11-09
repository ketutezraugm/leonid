import type { SpendEntry } from '@leonid/shared';
import { describe, expect, it } from 'vitest';
import { allocate, buildReport, type ReportInput } from './build.js';

const NOW = new Date('2026-11-05T12:00:00Z');
const A = '00000000-0000-4000-8000-00000000000a'; // gold, paid $3,000
const B = '00000000-0000-4000-8000-00000000000b'; // silver, paid $1,000

const spend = (id: string, over: Partial<SpendEntry> = {}): SpendEntry => ({
  id,
  at: '2026-11-04T10:00:00.000Z',
  actor: 'agent',
  amountMinor: 14_000,
  currency: 'USD',
  category: 'swag',
  vendor: 'Lanyard Co',
  agentReason: null,
  decision: 'allow',
  reasons: [],
  status: 'paid',
  paypalId: `PP-${id}`,
  eventId: 'e1',
  ...over,
});

const input = (spends: SpendEntry[], over: Partial<ReportInput> = {}): ReportInput => ({
  sponsor: { id: A, name: 'Harbor Cloud', tier: 'gold', pledged: 300_000, status: 'paid' },
  event: { name: 'OpenHack 2027', date: new Date('2027-03-14T00:00:00Z'), currency: 'USD' },
  clearedBySponsor: new Map([[A, 300_000], [B, 100_000]]),
  clearedTotal: 500_000, // $3,000 + $1,000 sponsors, $1,000 tickets and donations
  spends,
  now: NOW,
  ...over,
});

describe('allocate', () => {
  it('always adds up to the total, gives leftover cents to the largest remainders, ties to the first', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(14_000, [300_000, 100_000, 100_000])).toEqual([8_400, 2_800, 2_800]);
    expect(allocate(1, [1, 1])).toEqual([1, 0]);
    for (const total of [0, 1, 7, 999, 14_001, 123_457]) {
      expect(allocate(total, [3, 5, 11, 0]).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
  it('gives nothing to anyone when there is no money to share by', () => {
    expect(allocate(500, [0, 0])).toEqual([0, 0]);
    expect(allocate(500, [])).toEqual([]);
  });
});

describe('buildReport', () => {
  it('splits a pooled purchase by what each source paid in, and never more than the sponsor gave', () => {
    const r = buildReport(input([spend('s1', { amountMinor: 140_000 })]));
    // $1,400 split 3000 : 1000 : 1000 -> sponsor A pays 3/5
    expect(r.spend.totalMinor).toBe(84_000);
    expect(r.spend.sharedMinor).toBe(84_000);
    expect(r.spend.directMinor).toBe(0);
    expect(r.spend.totalMinor).toBeLessThanOrEqual(r.funds.clearedMinor);
    expect(r.spend.lines).toEqual([
      { at: '2026-11-04T10:00:00.000Z', category: 'swag', vendor: 'Lanyard Co', purchaseMinor: 140_000, attributedMinor: 84_000, basis: 'shared', paypalId: 'PP-s1' },
    ]);
  });

  it('attributes a spend funded by this sponsor in full, and ignores one funded by another sponsor', () => {
    const r = buildReport(input([
      spend('mine', { amountMinor: 20_000, fundedBySponsorId: A, vendor: 'Gold Prints' }),
      spend('theirs', { amountMinor: 50_000, fundedBySponsorId: B, vendor: 'Silver Snacks' }),
    ]));
    expect(r.spend.directMinor).toBe(20_000);
    expect(r.spend.totalMinor).toBe(20_000);
    expect(r.spend.lines.map((l) => l.vendor)).toEqual(['Gold Prints']);
    expect(r.spend.lines[0]?.basis).toBe('direct');
  });

  it('counts only paid spends (and accepted payouts) in this currency, not blocked, pending or foreign ones', () => {
    const r = buildReport(input([
      spend('paid', { amountMinor: 10_000 }),
      spend('blocked', { status: 'blocked' }),
      spend('pending', { status: 'needs_approval' }),
      spend('rejected', { status: 'rejected' }),
      spend('eur', { currency: 'EUR' }),
      spend('unknown-amount', { amountMinor: null }),
    ]));
    expect(r.spend.lines).toHaveLength(1);
    expect(r.spend.lines[0]?.purchaseMinor).toBe(10_000);
  });

  it('keeps people out: a payout shows in its category total but never as a line with a payee', () => {
    const r = buildReport(input([
      spend('shop', { amountMinor: 10_000, category: 'swag' }),
      spend('pay', { amountMinor: 5_000, category: 'volunteer reimbursements', kind: 'claim', status: 'submitted', vendor: 'Jane Volunteer' }),
    ]));
    expect(r.spend.lines.map((l) => l.vendor)).toEqual(['Lanyard Co']);
    expect(r.spend.byCategory.map((c) => c.category).sort()).toEqual(['swag', 'volunteer reimbursements']);
    expect(JSON.stringify(r)).not.toContain('Jane');
  });

  it('totals by category, biggest first, with an Other bucket for a purchase that had no category', () => {
    const r = buildReport(input([
      spend('a', { amountMinor: 50_000, category: 'swag' }),
      spend('b', { amountMinor: 100_000, category: 'venue' }),
      spend('c', { amountMinor: 10_000, category: null }),
    ]));
    expect(r.spend.byCategory.map((c) => c.category)).toEqual(['venue', 'swag', 'Other']);
    expect(r.spend.byCategory.reduce((sum, c) => sum + c.attributedMinor, 0)).toBe(r.spend.totalMinor);
  });

  it('is deterministic: the same data in a different order gives the same report', () => {
    const spends = [spend('a', { amountMinor: 14_001, at: '2026-11-01T00:00:00.000Z' }), spend('b', { amountMinor: 333, at: '2026-11-02T00:00:00.000Z' })];
    expect(buildReport(input([...spends].reverse()))).toEqual(buildReport(input(spends)));
  });

  it('reports no spend and no division by zero when nothing has cleared', () => {
    const r = buildReport(input([spend('a')], { clearedBySponsor: new Map(), clearedTotal: 0 }));
    expect(r.spend.totalMinor).toBe(0);
    expect(r.spend.lines).toEqual([]);
    expect(r.funds.clearedMinor).toBe(0);
  });
});
