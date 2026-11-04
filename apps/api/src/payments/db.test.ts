import { beforeEach, describe, expect, it } from 'vitest';
import { approvals as approvalsTable, spendReferences } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import type { Db } from '../db/client.js';
import { createDbApprovals, createDbAudit, createDbReferences, createDbWalletStore } from './db.js';
import { createMemoryApprovals } from './memory.js';
import type { Spend } from './ports.js';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const spend: Spend = { referenceId: 'cart-1', amountMinor: 42_000, currency: 'USD', actor: 'agent', reason: 'swag' };
const result = { decision: 'needs_approval' as const, reasons: ['over $200'], ruleIds: ['r1'] };

describe('wallet', () => {
  it('survives a restart, refuses a second live token, and keeps a revoked token until PayPal confirms the delete', async () => {
    await createDbWalletStore(db).activate({ paymentTokenId: 'pt_1', payerEmail: 'a@example.com' });

    const wallet = createDbWalletStore(db); // "restart": fresh adapter, same database
    expect(await wallet.getActive()).toEqual({ paymentTokenId: 'pt_1' });
    expect(await wallet.snapshot()).toEqual({ status: 'active', payerEmail: 'a@example.com' });
    await expect(wallet.activate({ paymentTokenId: 'pt_2' })).rejects.toThrow();

    await wallet.markRevoked();
    expect(await wallet.getActive()).toBeNull();
    expect((await wallet.snapshot()).status).toBe('revoked');
    expect(await wallet.pendingDeletions()).toEqual(['pt_1']);
    await wallet.confirmDeleted('pt_1');
    expect(await wallet.pendingDeletions()).toEqual([]);

    await wallet.activate({ paymentTokenId: 'pt_3' }); // reconnecting after the kill switch works
    expect((await wallet.snapshot()).status).toBe('active');
  });

  it('queues a never-active token for deletion, and accepts a setup token once', async () => {
    const wallet = createDbWalletStore(db);
    expect((await wallet.snapshot()).status).toBe('none');
    await wallet.queueDeletion('pt_orphan');
    expect(await wallet.pendingDeletions()).toEqual(['pt_orphan']);

    await wallet.beginSetup('setup_1');
    expect(await wallet.takeSetup('setup_1')).toBe(true);
    expect(await wallet.takeSetup('setup_1')).toBe(false);
    expect(await wallet.takeSetup('never_created')).toBe(false);
  });
});

describe('references', () => {
  it('lets an identical spend retry but refuses the id for a different one', async () => {
    const refs = createDbReferences(db);
    expect(await refs.claim('cart-1', 'fp-a')).toBe('new');
    expect(await createDbReferences(db).claim('cart-1', 'fp-a')).toBe('same');
    expect(await refs.claim('cart-1', 'fp-b')).toBe('conflict');
  });
});

