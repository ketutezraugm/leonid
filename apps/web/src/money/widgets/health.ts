// Pure logic for the rules health widget: no Studio, no DOM, so it can be tested on its own.
import { formatDollars } from './thermometer';

export type Decision = 'allow' | 'needs_approval' | 'block';

// The column names to read from each result row: a Studio field's `key`, which is its field id ('rules.decision').
// Only the id, the decision and the reasons are required; the rest add detail when they are mapped.
export interface HealthKeys {
  id: string;
  decision: string;
  reasons: string;
  category: string | null;
  amount: string | null;
  date: string | null;
}

export interface HealthEntry {
  id: string;
  decision: Decision;
  reasons: string;
  category: string | null;
  // Dollars, as the command center's tables hold them. Null when the check had no amount.
  amount: number | null;
  // The day of the check, as YYYY-MM-DD.
  date: string | null;
}

export interface HealthCounts {
  allow: number;
  needsApproval: number;
  block: number;
}

const DECISIONS: readonly string[] = ['allow', 'needs_approval', 'block'];
const isDecision = (value: unknown): value is Decision =>
  typeof value === 'string' && DECISIONS.includes(value);

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
};

const money = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// The command center maps a plain-text day, which needs no conversion. If a date field is mapped instead,
// Studio hands back a Date at local midnight, so its day is read in local time: reading it in UTC shows the
// day before for anyone east of Greenwich.
const dayOf = (value: unknown): string | null => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const s = text(value);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

// One entry per row. A row whose decision is not one of the three the rules engine can return is not counted
// as anything: it is left out and reported in `skipped`, so the widget can say so instead of hiding it.
export function toEntries(
  rows: Record<string, unknown>[],
  keys: HealthKeys,
): { entries: HealthEntry[]; skipped: number } {
  const entries: HealthEntry[] = [];
  let skipped = 0;
  for (const row of rows) {
    const decision = row[keys.decision];
    if (!isDecision(decision)) {
      skipped += 1;
      continue;
    }
    entries.push({
      id: String(row[keys.id] ?? ''),
      decision,
      reasons: text(row[keys.reasons]) ?? '',
      category: keys.category ? text(row[keys.category]) : null,
      amount: keys.amount ? money(row[keys.amount]) : null,
      date: keys.date ? dayOf(row[keys.date]) : null,
    });
  }
  return { entries, skipped };
}

export function countsOf(entries: HealthEntry[]): HealthCounts {
  const counts: HealthCounts = { allow: 0, needsApproval: 0, block: 0 };
  for (const e of entries) {
    if (e.decision === 'allow') counts.allow += 1;
    else if (e.decision === 'needs_approval') counts.needsApproval += 1;
    else counts.block += 1;
  }
  return counts;
}

// The tone names a status token (--color-status-done, -risk, -blocked); the label is what is read out, so
// colour never carries the meaning alone.
export const decisionView: Record<Decision, { label: string; tone: 'done' | 'risk' | 'blocked' }> =
  {
    allow: { label: 'Allowed', tone: 'done' },
    needs_approval: { label: 'Sent to approval', tone: 'risk' },
    block: { label: 'Blocked', tone: 'blocked' },
  };

export const NO_REASON = 'No reason recorded';

// What a screen reader says for a check: the decision, the amount and category when known, then the reasons.
export function describeEntry(entry: HealthEntry): string {
  const head = [
    decisionView[entry.decision].label,
    entry.amount === null ? null : formatDollars(entry.amount),
    entry.category,
  ].filter((part): part is string => part !== null);
  return `${head.join(', ')}. ${entry.reasons || NO_REASON}`;
}
