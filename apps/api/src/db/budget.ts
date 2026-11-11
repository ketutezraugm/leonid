import { RuleResult } from '@leonid/shared';
import { and, eq, gte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Spend } from '../payments/ports.js';
import { committedSpends, sumMinor, unlockedBudget, type SpendRecord } from '../rules/budget.js';
import { normalizeName, payeeKey, type Budget } from '../rules/check.js';
import type { Db } from './client.js';
import { listSponsors } from './events.js';
import { clearedIncome, clearedIncomeBySponsor } from './ledger.js';
import { approvals, auditLog } from './schema.js';

// Everything check() needs to know about money, read fresh for one spend. Committed spend comes from what the executor
// recorded (audit rows and approvals), because purchases do not reach the ledger: the ledger holds income only so far.
// Payouts count here once they go through the executor (F16).

const Input = z.looseObject({
  referenceId: z.string(),
  amountMinor: z.number().int().nonnegative(),
  category: z.string().optional(),
  eventId: z.string().optional(),
  kind: z.string().optional(),
  payee: z.string().optional(),
  payeeEmail: z.string().optional(),
});

const startOfUtcDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

function decisionOf(raw: string | null): SpendRecord['decision'] {
  try {
    const parsed = RuleResult.safeParse(JSON.parse(raw ?? ''));
    return parsed.success ? parsed.data.decision : null;
  } catch {
    return null;
  }
}

export async function loadBudget(db: Db, spend: Spend, now: Date): Promise<Budget> {
  const today = startOfUtcDay(now);
  const rows = await db
    .select({
      input: auditLog.input,
      ruleResult: auditLog.ruleResult,
      outcome: auditLog.outcome,
      createdAt: auditLog.createdAt,
      approval: approvals.status,
    })
    .from(auditLog)
    .leftJoin(approvals, sql`${approvals.spend}->>'referenceId' = ${auditLog.input}->>'referenceId'`)
    .where(
      and(
        eq(auditLog.action, 'spend.check'),
        sql`${auditLog.input}->>'currency' = ${spend.currency}`,
        or(
          gte(auditLog.createdAt, today),
          spend.eventId ? sql`${auditLog.input}->>'eventId' = ${spend.eventId}` : undefined,
        ),
      ),
    );

  const parsed = rows.flatMap((row) => {
    const input = Input.safeParse(row.input);
    // A retry of this very spend must not find itself in the way.
    if (!input.success || input.data.referenceId === spend.referenceId) return [];
    const record: SpendRecord = {
      referenceId: input.data.referenceId,
      amountMinor: input.data.amountMinor,
      category: input.data.category ?? null,
      decision: decisionOf(row.ruleResult),
      outcome: row.outcome,
      approval: row.approval,
    };
    return [{ record, input: input.data, isToday: row.createdAt >= today }];
  });

  const todays = parsed.filter((p) => p.isToday);
  const autoPaidToday = committedSpends(todays.map((p) => p.record)).filter((s) => s.autoPaid);
  const who = payeeKey(spend);
  const claimsToday = committedSpends(
    todays
      .filter((p) => p.input.kind === 'claim' && who !== undefined && payeeKey(p.input) === who)
      .map((p) => p.record),
  );

  return {
    funds: spend.eventId ? await loadFunds(db, spend.eventId, spend.currency, parsed) : null,
    autoPaidTodayMinor: sumMinor(autoPaidToday),
    claimedTodayMinor: sumMinor(claimsToday),
  };
}

// Every spend.check record of one event, in the shape committedSpends() reads: the rows loadFunds counts for that event.
// The budget burn widget (P3, F20) reads this so it shows the same committed spend that check() enforces.
export async function loadEventSpendRecords(db: Db, eventId: string, currency: string): Promise<SpendRecord[]> {
  const rows = await db
    .select({ input: auditLog.input, ruleResult: auditLog.ruleResult, outcome: auditLog.outcome, approval: approvals.status })
    .from(auditLog)
    .leftJoin(approvals, sql`${approvals.spend}->>'referenceId' = ${auditLog.input}->>'referenceId'`)
    .where(
      and(
        eq(auditLog.action, 'spend.check'),
        sql`${auditLog.input}->>'currency' = ${currency}`,
        sql`${auditLog.input}->>'eventId' = ${eventId}`,
      ),
    );
  return rows.flatMap((row) => {
    const input = Input.safeParse(row.input);
    if (!input.success) return [];
    return [
      {
        referenceId: input.data.referenceId,
        amountMinor: input.data.amountMinor,
        category: input.data.category ?? null,
        decision: decisionOf(row.ruleResult),
        outcome: row.outcome,
        approval: row.approval,
      },
    ];
  });
}

async function loadFunds(
  db: Db,
  eventId: string,
  currency: string,
  parsed: readonly { record: SpendRecord; input: { eventId?: string } }[],
): Promise<NonNullable<Budget['funds']>> {
  const [cleared, clearedBySponsor, sponsors] = await Promise.all([
    clearedIncome(db, eventId, currency),
    clearedIncomeBySponsor(db, eventId, currency),
    listSponsors(db, eventId),
  ]);
  const committed = committedSpends(
    parsed.filter((p) => p.input.eventId === eventId).map((p) => p.record),
  );
  const committedByCategoryMinor: Record<string, number> = {};
  for (const { category, amountMinor } of committed) {
    if (category === null) continue;
    const key = normalizeName(category);
    committedByCategoryMinor[key] = (committedByCategoryMinor[key] ?? 0) + amountMinor;
  }
  return {
    unlockedMinor: unlockedBudget(cleared, sumMinor(committed)),
    committedMinor: sumMinor(committed),
    committedByCategoryMinor,
    // A refund or chargeback nets the sponsor's cleared money to zero and closes the gate again.
    paidSponsorIds: sponsors
      .filter((s) => s.status === 'paid' && (clearedBySponsor.get(s.id) ?? 0) > 0)
      .map((s) => s.id),
  };
}
