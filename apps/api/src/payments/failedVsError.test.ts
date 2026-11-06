import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog } from '../db/schema.js';
import type { Db } from '../db/client.js';
import { recordLedgerEntry } from '../db/ledger.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { createPayPalClient } from '../paypal/client.js';
import { PayPalApiError, PayPalTimeoutError } from '../paypal/errors.js';
import { createDbApprovals, createDbAudit, createDbReferences, createDbWalletStore } from './db.js';
import { createExecutor, definitelyRefused } from './executor.js';
import type { Spend } from './ports.js';
import { createRulesCheck } from './rulesCheck.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, issue?: string) =>
  new PayPalApiError({ status, errorName: 'ERR', issue });

describe('definitelyRefused: when may a failed PayPal call give its money back to the budget?', () => {
  it('says yes only when PayPal answered with a 4xx that means nothing moved', () => {
    for (const status of [400, 401, 403, 404, 422, 429]) expect(definitelyRefused(apiError(status, 'INSTRUMENT_DECLINED')), String(status)).toBe(true);
    expect(definitelyRefused(apiError(422))).toBe(true); // no issue code: still a refusal
  });

  it('says no when the outcome is unknown or the money already moved', () => {
    for (const status of [408, 409, 500, 502, 503, 504]) expect(definitelyRefused(apiError(status)), String(status)).toBe(false);
    expect(definitelyRefused(apiError(422, 'ORDER_ALREADY_CAPTURED'))).toBe(false);
    expect(definitelyRefused(apiError(422, 'ORDER_ALREADY_AUTHORIZED'))).toBe(false);
    expect(definitelyRefused(new PayPalTimeoutError('POST', '/v2/checkout/orders', 30_000))).toBe(false);
    expect(definitelyRefused(new Error('socket hang up'))).toBe(false);
    expect(definitelyRefused(undefined)).toBe(false);
  });
});

describe('a failed PayPal call and the daily auto-pay cap', () => {
  let db: Db;
  let eventId: string;
  beforeEach(async () => {
    db = await createTestDb();
    eventId = (await seedDemoEvent(db)).id;
    await recordLedgerEntry(db, { eventId, direction: 'in', amount: 50_000, currency: 'USD', source: 'sponsor_invoice', paypalId: 'PAY-1' });
    await createDbWalletStore(db).activate({ paymentTokenId: 'pt_1' });
  });

  const cart = (referenceId: string, amountMinor: number): Spend => ({
    referenceId, amountMinor, currency: 'USD', actor: 'procurement-agent', reason: 'x', category: 'prizes', eventId,
  });

  // PayPal fails the FIRST call that matches (a vault charge, or an approval order), then behaves.
  function executor(failFirst: { charge?: () => Response; order?: () => Response }) {
    const failures = { ...failFirst };
    let orders = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (String(url).endsWith('/v1/oauth2/token')) return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
      orders += 1;
      const body = JSON.parse(String(init?.body)) as { payment_source?: { paypal?: { vault_id?: string } }; purchase_units: [{ amount: { value: string } }] };
      const isCharge = Boolean(body.payment_source?.paypal?.vault_id);
      const fail = isCharge ? failures.charge : failures.order;
      if (fail) {
        if (isCharge) failures.charge = undefined;
        else failures.order = undefined;
        return fail();
      }
      if (!isCharge) {
        return json(201, { id: `ORD-${orders}`, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=ORD-${orders}` }] });
      }
      const amount = { currency_code: 'USD', value: body.purchase_units[0].amount.value };
      return json(201, { id: `ORD-${orders}`, status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: `CAP-${orders}`, status: 'COMPLETED', amount }] } }] });
    });
    return createExecutor({
      client: createPayPalClient({ app: 'procurement', clientId: 'i', clientSecret: 's', fetch }),
      check: createRulesCheck(db),
      audit: createDbAudit(db),
      wallet: createDbWalletStore(db),
      approvals: createDbApprovals(db),
      references: createDbReferences(db),
    });
  }

  const outcomeOf = async () => {
    const rows = await db.select({ outcome: auditLog.outcome }).from(auditLog);
    return rows.map((r) => r.outcome);
  };
  const declined = () => json(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] });
  const unavailable = () => json(503, { name: 'SERVICE_UNAVAILABLE' });

  it('gives the money back when PayPal declines a wallet charge, so the same dollars can be spent again', async () => {
    const { requestSpend } = executor({ charge: declined });
    expect((await requestSpend(cart('a', 14_000))).status).toBe('failed');
    expect(await outcomeOf()).toEqual(['failed']);
    // $140 was never taken, so it does not count towards the $1,000 daily cap: seven more $140 carts pass
    for (const ref of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) expect((await requestSpend(cart(ref, 14_000))).status, ref).toBe('paid');
  });

  it('keeps holding the money when PayPal answered 5xx, because the wallet may have been charged', async () => {
    const { requestSpend } = executor({ charge: unavailable });
    expect((await requestSpend(cart('a', 14_000))).status).toBe('failed');
    expect(await outcomeOf()).toEqual(['error']);
    // $140 may have been charged, so it counts towards the $1,000 daily cap: six more $140 carts pass, the seventh asks
    for (const ref of ['b', 'c', 'd', 'e', 'f', 'g']) expect((await requestSpend(cart(ref, 14_000))).status, ref).toBe('paid');
    expect((await requestSpend(cart('h', 14_000))).status).toBe('needs_approval');
  });

  it('gives the money back when PayPal cannot create the approval order', async () => {
    const { requestSpend } = executor({ order: declined });
    expect((await requestSpend(cart('big-1', 42_000))).status).toBe('failed');
    expect(await outcomeOf()).toEqual(['failed']);
    // the $420 is free again, so another $420 cart still reaches the treasurer
    expect((await requestSpend(cart('big-2', 42_000))).status).toBe('needs_approval');
  });
});
