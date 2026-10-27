import { describe, expect, it } from 'vitest';
import { fromPayPalMoney, toPayPalMoney } from './money.js';

describe('toPayPalMoney', () => {
  it('formats cents as a two-decimal string', () => {
    expect(toPayPalMoney(14000, 'USD')).toEqual({ currency_code: 'USD', value: '140.00' });
    expect(toPayPalMoney(5, 'usd')).toEqual({ currency_code: 'USD', value: '0.05' });
    expect(toPayPalMoney(0, 'USD')).toEqual({ currency_code: 'USD', value: '0.00' });
  });

  it('rejects floats, negatives and zero-decimal currencies', () => {
    expect(() => toPayPalMoney(1.5, 'USD')).toThrow(RangeError);
    expect(() => toPayPalMoney(-100, 'USD')).toThrow(RangeError);
    expect(() => toPayPalMoney(100, 'JPY')).toThrow(RangeError);
    expect(() => toPayPalMoney(100, 'US')).toThrow(RangeError);
  });
});

describe('fromPayPalMoney', () => {
  it('parses decimal strings back into cents', () => {
    expect(fromPayPalMoney({ currency_code: 'USD', value: '140.00' })).toEqual({
      amountMinor: 14000,
      currency: 'USD',
    });
    expect(fromPayPalMoney({ currency_code: 'USD', value: '8000' })).toEqual({
      amountMinor: 800000,
      currency: 'USD',
    });
    expect(fromPayPalMoney({ currency_code: 'USD', value: '0.5' })).toEqual({
      amountMinor: 50,
      currency: 'USD',
    });
  });

  it('rejects values it cannot represent exactly', () => {
    expect(() => fromPayPalMoney({ currency_code: 'USD', value: '1.234' })).toThrow(RangeError);
    expect(() => fromPayPalMoney({ currency_code: 'USD', value: '-1.00' })).toThrow(RangeError);
  });
});
