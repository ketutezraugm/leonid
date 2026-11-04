import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoneyInput } from './money';

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

describe('parseMoneyInput', () => {
  it('reads dollars as typed into integer cents', () => {
    expect(parseMoneyInput('8,000')).toBe(800_000);
    expect(parseMoneyInput(' $1500.5 ')).toBe(150_050);
    expect(parseMoneyInput('0.07')).toBe(7);
  });

  it('refuses anything that is not an amount', () => {
    for (const text of ['', 'abc', '1.234', '-5', '1e3', '12.'])
      expect(parseMoneyInput(text)).toBeNull();
  });
});
