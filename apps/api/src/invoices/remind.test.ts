import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { auditLog, sponsors } from '../db/schema.js';
import { seedDemoEvent } from '../db/seed.js';
import { createTestDb } from '../db/testing.js';
import type { PayPalClient } from '../paypal/client.js';
import { listInvoicedSponsorIds, remindSponsor } from './remind.js';

let db: Db;
let sponsorId: string;
beforeEach(async () => {
  db = await createTestDb();
  await seedDemoEvent(db);
  const [s] = await db.select().from(sponsors);
  sponsorId = s!.id;
  await db.update(sponsors).set({ status: 'invoiced', paypalInvoiceId: 'INV2-TEST' }).where(eq(sponsors.id, sponsorId));
});

// A PayPal that answers GET invoice with `status` and records every POST path; `remindFails` makes the remind call throw.
function fakePayPal(status: string, remindFails = false) {
  const posts: string[] = [];
  const client = {
    app: 'treasury',
    getAccessToken: async () => 'tok',
    request: async (req: { method: string; path: string; schema: { parse(v: unknown): unknown } }) => {
      if (req.method === 'GET') return req.schema.parse({ id: 'INV2-TEST', status, detail: {} });
      posts.push(req.path);
      if (remindFails) throw new Error('PayPal is down');
      return undefined;
    },
  } as unknown as PayPalClient;
  return { client, posts };
}

const deps = (client: PayPalClient, minIntervalHours = 24) => ({ db, client, minIntervalHours });
const actions = async () => (await db.select().from(auditLog)).map((r) => r.action);

describe('remindSponsor', () => {
  it('lists only sponsors that are invoiced', async () => {
    expect(await listInvoicedSponsorIds(db)).toEqual([sponsorId]);
  });

  it('reminds when PayPal still shows the invoice open, and audits it with the invoice id', async () => {
    const { client, posts } = fakePayPal('SENT');
    expect(await remindSponsor(deps(client), sponsorId)).toBe('reminded');
    expect(posts).toEqual(['/v2/invoicing/invoices/INV2-TEST/remind']);
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'invoice.reminder'));
    expect(row).toMatchObject({ actor: 'workflow:invoice-reminders', paypalId: 'INV2-TEST' });
  });

  it('does not remind twice inside the interval, but does once the interval is 0', async () => {
    const { client, posts } = fakePayPal('SENT');
    await remindSponsor(deps(client), sponsorId);
    expect(await remindSponsor(deps(client), sponsorId)).toBe('recent');
    expect(posts).toHaveLength(1);
    expect(await remindSponsor(deps(client, 0), sponsorId)).toBe('reminded');
  });

  it('never nags a payment whose webhook has not landed: PayPal says paid, we leave our records alone', async () => {
    const { client, posts } = fakePayPal('PAID');
    expect(await remindSponsor(deps(client), sponsorId)).toBe('already_paid');
    expect(posts).toEqual([]);
    const [s] = await db.select().from(sponsors).where(eq(sponsors.id, sponsorId));
    expect(s!.status).toBe('invoiced');
  });

  it('skips cancelled invoices, paid or uninvoiced sponsors and unknown ids', async () => {
    expect(await remindSponsor(deps(fakePayPal('CANCELLED').client), sponsorId)).toBe('not_open');
    await db.update(sponsors).set({ status: 'paid' }).where(eq(sponsors.id, sponsorId));
    expect(await remindSponsor(deps(fakePayPal('SENT').client), sponsorId)).toBe('already_paid');
    await db.update(sponsors).set({ status: 'pledged', paypalInvoiceId: null }).where(eq(sponsors.id, sponsorId));
    expect(await remindSponsor(deps(fakePayPal('SENT').client), sponsorId)).toBe('no_invoice');
    expect(await remindSponsor(deps(fakePayPal('SENT').client), crypto.randomUUID())).toBe('not_found');
    expect(await actions()).not.toContain('invoice.reminder');
  });

  it('a failed PayPal call is audited as a failure and thrown, so the retry is not skipped as recent', async () => {
    await expect(remindSponsor(deps(fakePayPal('SENT', true).client), sponsorId)).rejects.toThrow('PayPal is down');
    expect(await actions()).toEqual(['invoice.reminder_failed']);
    expect(await remindSponsor(deps(fakePayPal('SENT').client), sponsorId)).toBe('reminded');
  });
});
