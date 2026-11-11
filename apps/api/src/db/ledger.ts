import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { ledgerEntries } from './schema.js';

export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
export type LedgerRow = typeof ledgerEntries.$inferSelect;

// Sources that count as cleared income. A refund is also direction 'in' (money back from a vendor),
// but it is not income, so it stays out of this list.
export const INCOME_SOURCES = ['sponsor_invoice', 'subscription', 'ticket', 'donation'] as const;

// Income that went back out: a Treasury capture refunded by us or reversed by PayPal (chargeback).
// Always direction 'out', and subtracted from cleared income.
export const INCOME_REVERSAL_SOURCE = 'income_reversal' as const;

// Inserts one PayPal-confirmed entry. Returns false when (source, paypalId) is already recorded,
// so a replayed or retried webhook never counts the same money twice.
export async function recordLedgerEntry(db: Db, entry: NewLedgerEntry): Promise<boolean> {
  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) {
    throw new RangeError(`Ledger amount must be a positive integer of minor units, got ${entry.amount}`);
  }
  if (!entry.paypalId) throw new RangeError('Ledger entry needs the PayPal id that confirmed it');
  if (entry.source === INCOME_REVERSAL_SOURCE && entry.direction !== 'out') {
    throw new RangeError('An income reversal is money going out');
  }
  const rows = await db
    .insert(ledgerEntries)
    .values(entry)
    .onConflictDoNothing({ target: [ledgerEntries.source, ledgerEntries.paypalId] })
    .returning({ id: ledgerEntries.id });
  return rows.length > 0;
}

export function listLedger(db: Db, eventId: string) {
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.eventId, eventId))
    .orderBy(desc(ledgerEntries.createdAt));
}

// The income row a PayPal capture created, if that capture was income we recorded. Refund and
// reversal handlers use it so they only ever undo money that this ledger counted.
export async function findIncomeByCapture(db: Db, captureId: string): Promise<LedgerRow | undefined> {
  const [row] = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.captureId, captureId),
        eq(ledgerEntries.direction, 'in'),
        inArray(ledgerEntries.source, [...INCOME_SOURCES]),
      ),
    )
    .limit(1);
  return row;
}

// Cleared income in one currency, in minor units: income in minus income reversals (refunds and
// chargebacks of that income). Pledged and invoiced-but-unpaid money is never here. It can dip below
// zero only when PayPal kept fees on a refund, which is real money lost.
// Unlocked budget (cleared income minus committed spend) is P1's budget function; this is its input.
export async function clearedIncome(db: Db, eventId: string, currency: string): Promise<number> {
  const rows = await db
    .select({ total: clearedSum })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.eventId, eventId), eq(ledgerEntries.currency, currency)));
  return Number(rows[0]?.total ?? 0);
}

// Cleared income per sponsor, by the same arithmetic as clearedIncome (one shared expression, so the two
// cannot disagree). Income with no sponsor, such as tickets and donations, is not in the map.
export async function clearedIncomeBySponsor(
  db: Db,
  eventId: string,
  currency: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ sponsorId: ledgerEntries.sponsorId, total: clearedSum })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.eventId, eventId),
        eq(ledgerEntries.currency, currency),
        isNotNull(ledgerEntries.sponsorId),
      ),
    )
    .groupBy(ledgerEntries.sponsorId);
  return new Map(
    rows.flatMap((r) => (r.sponsorId ? [[r.sponsorId, Number(r.total)] as const] : [])),
  );
}

// Income in minus income reversals (refunds and chargebacks of that income), in minor units.
const clearedSum = sql<string>`coalesce(sum(case
  when ${ledgerEntries.direction} = 'in' and ${inArray(ledgerEntries.source, [...INCOME_SOURCES])}
    then ${ledgerEntries.amount}
  when ${ledgerEntries.direction} = 'out' and ${ledgerEntries.source} = ${INCOME_REVERSAL_SOURCE}
    then -${ledgerEntries.amount}
  else 0 end), 0)`;
