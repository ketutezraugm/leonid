import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db/testing.js';
import type { Db } from '../db/client.js';
import { createDbApprovals, createDbAudit, createDbReferences, createDbWalletStore } from './db.js';
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
    await approvals.markPaid(id);
    expect((await createDbApprovals(db).list())[0]).toMatchObject({ id, status: 'paid', reasons: ['over $200'], paypalOrderId: 'ORDER-1' });
    expect(await approvals.get('not-a-uuid')).toBeNull();
  });
});
