import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { listSponsors } from '../db/events.js';
import { recordLedgerEntry } from '../db/ledger.js';
import { auditLog, events } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import { createPayPalClient } from '../paypal/client.js';
import { createDbApprovals, createDbAudit, createDbReferences, createDbWalletStore } from './db.js';
import { createExecutor } from './executor.js';
import type { CheckResult, Spend } from './ports.js';
import { createRulesCheck } from './rulesCheck.js';

const NOW = new Date('2026-11-03T12:00:00Z');
const YESTERDAY = new Date('2026-11-02T23:59:59Z');

let db: Db;
let eventId: string;
beforeEach(async () => {
  db = await createTestDb();
  eventId = (await seedDemoEvent(db)).id;
});

const rulesCheck = () => createRulesCheck(db, { now: () => NOW });
const spend = (referenceId: string, amountMinor: number, extra: Partial<Spend> = {}): Spend => ({
  referenceId,
  amountMinor,
  currency: 'USD',
  actor: 'procurement-agent',
  reason: 'x',
  category: 'prizes',
  eventId,
  ...extra,
});

let nextPayPalId = 0;
const clear = async (amount: number, sponsorId?: string, currency = 'USD') =>
  recordLedgerEntry(db, { eventId, direction: 'in', amount, currency, source: 'sponsor_invoice', paypalId: `PAY-${nextPayPalId++}`, sponsorId });

const allow: CheckResult = { decision: 'allow', reasons: [], ruleIds: [] };
const ask: CheckResult = { decision: 'needs_approval', reasons: [], ruleIds: [] };
const block: CheckResult = { decision: 'block', reasons: [], ruleIds: [] };
async function recorded(s: Spend, result: CheckResult, outcome: string | undefined, at: Date = NOW) {
  const audit = createDbAudit(db);
  const id = await audit.record({ actor: s.actor, action: 'spend.check', input: s, reason: s.reason, ruleResult: result });
  if (outcome) await audit.update(id, { outcome });
  await db.update(auditLog).set({ createdAt: at }).where(eq(auditLog.id, id));
  return id;
}

