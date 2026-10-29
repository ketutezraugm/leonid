import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { ledgerEntries } from './schema.js';

export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;

// Sources that count as cleared income. A refund is also direction 'in' (money back from a vendor),
// but it is not income, so it stays out of this list.
export const INCOME_SOURCES = ['sponsor_invoice', 'subscription', 'ticket', 'donation'] as const;

// Inserts one PayPal-confirmed entry. Returns false when (source, paypalId) is already recorded,
// so a replayed or retried webhook never counts the same money twice.
export async function recordLedgerEntry(db: Db, entry: NewLedgerEntry): Promise<boolean> {
  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) {
    throw new RangeError(`Ledger amount must be a positive integer of minor units, got ${entry.amount}`);
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

// Cleared income in one currency, in minor units. Pledged and invoiced-but-unpaid money is never here.
// Unlocked budget (cleared income minus committed spend) is P1's budget function; this is its input.
export async function clearedIncome(db: Db, eventId: string, currency: string): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(
      sql`${ledgerEntries.eventId} = ${eventId}
        and ${ledgerEntries.currency} = ${currency}
        and ${ledgerEntries.direction} = 'in'
        and ${inArray(ledgerEntries.source, [...INCOME_SOURCES])}`,
    );
  return Number(rows[0]?.total ?? 0);
}
