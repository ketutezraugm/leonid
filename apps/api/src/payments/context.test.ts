import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertDurableMoneyState, getPayments } from './context.js';

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