describe('createRulesCheck', () => {
  it("enforces the event's maximum spend across what is already committed, and nothing when none is set", async () => {
    expect((await rulesCheck()(spend('before', 190_000))).decision).toBe('needs_approval'); // only the approval threshold
    await db.update(events).set({ maxSpendMinor: 30_000 }).where(eq(events.id, eventId));
    await recorded(spend('first', 20_000), allow, 'paid');
    expect((await rulesCheck()(spend('fits', 10_000))).decision).toBe('allow');
    const over = await rulesCheck()(spend('over', 10_001));
    expect(over).toMatchObject({ decision: 'block', ruleIds: ['max-spend'] });
  });

  it('allows a spend while nothing has cleared: income is not a gate, the organizer pays', async () => {
    expect((await rulesCheck()(spend('a', 14_000))).decision).toBe('allow');
  });

  it('does not count another event, or a block, against this budget', async () => {
    await clear(20_000);
    await recorded(spend('elsewhere', 20_000, { eventId: '00000000-0000-4000-8000-000000000000' }), allow, 'paid', YESTERDAY);
    await recorded(spend('no-event', 20_000, { eventId: undefined }), allow, 'paid', YESTERDAY);
    await recorded(spend('blocked', 20_000), block, 'blocked');
    expect((await rulesCheck()(spend('next', 20_000))).decision).toBe('allow');
  });

  it('a retry is not stopped by its own earlier row', async () => {
    await clear(20_000);
    await recorded(spend('same', 20_000), allow, 'error');
    expect((await rulesCheck()(spend('same', 20_000))).decision).toBe('allow');
  });

  it('sends a spend in another currency to a person, since the limits are in USD', async () => {
    expect((await rulesCheck()(spend('gbp', 100, { currency: 'GBP' }))).decision).toBe('needs_approval');
  });

  it('does not wait on a sponsor invoice', async () => {
    const [sponsor] = await listSponsors(db, eventId);
    expect((await rulesCheck()(spend('gated', 14_000, { fundedBySponsorId: sponsor!.id }))).decision).toBe('allow');
  });

  it('sums committed swag for the category cap, whatever case it was written in', async () => {
    await clear(800_000);
    await recorded(spend('old', 95_000, { category: 'SWAG', vendor: 'Lanyard Co' }), ask, 'needs_approval', YESTERDAY);
    const next = spend('next', 6_000, { category: 'swag', vendor: 'Lanyard Co' });
    expect(await rulesCheck()(next)).toMatchObject({ decision: 'block', ruleIds: ['swag-budget-cap'] });
  });

  it('counts only today\'s unattended spend towards the daily cap, on every event', async () => {
    await clear(800_000);
    await recorded(spend('old', 95_000), allow, 'paid', YESTERDAY);
    await recorded(spend('approved', 95_000), ask, 'needs_approval');
    await recorded(spend('other-event', 90_000, { eventId: undefined }), allow, 'paid');
    expect((await rulesCheck()(spend('ok', 10_000))).decision).toBe('allow');
    expect(await rulesCheck()(spend('over', 10_001))).toMatchObject({ decision: 'needs_approval', ruleIds: ['daily-auto-spend-cap'] });
  });

  it('counts claims per person, per day', async () => {
    await clear(800_000);
    const claim = (referenceId: string, amountMinor: number, payee: string) =>
      spend(referenceId, amountMinor, { kind: 'claim', payee, category: 'volunteers' });
    await recorded(claim('c1', 3_000, 'volunteer-1'), allow, 'paid');
    await recorded(claim('c2', 3_000, 'volunteer-2'), allow, 'paid');
    await recorded(claim('c3', 3_000, 'volunteer-1'), allow, 'paid', YESTERDAY);
    expect((await rulesCheck()(claim('c4', 2_000, 'volunteer-1'))).decision).toBe('allow');
    expect((await rulesCheck()(claim('c5', 2_001, 'volunteer-1'))).decision).toBe('block');
  });

  it('counts a claim against the email the money goes to, not the name typed with it', async () => {
    await clear(800_000);
    const claim = (referenceId: string, amountMinor: number, payee: string, payeeEmail?: string) =>
      spend(referenceId, amountMinor, { kind: 'claim', payee, payeeEmail, category: 'volunteers' });
    await recorded(claim('c1', 4_000, 'Dana', 'Dana@Example.com'), allow, 'paid');
    // the same inbox under another name, or another spelling of it, is the same person: $40 + $10.01 is over the $50 cap
    expect((await rulesCheck()(claim('c2', 1_001, 'D. Smith', ' dana@example.com '))).decision).toBe('block');
    expect((await rulesCheck()(claim('c3', 1_000, 'D. Smith', 'dana@example.com'))).decision).toBe('allow');
    // another inbox is another person
    expect((await rulesCheck()(claim('c4', 4_000, 'Dana', 'someone-else@example.com'))).decision).toBe('allow');
  });

  it('skips an audit row it cannot read instead of failing the spend', async () => {
    await clear(20_000);
    await db.insert(auditLog).values({ actor: 'x', action: 'spend.check', input: { currency: 'USD', eventId }, ruleResult: 'not json' });
    expect((await rulesCheck()(spend('next', 20_000))).decision).toBe('allow');
  });
});

