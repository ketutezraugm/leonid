import {
  CurrencyCode,
  FundingThermometerData,
  RuleResult,
  RulesHealthData,
  type RulesHealthEntry,
  type WidgetFilter,
} from '@quartermaster/shared';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { getEvent, listSponsors } from '../db/events.js';
import { clearedIncomeBySponsor } from '../db/ledger.js';
import { auditLog } from '../db/schema.js';

// Funding thermometer: pledged, invoiced and cleared per sponsor, for one event. Read-only.
//  - invoiced is the pledge once the sponsor is invoiced or paid: an invoice is always for the full
//    pledge (invoices/send.ts), so it is all or nothing.
//  - cleared is PayPal-confirmed money from the ledger, net of refunds. It is never below zero here,
//    because the shared shape is non-negative.
//  - income without a sponsor (tickets, donations) is not part of this widget.
//  - the category filter has no meaning for sponsors, so only sponsorId narrows it.
// Returns undefined when the event does not exist.
export async function getFundingThermometer(
  db: Db,
  eventId: string,
  filter: WidgetFilter = {},
  now: Date = new Date(),
): Promise<FundingThermometerData | undefined> {
  const event = await getEvent(db, eventId);
  if (!event) return undefined;
  const [all, cleared] = await Promise.all([
    listSponsors(db, eventId),
    clearedIncomeBySponsor(db, eventId, event.currency),
  ]);
  const sponsors = all
    .filter((s) => !filter.sponsorId || s.id === filter.sponsorId)
    .map((s) => ({
      sponsorId: s.id,
      name: s.name,
      tier: s.tier,
      pledged: s.pledged,
      invoiced: s.status === 'invoiced' || s.status === 'paid' ? s.pledged : 0,
      cleared: Math.max(0, cleared.get(s.id) ?? 0),
    }));
  const sum = (pick: (s: (typeof sponsors)[number]) => number) =>
    sponsors.reduce((t, s) => t + pick(s), 0);
  return FundingThermometerData.parse({
    asOf: now.toISOString(),
    currency: event.currency,
    sponsors,
    totals: {
      pledged: sum((s) => s.pledged),
      invoiced: sum((s) => s.invoiced),
      cleared: sum((s) => s.cleared),
    },
  });
}

// How many of the latest decisions the widget lists, and the most it will read to count them.
export const RULES_HEALTH_RECENT = 20;
const RULES_HEALTH_MAX_ROWS = 5000;

const SpendInput = z.looseObject({
  amountMinor: z.number().int().nonnegative().optional(),
  currency: CurrencyCode.optional(),
  category: z.string().min(1).optional(),
});

function parseDecision(raw: string): RuleResult | undefined {
  try {
    const parsed = RuleResult.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// Rules health: how many spends the rules allowed, sent to the treasurer, or blocked, with the reasons.
// Source: the spend.check rows the payment executor writes to audit_log (rule_result is a JSON string).
// Rows that do not parse are skipped, never guessed.
// Not scoped to an event: a spend request carries no event id yet, so this is every decision. That is
// correct while there is one event, and needs Spend to carry an event id (P1/P2) before there are two.
// Only the category filter applies: a spend has no sponsor.
export async function getRulesHealth(
  db: Db,
  filter: WidgetFilter = {},
  now: Date = new Date(),
): Promise<RulesHealthData> {
  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      actor: auditLog.actor,
      action: auditLog.action,
      input: auditLog.input,
      ruleResult: auditLog.ruleResult,
    })
    .from(auditLog)
    .where(and(eq(auditLog.action, 'spend.check'), isNotNull(auditLog.ruleResult)))
    .orderBy(desc(auditLog.createdAt))
    .limit(RULES_HEALTH_MAX_ROWS);

  const counts = { allow: 0, needsApproval: 0, block: 0 };
  const recent: RulesHealthEntry[] = [];
  for (const row of rows) {
    const result = row.ruleResult ? parseDecision(row.ruleResult) : undefined;
    if (!result) continue;
    const spend = SpendInput.safeParse(row.input ?? {});
    const input = spend.success ? spend.data : {};
    const category = input.category ?? null;
    if (filter.category && category !== filter.category) continue;

    if (result.decision === 'allow') counts.allow += 1;
    else if (result.decision === 'needs_approval') counts.needsApproval += 1;
    else counts.block += 1;

    if (recent.length < RULES_HEALTH_RECENT) {
      recent.push({
        auditId: row.id,
        at: row.createdAt.toISOString(),
        actor: row.actor,
        action: row.action,
        amount: input.amountMinor ?? null,
        currency: input.currency ?? null,
        sponsorId: null,
        category,
        result,
      });
    }
  }
  return RulesHealthData.parse({ asOf: now.toISOString(), counts, recent });
}
