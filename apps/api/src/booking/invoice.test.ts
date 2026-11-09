import { describe, expect, it } from 'vitest';
import { formatAmount, invoiceNumber } from './invoice.js';

describe('invoice formatting', () => {
  it('formats IDR without minor units and USD with cents', () => {
    expect(formatAmount(19_300_000, 'IDR')).toBe('IDR 19,300,000');
    expect(formatAmount(123_456, 'USD')).toBe('USD 1,234.56');
  });

  it('derives the invoice number from the thread id', () => {
    expect(invoiceNumber('abcdef12-0000-4000-8000-000000000000')).toBe('INV-ABCDEF12');
  });
});