describe('the executor with the real check()', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  // Every call succeeds at PayPal, so only the rules can stop a spend.
  function executor(check = rulesCheck()) {
    let orders = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (String(url).endsWith('/v1/oauth2/token')) return json(200, { access_token: 't', token_type: 'Bearer', expires_in: 3600 });
      orders += 1;
      const body = JSON.parse(String(init?.body)) as { payment_source?: { paypal?: { vault_id?: string } }; purchase_units: [{ amount: { value: string } }] };
      if (!body.payment_source?.paypal?.vault_id) {
        return json(201, { id: `ORD-${orders}`, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=ORD-${orders}` }] });
      }
      const amount = { currency_code: 'USD', value: body.purchase_units[0].amount.value };
      return json(201, { id: `ORD-${orders}`, status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: `CAP-${orders}`, status: 'COMPLETED', amount }] } }] });
    });
    return createExecutor({
      client: createPayPalClient({ app: 'procurement', clientId: 'i', clientSecret: 's', fetch }),
      check,
      audit: createDbAudit(db),
      wallet: createDbWalletStore(db),
      approvals: createDbApprovals(db),
      references: createDbReferences(db),
      // A claim or payout is refused up front without a sender; none of these tests sends one.
      payouts: { send: async () => ({ batchId: 'PB-test' }) },
    });
  }
  const connectWallet = () => createDbWalletStore(db).activate({ paymentTokenId: 'pt_1' });

  it('two carts racing past the daily auto-pay cap cannot both be auto-paid', async () => {
    await connectWallet();
    await recorded(spend('earlier', 90_000), allow, 'paid');
    const { requestSpend } = executor();
    const outcomes = await Promise.all([requestSpend(spend('cart-1', 6_000)), requestSpend(spend('cart-2', 6_000))]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(['needs_approval', 'paid']);
  });

  it('a check that throws does not hold up the spends behind it', async () => {
    await clear(50_000);
    await connectWallet();
    const real = rulesCheck();
    const flaky = vi.fn(real).mockRejectedValueOnce(new Error('database went away'));
    const { requestSpend } = executor(flaky);
    const [first, second] = await Promise.allSettled([requestSpend(spend('cart-1', 10_000)), requestSpend(spend('cart-2', 10_000))]);
    expect(first.status).toBe('rejected');
    expect(second).toMatchObject({ status: 'fulfilled', value: { status: 'paid' } });
  });

  it('a retry of a reference made before these fields existed is still the same spend', async () => {
    await clear(50_000);
    await connectWallet();
    const before = spend('old-cart', 10_000);
    const oldFingerprint = JSON.stringify([before.amountMinor, before.currency, null, before.category, before.actor]);
    await createDbReferences(db).claim('old-cart', oldFingerprint);
    expect((await executor().requestSpend(before)).status).toBe('paid');
  });

  it.each([
    ['kind', { kind: 'claim' }],
    ['payee', { payee: 'volunteer-1' }],
    ['fundedBySponsorId', { fundedBySponsorId: 'sponsor-1' }],
  ] as const)('refuses a reference reused with a different %s', async (_field, change) => {
    await clear(50_000);
    await connectWallet();
    const { requestSpend } = executor();
    // Both carry a recipient email, so a claim is not refused for lacking one and only the named field differs.
    const email = { payeeEmail: 'dana@example.com' };
    await requestSpend(spend('cart', 10_000, email));
    expect(await requestSpend(spend('cart', 10_000, { ...email, ...change }))).toEqual({ status: 'refused', reason: 'reference_reused' });
  });

  it('does not confuse which field a value was set on', async () => {
    await clear(50_000);
    await connectWallet();
    const { requestSpend } = executor();
    await requestSpend(spend('cart', 10_000, { payee: 'x' }));
    expect(await requestSpend(spend('cart', 10_000, { fundedBySponsorId: 'x' }))).toEqual({ status: 'refused', reason: 'reference_reused' });
  });

  it('plays the Gate 2 beats as scripts/gate2-check.ts sends them, once a sponsor has paid', async () => {
    await clear(300_000);
    await connectWallet();
    const { requestSpend, revokeWallet } = executor();
    const demo = (referenceId: string, amountMinor: number, extra: Partial<Spend>) =>
      spend(referenceId, amountMinor, { actor: 'demo:treasurer', category: undefined, ...extra });

    const auto = await requestSpend(demo('gate2-140', 14_000, { category: 'swag', vendor: 'Lanyard Co' }));
    expect(auto.status).toBe('paid');
    // No approval step since #115: the $420 cart is checked and paid like the $140 one.
    const big = await requestSpend(demo('gate2-420', 42_000, { category: 'prizes', vendor: 'Prize Co' }));
    expect(big.status).toBe('paid');

    await revokeWallet('treasurer').catch(() => undefined); // the fake PayPal does not do token deletes; our flag still flips
    expect(await requestSpend(demo('gate2-after-kill', 14_000, {}))).toEqual({ status: 'refused', reason: 'no_wallet' });
  });
});
