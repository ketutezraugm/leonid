import { asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agentWallet, demoTokenPool } from '../db/schema.js';
import type { PayPalClient } from '../paypal/client.js';
import { PayPalApiError } from '../paypal/errors.js';
import { createPaymentToken, deletePaymentToken } from '../paypal/vault.js';

// The hosted demo's pool of standby wallet tokens (see demoTokenPool in db/schema.ts). Standby tokens are never read for
// spending: the only way one becomes the agent's wallet is promoteNextStandby, which a treasurer triggers by hand.

export const MAX_POOL = 5;

export async function poolCounts(db: Db): Promise<{ waiting: number; standby: number }> {
  const rows = await db.select({ token: demoTokenPool.paymentTokenId }).from(demoTokenPool);
  const standby = rows.filter((r) => r.token !== null).length;
  return { waiting: rows.length - standby, standby };
}

export async function addPoolSetup(db: Db, setupTokenId: string): Promise<void> {
  await db.insert(demoTokenPool).values({ setupTokenId }).onConflictDoNothing();
}

// The payer approved a pool link: turn its setup token into a payment token and keep it on standby. Only setup tokens we
// created and have not exchanged yet are accepted, so the return redirect cannot be used to inject or replay one.
// ponytail: if PayPal creates the token and the update below then fails, the token is orphaned at PayPal; the setup token's
// request id makes a retry return the same token, but the redirect is one-shot, so Ezra would just fill one more link.
export async function exchangePoolSetup(db: Db, client: PayPalClient, setupTokenId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(demoTokenPool)
    .where(eq(demoTokenPool.setupTokenId, setupTokenId));
  if (!row || row.paymentTokenId !== null) return false;
  const saved = await createPaymentToken(client, { setupTokenId });
  await db
    .update(demoTokenPool)
    .set({ paymentTokenId: saved.paymentTokenId, customerId: saved.customerId ?? null, payerEmail: saved.payerEmail ?? null })
    .where(eq(demoTokenPool.id, row.id));
  return true;
}

// Reset: the oldest standby token becomes the active wallet, in one transaction. The partial unique index on agent_wallet
// refuses a second active token, which rolls the whole thing back and keeps the pool row. Null when nothing is on standby.
export async function promoteNextStandby(db: Db): Promise<{ paymentTokenId: string; payerEmail: string | null } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(demoTokenPool)
      .where(isNotNull(demoTokenPool.paymentTokenId))
      .orderBy(asc(demoTokenPool.createdAt))
      .limit(1)
      .for('update');
    if (!row?.paymentTokenId) return null;
    await tx.delete(demoTokenPool).where(eq(demoTokenPool.id, row.id));
    await tx
      .insert(agentWallet)
      .values({ paymentTokenId: row.paymentTokenId, customerId: row.customerId, payerEmail: row.payerEmail, status: 'active' });
    return { paymentTokenId: row.paymentTokenId, payerEmail: row.payerEmail };
  });
}

// End of the demo: delete every standby token at PayPal and forget the unfinished links. A token whose delete fails (anything
// but 404, which means it is already gone) stays in the pool, so calling this again retries it.
export async function endDemoPool(db: Db, client: PayPalClient): Promise<{ deleted: number; failed: number }> {
  await db.delete(demoTokenPool).where(isNull(demoTokenPool.paymentTokenId));
  const standby = await db.select().from(demoTokenPool).where(isNotNull(demoTokenPool.paymentTokenId));
  let deleted = 0;
  let failed = 0;
  for (const row of standby) {
    try {
      await deletePaymentToken(client, row.paymentTokenId!);
    } catch (err) {
      if (!(err instanceof PayPalApiError && err.status === 404)) {
        failed += 1;
        continue;
      }
    }
    await db.delete(demoTokenPool).where(eq(demoTokenPool.id, row.id));
    deleted += 1;
  }
  return { deleted, failed };
}
