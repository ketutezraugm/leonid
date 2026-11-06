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
  it('reads typed amounts as integer minor units', () => {
    expect(parseMoneyInput('2500')).toBe(250_000);
    expect(parseMoneyInput('$2,500.50')).toBe(250_050);
    expect(parseMoneyInput('1 200.5')).toBe(120_050);
    expect(parseMoneyInput('0.07')).toBe(7);
    expect(parseMoneyInput('19.99')).toBe(1_999);
    expect(parseMoneyInput('10.')).toBe(1_000);
    expect(parseMoneyInput('0')).toBe(0);
  });

  it('refuses what is not a plain amount', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1e3', '1.2.3', '12,5x']) expect(parseMoneyInput(bad)).toBeNull();
  });

  it('follows the currency\'s decimals', () => {
    expect(parseMoneyInput('150000', 'IDR')).toBe(150_000);
    expect(parseMoneyInput('1.5', 'IDR')).toBeNull();
  });
});
