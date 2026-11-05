import type { SponsorReportLine } from '@quartermaster/shared';
import { describe, expect, it } from 'vitest';
import type { FoundTransaction } from '../paypal/search.js';
import { crossCheckLines, searchWindows } from './crosscheck.js';

const line = (paypalId: string | null, purchaseMinor = 42_000, at = '2026-11-04T10:00:00.000Z'): SponsorReportLine => ({
  at,
  category: 'prizes',
  vendor: 'Prize Co',
  purchaseMinor,
  attributedMinor: purchaseMinor,
  basis: 'shared',
  paypalId,
});
const tx = (over: Partial<FoundTransaction>): FoundTransaction => ({ transactionId: 'CAP1', referenceId: null, status: 'S', amountMinor: 42_000, currency: 'USD', ...over });
const check = (lines: SponsorReportLine[], found: FoundTransaction[]) => crossCheckLines(lines, found, 'USD').map((l) => l.paypalCheck);

describe('crossCheckLines', () => {
  it('confirms a purchase whose capture id PayPal lists as a successful payment of the same amount', () => {
    expect(check([line('CAP1')], [tx({})])).toEqual(['confirmed']);
  });

  it('confirms by the order id too: an approved spend records the order, and PayPal lists the capture pointing at it', () => {
    expect(check([line('ORDER1')], [tx({ transactionId: 'CAP9', referenceId: 'ORDER1' })])).toEqual(['confirmed']);
  });

  it('never reads a negative amount as the payment: a refund of the same size is not a confirmation', () => {
    expect(check([line('CAP1')], [tx({ amountMinor: -42_000 })])).toEqual(['differs']);
  });

  it('does not confirm a purchase that PayPal later refunded: the good entry and the refund listed against it add up to "differs"', () => {
    const payment = tx({ transactionId: 'CAP1' });
    const refund = tx({ transactionId: 'REF1', referenceId: 'CAP1', amountMinor: -42_000 }); // PayPal lists a refund pointing at its payment
    expect(check([line('CAP1')], [payment, refund])).toEqual(['differs']);
    expect(check([line('CAP1')], [refund, payment])).toEqual(['differs']); // whatever the order
  });

  it('does not confirm a partial refund either, nor a payment whose own status is reversed while another entry looks fine', () => {
    const payment = tx({ transactionId: 'CAP1' });
    expect(check([line('CAP1')], [payment, tx({ transactionId: 'REF2', referenceId: 'CAP1', amountMinor: -5_000 })])).toEqual(['differs']);
    expect(check([line('CAP1')], [payment, tx({ transactionId: 'CAP1', status: 'V' })])).toEqual(['differs']);
  });

  it('looks at an approved spend through its order id the same way: the capture confirms, a refund pointing at the order does not', () => {
    const capture = tx({ transactionId: 'CAP9', referenceId: 'ORDER1' });
    expect(check([line('ORDER1')], [capture])).toEqual(['confirmed']);
    expect(check([line('ORDER1')], [capture, tx({ transactionId: 'REF9', referenceId: 'ORDER1', amountMinor: -42_000 })])).toEqual(['differs']);
  });

  it('says "differs" when PayPal lists the id but not as that successful payment: another amount, pending, reversed or another currency', () => {
    expect(check([line('CAP1')], [tx({ amountMinor: 41_000 })])).toEqual(['differs']);
    expect(check([line('CAP1')], [tx({ status: 'P' })])).toEqual(['differs']);
    expect(check([line('CAP1')], [tx({ status: 'V' })])).toEqual(['differs']);
    expect(check([line('CAP1')], [tx({ currency: 'EUR' })])).toEqual(['differs']);
  });

  it('says "not_found" when PayPal does not list the id, which is not an accusation (the search lags)', () => {
    expect(check([line('CAP1')], [tx({ transactionId: 'OTHER' })])).toEqual(['not_found']);
    expect(check([line('CAP1')], [])).toEqual(['not_found']);
  });

  it('prefers a matching successful entry when the id is listed twice, and leaves a line with no PayPal id unchecked', () => {
    expect(check([line('CAP1')], [tx({ status: 'P' }), tx({})])).toEqual(['confirmed']);
    const [unchecked] = crossCheckLines([line(null)], [tx({})], 'USD');
    expect(unchecked?.paypalCheck).toBeUndefined();
  });
});

describe('searchWindows', () => {
  const NOW = new Date('2026-11-05T12:00:00Z');
  it('covers from a day before the earliest purchase to now, in one window when that is short', () => {
    const w = searchWindows([line('A', 1, '2026-11-04T10:00:00.000Z'), line('B', 1, '2026-11-02T10:00:00.000Z')], NOW);
    expect(w).toHaveLength(1);
    expect(w[0]?.start.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    expect(w[0]?.end.toISOString()).toBe(NOW.toISOString());
  });

  it('splits a long span into windows Transaction Search accepts (31 days at most), without gaps', () => {
    const w = searchWindows([line('A', 1, '2026-08-01T00:00:00.000Z')], NOW);
    expect(w.length).toBeGreaterThan(2);
    for (const win of w) expect(win.end.getTime() - win.start.getTime()).toBeLessThanOrEqual(31 * 86_400_000);
    for (let i = 1; i < w.length; i += 1) expect(w[i]?.start.getTime()).toBe(w[i - 1]?.end.getTime());
    expect(w.at(-1)?.end.toISOString()).toBe(NOW.toISOString());
  });

  it('has nothing to look up when no purchase has a PayPal id', () => {
    expect(searchWindows([line(null)], NOW)).toEqual([]);
    expect(searchWindows([], NOW)).toEqual([]);
  });
});
