import { describe, expect, it } from 'vitest';
import { LOCAL_MINOR_PER_USD, toUsdCents } from './fx.js';

describe('toUsdCents', () => {
  it('converts each venue currency at its demo rate', () => {
    expect(toUsdCents(16_000_000, 'IDR')).toBe(100_000); // Rp 16m = $1,000
    expect(toUsdCents(44_000, 'MYR')).toBe(10_000); // RM 440 = $100
    expect(toUsdCents(13_000, 'SGD')).toBe(10_000); // S$ 130 = $100
  });

  it('rounds up so the charge never falls short', () => {
    expect(toUsdCents(1, 'IDR')).toBe(1);
    expect(toUsdCents(16_001, 'IDR')).toBe(101);
  });

  it('refuses a currency with no rate', () => {
    expect(() => toUsdCents(100, 'EUR')).toThrow(/No demo exchange rate/);
    expect(Object.keys(LOCAL_MINOR_PER_USD)).toEqual(['IDR', 'MYR', 'SGD']);
  });
});
