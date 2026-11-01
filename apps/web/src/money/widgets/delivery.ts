// Pure logic for the delivery risk widget: no Studio, no DOM, so it can be tested on its own.

export type Risk = 'late' | 'at_risk' | 'on_track' | 'unknown';

// The column names to read from each result row: a Studio field's `key`, which is its field id
// ('deliveries.risk'). Only the id, the name and the risk are required; the rest add detail when mapped.
export interface DeliveryKeys {
  id: string;
  name: string;
  risk: string;
  category: string | null;
  expected: string | null;
  deadline: string | null;
  daysLate: string | null;
}

export interface DeliveryItem {
  id: string;
  name: string;
  risk: Risk;
  category: string | null;
  // YYYY-MM-DD. There is no expected day until tracking gives one.
  expected: string | null;
  deadline: string | null;
  // Days past the deadline; zero or negative means slack. Null when it cannot be told.
  daysLate: number | null;
}

export interface DeliveryCounts {
  late: number;
  atRisk: number;
  onTrack: number;
  unknown: number;
}

const RISKS: readonly string[] = ['late', 'at_risk', 'on_track', 'unknown'];
const isRisk = (value: unknown): value is Risk =>
  typeof value === 'string' && RISKS.includes(value);

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
};

// Days arrive as plain text from the command center, so there is nothing to convert and no time zone to
// get wrong.
const dayOf = (value: unknown): string | null => {
  const s = text(value);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const whole = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
};

// Both days are read as UTC dates, so the difference is a whole number of days wherever it runs.
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// Late items first, then those at risk, then those with no date yet, then those on track. Within a group the
// one with the least time to spare (or the most days late) comes first.
const URGENCY: Record<Risk, number> = { late: 0, at_risk: 1, unknown: 2, on_track: 3 };

// One item per row. A row whose risk is not one of the four the API can return is left out and reported in
// `skipped`, so the widget can say so instead of hiding it.
export function toItems(
  rows: Record<string, unknown>[],
  keys: DeliveryKeys,
): { items: DeliveryItem[]; skipped: number } {
  const items: DeliveryItem[] = [];
  let skipped = 0;
  for (const row of rows) {
    const risk = row[keys.risk];
    if (!isRisk(risk)) {
      skipped += 1;
      continue;
    }
    const expected = keys.expected ? dayOf(row[keys.expected]) : null;
    const deadline = keys.deadline ? dayOf(row[keys.deadline]) : null;
    const given = keys.daysLate ? whole(row[keys.daysLate]) : null;
    items.push({
      id: String(row[keys.id] ?? ''),
      name: text(row[keys.name]) ?? '',
      risk,
      category: keys.category ? text(row[keys.category]) : null,
      expected,
      deadline,
      daysLate: given ?? (expected && deadline ? daysBetween(deadline, expected) : null),
    });
  }
  items.sort(
    (a, b) =>
      URGENCY[a.risk] - URGENCY[b.risk] ||
      (b.daysLate ?? Number.NEGATIVE_INFINITY) - (a.daysLate ?? Number.NEGATIVE_INFINITY) ||
      a.name.localeCompare(b.name),
  );
  return { items, skipped };
}

export function countsOf(items: DeliveryItem[]): DeliveryCounts {
  const counts: DeliveryCounts = { late: 0, atRisk: 0, onTrack: 0, unknown: 0 };
  for (const item of items) {
    if (item.risk === 'late') counts.late += 1;
    else if (item.risk === 'at_risk') counts.atRisk += 1;
    else if (item.risk === 'on_track') counts.onTrack += 1;
    else counts.unknown += 1;
  }
  return counts;
}

// The tone names a status token (--color-status-blocked, -risk, -done, -pending); the label is what is read
// out, so colour never carries the meaning alone.
export const riskView: Record<
  Risk,
  { label: string; tone: 'blocked' | 'risk' | 'done' | 'pending' }
> = {
  late: { label: 'Late', tone: 'blocked' },
  at_risk: { label: 'At risk', tone: 'risk' },
  on_track: { label: 'On track', tone: 'done' },
  unknown: { label: 'No date yet', tone: 'pending' },
};

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

// How an item stands against its deadline, in words. The API reports 0 days for an item with no date, so the
// risk decides first: an item with no date must never read as arriving on the deadline.
export function timing(item: DeliveryItem): string | null {
  if (item.risk === 'unknown') return 'No delivery date yet';
  if (item.daysLate === null) return null;
  if (item.daysLate > 0) return `${days(item.daysLate)} late`;
  if (item.daysLate === 0) return 'Arrives on the deadline';
  return `${days(-item.daysLate)} to spare`;
}

export function datesLine(item: DeliveryItem): string | null {
  if (item.expected && item.deadline)
    return `Expected ${item.expected}, needed by ${item.deadline}`;
  if (item.deadline) return `Needed by ${item.deadline}`;
  if (item.expected) return `Expected ${item.expected}`;
  return null;
}

// What a screen reader says for an item: the name and risk, how it stands, the days, then the category.
export function describeItem(item: DeliveryItem): string {
  return [
    `${item.name}: ${riskView[item.risk].label}`,
    timing(item),
    datesLine(item),
    item.category ? `Category ${item.category}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join('. ');
}
