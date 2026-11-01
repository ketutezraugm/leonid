import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../db/testing.js';
import { assertDurableMoneyState, getPayments, pickCheck } from './context.js';
import { stubCheck } from './stub-check.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('assertDurableMoneyState', () => {
  it('refuses production without DATABASE_URL, so a redeploy cannot forget the wallet the kill switch must delete', () => {
    expect(() => assertDurableMoneyState({ NODE_ENV: 'production' })).toThrow('DATABASE_URL must be set in production');
    expect(() => assertDurableMoneyState({ NODE_ENV: 'production', DATABASE_URL: '' })).toThrow();
  });

  it('allows production with a database, and local runs without one', () => {
    expect(() => assertDurableMoneyState({ NODE_ENV: 'production', DATABASE_URL: 'postgres://db' })).not.toThrow();
    expect(() => assertDurableMoneyState({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertDurableMoneyState({})).not.toThrow();
  });

  it('stops getPayments from falling back to in-memory stores in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('PAYPAL_PROCUREMENT_CLIENT_ID', 'id');
    vi.stubEnv('PAYPAL_PROCUREMENT_CLIENT_SECRET', 'secret');
    expect(() => getPayments()).toThrow('DATABASE_URL must be set in production');
  });
});

describe('pickCheck', () => {
  const EVENT = '3bbd0ba2-ed6c-41d4-a8f0-719e60f44a13';
  const cart = { referenceId: 'cart-1', amountMinor: 14_000, currency: 'USD', actor: 'agent', reason: 'swag', category: 'swag', vendor: 'Lanyard Co', eventId: EVENT };

  it('keeps the stand-in rule for runs without a database', () => {
    expect(pickCheck(undefined)).toBe(stubCheck);
  });

  it('uses the real rules and budget when there is a database, and so blocks every spend while no sponsor money has cleared', async () => {
    const check = pickCheck(await createTestDb());
    expect(check).not.toBe(stubCheck);
    const result = await check(cart);
    expect(result.decision).toBe('block');
    expect(result.ruleIds).toContain('funds-gate');
    // the stand-in would have allowed this $140 cart
    expect(stubCheck(cart).decision).toBe('allow');
  });
});
