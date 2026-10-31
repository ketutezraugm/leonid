import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('formats cents as dollars', () => {
    expect(formatMoney(14000)).toBe('$140.00');
    expect(formatMoney(800000)).toBe('$8,000.00');
    expect(formatMoney(5)).toBe('$0.05');
  });

  it('keeps the sign on refunds and outflows', () => {
    expect(formatMoney(-42050)).toBe('-$420.50');
  });

  it('respects currencies without minor units', () => {
    expect(formatMoney(1500, 'JPY')).toBe('¥1,500');
  });

  it('treats IDR as whole units, as the API stores it', () => {
    expect(formatMoney(1_500_000, 'IDR').replace(/\s/g, ' ')).toBe('IDR 1,500,000');
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatMoney(140.5)).toThrow(RangeError);
  });
});