describe('audit and approvals', () => {
  it('writes the audit row first, updates it with the PayPal result, and tracks an approval to paid', async () => {
    const audit = createDbAudit(db);
    const approvals = createDbApprovals(db);
    const auditId = await audit.record({ actor: 'agent', action: 'spend.request', input: spend, reason: 'swag', ruleResult: result });
    const id = await approvals.create(spend, result, auditId);
    await approvals.attachOrder(id, 'ORDER-1');
    await audit.update(auditId, { outcome: 'needs_approval', paypalId: 'ORDER-1' });

    expect(await approvals.get(id)).toEqual({ spend, status: 'pending', paypalOrderId: 'ORDER-1' });
    expect(await approvals.claimCapture(id)).toBe(true);
    expect(await approvals.markPaid(id)).toBe(true);
    expect((await createDbApprovals(db).list())[0]).toMatchObject({ id, status: 'paid', reasons: ['over $200'], paypalOrderId: 'ORDER-1' });
    expect(await approvals.get('not-a-uuid')).toBeNull();
    expect(await approvals.findByOrder('ORDER-1')).toBe(id);
    const second = await approvals.create({ ...spend, referenceId: 'cart-2' }, result, auditId);
    expect((await approvals.list()).map((a) => a.id)).toEqual([id, second]); // oldest first
    expect((await approvals.list())[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await approvals.findByOrder('ORDER-2')).toBeNull();
  });

  it("keeps the spend's event on the approval and the reference as a column, and refuses an event that does not exist", async () => {
    const { id: eventId } = await seedDemoEvent(db);
    const approvals = createDbApprovals(db);
    const auditId = await createDbAudit(db).record({ actor: 'agent', action: 'spend.check', input: spend, reason: 'swag' });
    const id = await approvals.create({ ...spend, eventId }, result, auditId);
    expect((await db.select().from(approvalsTable))[0]).toMatchObject({ id, eventId });
    expect(await createDbReferences(db).claim('cart-1', 'fp', eventId)).toBe('new');
    expect((await db.select().from(spendReferences))[0]).toMatchObject({ referenceId: 'cart-1', eventId });
    await expect(approvals.create({ ...spend, referenceId: 'cart-2', eventId: crypto.randomUUID() }, result, auditId)).rejects.toThrow();
  });

  it('breaks ties between approvals created in the same instant by id, so the order is stable', async () => {
    const approvals = createDbApprovals(db);
    const auditId = await createDbAudit(db).record({ actor: 'agent', action: 'spend.check', input: spend, reason: 'swag' });
    const ids = [];
    for (const ref of ['cart-a', 'cart-b', 'cart-c']) ids.push(await approvals.create({ ...spend, referenceId: ref }, result, auditId));
    await db.update(approvalsTable).set({ createdAt: new Date('2027-03-14T09:00:00Z') });
    expect((await approvals.list()).map((a) => a.id)).toEqual([...ids].sort());
  });
});

// Both adapters must give the same answers: the executor's race safety rests on these transitions being conditional.
describe.each([
  ['db', () => createDbApprovals(db)],
  ['memory', () => createMemoryApprovals()],
] as const)('approval status transitions (%s)', (_name, make) => {
  async function pendingApproval(referenceId = 'cart-1', orderId = 'ORDER-1') {
    const approvals = make();
    const auditId = await createDbAudit(db).record({ actor: 'agent', action: 'spend.check', input: spend, reason: 'swag' });
    const id = await approvals.create({ ...spend, referenceId }, result, auditId);
    await approvals.attachOrder(id, orderId);
    return { approvals, id, auditId };
  }

  it('lets exactly one of two concurrent claims win', async () => {
    const { approvals, id } = await pendingApproval();
    expect((await Promise.all([approvals.claimCapture(id), approvals.claimCapture(id)])).sort()).toEqual([false, true]);
    expect((await approvals.get(id))?.status).toBe('capturing');
  });

  it('refuses a reject once a capture has claimed the approval, and a claim once it is rejected', async () => {
    const { approvals, id } = await pendingApproval();
    expect(await approvals.claimCapture(id)).toBe(true);
    expect(await approvals.reject(id, 'treasurer')).toBe(false);
    expect(await approvals.markPaid(id)).toBe(true);
    expect(await approvals.markPaid(id)).toBe(false);
    expect((await approvals.get(id))?.status).toBe('paid');

    const other = await pendingApproval('cart-2', 'ORDER-2');
    expect(await other.approvals.reject(other.id, 'treasurer')).toBe(true);
    expect(await other.approvals.claimCapture(other.id)).toBe(false);
    expect(await other.approvals.markPaid(other.id)).toBe(false); // paid only from capturing, never from pending or rejected
  });

  it('releases a claim back to pending, after which it can be rejected', async () => {
    const { approvals, id } = await pendingApproval();
    expect(await approvals.releaseCapture(id)).toBe(false); // nothing to release
    await approvals.claimCapture(id);
    expect(await approvals.releaseCapture(id)).toBe(true);
    expect(await approvals.reject(id, 'treasurer')).toBe(true);
  });

  it('finds the approval for a reference id, and refuses a second approval for the same PayPal order', async () => {
    const { approvals, id, auditId } = await pendingApproval('cart-9', 'ORDER-9');
    expect(await approvals.findByReference('cart-9')).toEqual({
      id,
      spend: { ...spend, referenceId: 'cart-9' },
      status: 'pending',
      reasons: ['over $200'],
      paypalOrderId: 'ORDER-9',
    });
    expect(await approvals.findByReference('cart-unknown')).toBeNull();
    const second = await approvals.create({ ...spend, referenceId: 'cart-10' }, result, auditId);
    await expect(approvals.attachOrder(second, 'ORDER-9')).rejects.toThrow();
  });
});
