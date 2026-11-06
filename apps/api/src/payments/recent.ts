import { RuleResult, SpendStatus, type SpendEntry } from '@quartermaster/shared';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { approvals, auditLog } from '../db/schema.js';

// What the executor decided, newest first: the spend.check audit rows, with the approval's status laid over a request that
// was sent to the treasurer (the audit row says "needs_approval" forever; the approval says whether it was then paid).
// Raw `detail` is left out on purpose: it can carry PayPal's error text. Rows that do not parse are skipped, never guessed.
const Input = z.looseObject({
  amountMinor: z.number().int().nonnegative().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  category: z.string().optional(),
  vendor: z.string().optional(),
  eventId: z.string().optional(),
  kind: z.string().optional(),
  fundedBySponsorId: z.string().optional(),
});

const FROM_APPROVAL = { pending: 'needs_approval', capturing: 'capturing', rejected: 'rejected', paid: 'paid' } as const;

// eventIds narrows to spends of those events (the ones a treasurer can see); an empty list matches nothing.
export async function recentSpends(
  db: Db,
  options: { limit?: number; eventId?: string; eventIds?: string[] } = {},
): Promise<SpendEntry[]> {
  const limit = options.limit ?? 20;
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.createdAt,
      actor: auditLog.actor,
      reason: auditLog.reason,
      input: auditLog.input,
      ruleResult: auditLog.ruleResult,
      outcome: auditLog.outcome,
      paypalId: auditLog.paypalId,
      approval: approvals.status,
    })
    .from(auditLog)
    // approvals.paypal_order_id is unique, so this never repeats an audit row
    .leftJoin(approvals, eq(approvals.paypalOrderId, auditLog.paypalId))
    .where(
      and(
        eq(auditLog.action, 'spend.check'),
        isNotNull(auditLog.ruleResult),
        options.eventId ? sql`${auditLog.input}->>'eventId' = ${options.eventId}` : undefined,
        options.eventIds ? inArray(sql`${auditLog.input}->>'eventId'`, options.eventIds) : undefined,
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    // Read extra rows: a few unreadable ones must not hide readable ones behind them.
    .limit(limit * 3);

  const entries: SpendEntry[] = [];
  for (const row of rows) {
    if (entries.length >= limit) break;
    let result: RuleResult | undefined;
    try {
      const parsed = RuleResult.safeParse(JSON.parse(row.ruleResult ?? ''));
      result = parsed.success ? parsed.data : undefined;
    } catch {
      result = undefined;
    }
    if (!result) continue;
    const input = Input.safeParse(row.input ?? {});
    const spend = input.success ? input.data : {};
    const known = SpendStatus.safeParse(row.outcome);
    entries.push({
      id: row.id,
      at: row.at.toISOString(),
      actor: row.actor,
      amountMinor: spend.amountMinor ?? null,
      currency: spend.currency ?? null,
      category: spend.category ?? null,
      vendor: spend.vendor ?? null,
      agentReason: row.reason,
      decision: result.decision,
      reasons: result.reasons,
      status: row.approval ? FROM_APPROVAL[row.approval] : known.success ? known.data : 'unknown',
      paypalId: row.paypalId,
      eventId: spend.eventId ?? null,
      ...(spend.kind ? { kind: spend.kind } : {}),
      ...(spend.fundedBySponsorId ? { fundedBySponsorId: spend.fundedBySponsorId } : {}),
    });
  }
  return entries;
}
