import { SpendsResponse } from '@quartermaster/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { createTestDb } from '../db/testing.js';
import { createDbApprovals, createDbAudit } from './db.js';
import type { CheckResult, Spend } from './ports.js';
import { recentSpends } from './recent.js';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const EVENT = '3bbd0ba2-ed6c-41d4-a8f0-719e60f44a13';
const allow: CheckResult = { decision: 'allow', reasons: ['within the auto-pay limit'], ruleIds: ['r1'] };
const needs: CheckResult = { decision: 'needs_approval', reasons: ['over the $200 approval threshold'], ruleIds: ['r1'] };
const block: CheckResult = { decision: 'block', reasons: ['vendor not on the approved list'], ruleIds: ['r2'] };
// eventId is on Spend once the timeout/eventId PR lands; this reads whatever the audit row's input carries.
const spend = (referenceId: string, amountMinor: number, extra: Partial<Spend> & { eventId?: string } = {}): Spend => ({
  referenceId,
  amountMinor,
  currency: 'USD',
  actor: 'procurement-agent',
  reason: `reason for ${referenceId}`,
  ...extra,
});

// What the executor does for one request: write the row first, then update it with the result.
async function request(s: Spend, result: CheckResult, update: { outcome?: string; paypalId?: string; detail?: string }) {
  const audit = createDbAudit(db);
  const id = await audit.record({ actor: s.actor, action: 'spend.check', input: s, reason: s.reason, ruleResult: result });
  if (update.outcome) await audit.update(id, { outcome: update.outcome, paypalId: update.paypalId, detail: update.detail });
  return id;
}

describe('recentSpends', () => {
  it('lists requests newest first with the rule decision, reasons, outcome and PayPal id, and hides the raw detail', async () => {
    await request(spend('cart-1', 14_000, { category: 'swag', vendor: 'Lanyard Co', eventId: EVENT }), allow, { outcome: 'paid', paypalId: 'CAP-1' });
    await request(spend('cart-2', 90_000, { category: 'venue' }), block, { outcome: 'blocked', detail: 'vendor not on the approved list' });
    await request(spend('cart-3', 5_000), allow, { outcome: 'refused', detail: 'PayPal 403 NOT_AUTHORIZED secret-ish detail' });

    const list = await recentSpends(db);
    expect(list.map((e) => e.amountMinor)).toEqual([5_000, 90_000, 14_000]);
    expect(list[2]).toMatchObject({
      actor: 'procurement-agent',
      currency: 'USD',
      category: 'swag',
      vendor: 'Lanyard Co',
      agentReason: 'reason for cart-1',
      decision: 'allow',
      reasons: ['within the auto-pay limit'],
      status: 'paid',
      paypalId: 'CAP-1',
      eventId: EVENT,
    });
    expect(list[1]).toMatchObject({ decision: 'block', status: 'blocked', paypalId: null, eventId: null });
    expect(list[0]?.status).toBe('refused');
    expect(JSON.stringify(list)).not.toContain('secret-ish');
    expect(SpendsResponse.parse({ spends: list }).spends).toHaveLength(3);
  });

  it('shows a request sent to the treasurer as waiting, then follows its approval to paid or rejected', async () => {
    const approvals = createDbApprovals(db);
    const open = async (ref: string, order: string) => {
      const s = spend(ref, 42_000);
      const auditId = await request(s, needs, { outcome: 'needs_approval', paypalId: order });
      const id = await approvals.create(s, needs, auditId);
      await approvals.attachOrder(id, order);
      return id;
    };
    await open('prize-1', 'ORD-1');
    const paid = await open('prize-2', 'ORD-2');
    const declined = await open('prize-3', 'ORD-3');
    const inFlight = await open('prize-4', 'ORD-4');
    await approvals.claimCapture(paid); // pending -> capturing -> paid, as the executor does
    await approvals.markPaid(paid);
    await approvals.reject(declined, 'treasurer');
    await approvals.claimCapture(inFlight);

    const byOrder = Object.fromEntries((await recentSpends(db)).map((e) => [e.paypalId, e.status]));
    expect(byOrder).toEqual({ 'ORD-1': 'needs_approval', 'ORD-2': 'paid', 'ORD-3': 'rejected', 'ORD-4': 'capturing' });
  });

  it('filters by event, limits the count, skips rows it cannot read and rows that are not spend checks', async () => {
    await request(spend('a', 1_000, { eventId: EVENT }), allow, { outcome: 'paid' });
    await request(spend('b', 2_000), allow, { outcome: 'paid' });
    await request(spend('c', 3_000, { eventId: EVENT }), allow, {}); // no result recorded yet
    await db.insert(auditLog).values({ actor: 'x', action: 'spend.check', input: spend('bad', 9), ruleResult: 'not json' });
    await db.insert(auditLog).values({ actor: 'x', action: 'spend.check', input: spend('bad2', 9), ruleResult: '{"decision":"maybe"}' });
    await db.insert(auditLog).values({ actor: 'x', action: 'wallet.revoke', input: {}, ruleResult: JSON.stringify(allow) });

    const forEvent = await recentSpends(db, { eventId: EVENT });
    expect(forEvent.map((e) => e.amountMinor)).toEqual([3_000, 1_000]);
    expect(forEvent[0]?.status).toBe('unknown');
    expect(await recentSpends(db)).toHaveLength(3);
    expect(await recentSpends(db, { limit: 2 })).toHaveLength(2);
    expect(await recentSpends(db, { eventId: '00000000-0000-4000-8000-000000000000' })).toEqual([]);
  });
});
