// Pure logic for the funding thermometer: no Studio, no DOM, so it can be tested on its own.

// The column names to read from each result row: a Studio field's `key`, which is its field id plus the
// aggregation ('sponsors.name', 'sponsors.pledged.sum'). Checked against a real run of the command center.
export interface ThermometerKeys {
  sponsor: string;
  pledged: string;
  invoiced: string;
  cleared: string;
}

export interface SponsorBar {
  name: string;
  pledged: number;
  invoiced: number;
  cleared: number;
  // Shares of the whole track, between 0 and 1, adding up to at most 1.
  clearedShare: number;
  outstandingShare: number;
  uninvoicedShare: number;
  // How long the track is next to the largest sponsor's, between 0 and 1.
  trackShare: number;
}

const amount = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// One bar per sponsor row. A track is as long as the sponsor's largest figure, so a sponsor who somehow
// paid more than they pledged still fits. Inside it, from the left:
//   cleared             money PayPal has confirmed (spendable)
//   outstanding         invoiced but not yet paid (not spendable)
//   uninvoiced          pledged but not yet invoiced (not spendable)
export function toBars(rows: Record<string, unknown>[], keys: ThermometerKeys): SponsorBar[] {
  const sized = rows.map((row) => {
    const pledged = amount(row[keys.pledged]);
    const invoiced = amount(row[keys.invoiced]);
    const cleared = amount(row[keys.cleared]);
    return {
      name: String(row[keys.sponsor] ?? ''),
      pledged,
      invoiced,
      cleared,
      total: Math.max(pledged, invoiced, cleared),
    };
  });
  const largest = Math.max(0, ...sized.map((s) => s.total));
  return sized.map(({ total, ...s }) => ({
    ...s,
    clearedShare: total ? s.cleared / total : 0,
    outstandingShare: total ? Math.max(0, s.invoiced - s.cleared) / total : 0,
    uninvoicedShare: total ? Math.max(0, s.pledged - Math.max(s.invoiced, s.cleared)) / total : 0,
    trackShare: largest ? total / largest : 0,
  }));
}

// The command center's tables hold dollars (the one place cents are converted is ../studio-data.ts).
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const formatDollars = (value: number): string => dollars.format(value);

export interface ThermometerTotals {
  pledged: number;
  invoiced: number;
  cleared: number;
}

export function totalsOf(bars: SponsorBar[]): ThermometerTotals {
  return bars.reduce(
    (t, b) => ({
      pledged: t.pledged + b.pledged,
      invoiced: t.invoiced + b.invoiced,
      cleared: t.cleared + b.cleared,
    }),
    { pledged: 0, invoiced: 0, cleared: 0 },
  );
}

// What a screen reader says for a bar: the three figures in words, since colour and hatching carry no text.
export function describeBar(bar: SponsorBar): string {
  return `${bar.name}: pledged ${formatDollars(bar.pledged)}, invoiced ${formatDollars(bar.invoiced)}, cleared ${formatDollars(bar.cleared)}`;
}
