import { describe, expect, it } from 'vitest';
import type { Spend } from './ports.js';
import { stubCheck } from './stub-check.js';

const spend = (amountMinor: number, currency = 'USD'): Spend => ({ referenceId: 'r', amountMinor, currency, actor: 'a', reason: 'x' });

describe('stubCheck', () => {
  it('allows USD up to and including $200, and asks for approval above it', () => {
    expect(stubCheck(spend(14000)).decision).toBe('allow');
    expect(stubCheck(spend(20000)).decision).toBe('allow');
    expect(stubCheck(spend(20001)).decision).toBe('needs_approval');
    expect(stubCheck(spend(42000)).decision).toBe('needs_approval');
  });

  it('never auto-pays a non-USD amount, even when the raw number is small', () => {
    // 19,999 pence is about 250 dollars, so the cents threshold must not apply to it
    expect(stubCheck(spend(19999, 'GBP')).decision).toBe('needs_approval');
    expect(stubCheck(spend(100, 'EUR')).decision).toBe('needs_approval');
  });
});
