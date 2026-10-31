// Pure logic for the budget burn widget: no Studio, no DOM, so it can be tested on its own.
import { formatDollars } from './thermometer';

// The column names to read from each result row: a Studio field's `key`, which is its field id plus the
// aggregation ('categories.category', 'categories.spent.sum'). The cap is optional: with no cap column the
// widget still shows what each category has used.
export interface BurnKeys {
  category: string;
  cap: string | null;
  spent: string;
  committed: string;
}

export interface BurnBar {
  category: string;
  // Null when the category has no cap.
  cap: number | null;
  spent: number;
  // Approved but not yet captured by PayPal.
  committed: number;
  // Spent plus committed.
  used: number;
  over: boolean;
  // Money left under the cap, negative once it is exceeded. Null when there is no cap.
  left: number | null;
  // Shares of this category's track, between 0 and 1, adding up to at most 1.
  spentShare: number;
  committedShare: number;
  // Where the cap falls on the track. Null when there is no cap; below 1 only when the cap is exceeded.
  capShare: number | null;
  // How long the track is next to the longest category's, between 0 and 1.
  trackShare: number;
}

const amount = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Studio hands the widget a summed cap, so a category with no cap cannot be told from one capped at $0.
// Both read as "no cap": a false "over the cap" alarm on an uncapped category is worse than a missed
// one on a category deliberately capped at nothing.
const capOf = (value: unknown): number | null => {
  const n = amount(value);
  return n > 0 ? n : null;
};

// Dollars arrive as floats, so 0.1 + 0.2 is more than 0.3. Whole cents are compared instead.
const cents = (dollars: number): number => Math.round(dollars * 100);

// One bar per category row. A track is as long as the larger of the cap and what was used, so a
// category that overspent still fits. Inside it, from the left:
//   spent        captured by PayPal
//   committed    approved, not yet captured
// The rest of a capped track up to the cap is money still free to use.
export function toBars(rows: Record<string, unknown>[], keys: BurnKeys): BurnBar[] {
  const sized = rows.map((row) => {
    const cap = keys.cap ? capOf(row[keys.cap]) : null;
    const spent = amount(row[keys.spent]);
    const committed = amount(row[keys.committed]);
    const used = (cents(spent) + cents(committed)) / 100;
    return {
      category: String(row[keys.category] ?? ''),
      cap,
      spent,
      committed,
      used,
      total: Math.max(cap ?? 0, used),
    };
  });
  const largest = Math.max(0, ...sized.map((s) => s.total));
  return sized.map(({ total, ...s }) => ({
    ...s,
    over: s.cap !== null && cents(s.used) > cents(s.cap),
    left: s.cap === null ? null : (cents(s.cap) - cents(s.used)) / 100,
    spentShare: total ? s.spent / total : 0,
    committedShare: total ? s.committed / total : 0,
    capShare: s.cap !== null && total ? s.cap / total : null,
    trackShare: largest ? total / largest : 0,
  }));
}

export interface BurnTotals {
  spent: number;
  committed: number;
  used: number;
  // The caps added up, or null if any category has none: used money against only some of the caps would mislead.
  capTotal: number | null;
  overCount: number;
}

export function totalsOf(bars: BurnBar[]): BurnTotals {
  const spent = bars.reduce((n, b) => n + b.spent, 0);
  const committed = bars.reduce((n, b) => n + b.committed, 0);
  const allCapped = bars.length > 0 && bars.every((b) => b.cap !== null);
  return {
    spent,
    committed,
    used: (cents(spent) + cents(committed)) / 100,
    capTotal: allCapped ? bars.reduce((n, b) => n + (b.cap ?? 0), 0) : null,
    overCount: bars.filter((b) => b.over).length,
  };
}

export type CapTone = 'over' | 'ok' | 'none';

// The one-line verdict under a bar. Words, not just colour, say whether a category is over its cap.
export function capNote(bar: BurnBar): { text: string; tone: CapTone } {
  if (bar.left === null) return { text: 'No cap set', tone: 'none' };
  if (bar.over) return { text: `Over the cap by ${formatDollars(-bar.left)}`, tone: 'over' };
  return { text: `${formatDollars(bar.left)} left`, tone: 'ok' };
}

// What a screen reader says for a bar: the figures in words, since colour and hatching carry no text.
export function describeBar(bar: BurnBar): string {
  const cap = bar.cap === null ? 'no cap' : `cap ${formatDollars(bar.cap)}`;
  return `${bar.category}: spent ${formatDollars(bar.spent)}, committed ${formatDollars(bar.committed)}, ${cap}. ${capNote(bar).text}`;
}
