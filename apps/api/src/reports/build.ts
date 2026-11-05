import type { SpendEntry, SponsorReportLine, SponsorReportView } from '@quartermaster/shared';

// The per-sponsor spend report (F22), the numbers only. Pure: no I/O, no clock reads (pass `now`), no model. The narrative is
// written elsewhere (narrative.ts) from these figures and can never change them.
//
// Attribution, stated plainly on the report page:
//  - A spend tagged with one sponsor (tasks.funded_by_sponsor_id) is attributed to that sponsor in full, and to nobody else.
//  - Every other spend is paid from the event's pooled cleared income. Each source pays its proportional share: each sponsor
//    by what cleared from it, and "everyone else" (tickets, donations) by the rest. A sponsor is therefore never attributed
//    more than it paid in, because the funds gate keeps total spend within total cleared income.
// Cents are split with the largest-remainder method, ties broken by sponsor id, so the same data always gives the same report.

export interface ReportSponsor {
  id: string;
  name: string;
  tier: string;
  pledged: number;
  status: 'pledged' | 'invoiced' | 'paid';
}

export interface ReportInput {
  sponsor: ReportSponsor;
  event: { name: string; date: Date; currency: string };
  // Cleared income per sponsor id (ledger, net of refunds), for every sponsor of the event. Missing means nothing cleared.
  clearedBySponsor: ReadonlyMap<string, number>;
  // Cleared income from every source, tickets and donations included.
  clearedTotal: number;
  spends: readonly SpendEntry[];
  now: Date;
}

// Splits `total` across `weights` in whole units. The shares always add up to `total` (or all zero when there is no weight).
export function allocate(total: number, weights: readonly number[]): number[] {
  const w = weights.map((x) => Math.max(0, x));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum === 0 || total <= 0) return w.map(() => 0);
  const shares = w.map((x) => Math.floor((total * x) / sum));
  let left = total - shares.reduce((a, b) => a + b, 0);
  const byRemainder = w.map((x, i) => ({ i, rem: (total * x) % sum })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left === 0) break;
    shares[i] = (shares[i] ?? 0) + 1;
    left -= 1;
  }
  return shares;
}

const isPurchase = (s: SpendEntry) => !s.kind || s.kind === 'purchase';

export function buildReport(input: ReportInput): Omit<SponsorReportView, 'narrative'> {
  const { sponsor, event, clearedBySponsor, clearedTotal, now } = input;
  // Payouts count once PayPal has accepted them ('submitted'); a purchase counts when it is paid.
  const counted = input.spends
    .filter((s) => (s.status === 'paid' || s.status === 'submitted') && s.amountMinor !== null && s.currency === event.currency)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

  // Weights for the pooled spends: every sponsor in id order, then everyone else last.
  const ids = [...new Set([sponsor.id, ...clearedBySponsor.keys()])].sort();
  const sponsorMoney = ids.map((id) => clearedBySponsor.get(id) ?? 0);
  const otherMoney = Math.max(0, clearedTotal - sponsorMoney.reduce((a, b) => a + b, 0));
  const weights = [...sponsorMoney, otherMoney];
  const mine = ids.indexOf(sponsor.id);

  const lines: SponsorReportLine[] = [];
  const categories = new Map<string, { attributedMinor: number; purchases: number }>();
  let directMinor = 0;
  let sharedMinor = 0;

  for (const s of counted) {
    const amount = s.amountMinor ?? 0;
    let attributed: number;
    let basis: 'direct' | 'shared';
    if (s.fundedBySponsorId) {
      if (s.fundedBySponsorId !== sponsor.id) continue; // another sponsor's money paid for it alone
      attributed = amount;
      basis = 'direct';
      directMinor += amount;
    } else {
      attributed = allocate(amount, weights)[mine] ?? 0;
      basis = 'shared';
      sharedMinor += attributed;
    }
    if (attributed === 0) continue;
    const category = s.category ?? (isPurchase(s) ? 'Other' : (s.kind ?? 'Other'));
    const entry = categories.get(category) ?? { attributedMinor: 0, purchases: 0 };
    categories.set(category, { attributedMinor: entry.attributedMinor + attributed, purchases: entry.purchases + 1 });
    // Only purchases get a line with a vendor. Payouts and claims stay inside the category totals, so no person is named.
    if (isPurchase(s)) {
      lines.push({ at: s.at, category: s.category, vendor: s.vendor, purchaseMinor: amount, attributedMinor: attributed, basis, paypalId: s.paypalId });
    }
  }

  return {
    sponsor: { name: sponsor.name, tier: sponsor.tier },
    event: { name: event.name, date: event.date.toISOString() },
    currency: event.currency,
    funds: { pledgedMinor: sponsor.pledged, clearedMinor: clearedBySponsor.get(sponsor.id) ?? 0, status: sponsor.status },
    spend: {
      totalMinor: directMinor + sharedMinor,
      directMinor,
      sharedMinor,
      byCategory: [...categories.entries()]
        .map(([category, v]) => ({ category, ...v }))
        .sort((a, b) => b.attributedMinor - a.attributedMinor || a.category.localeCompare(b.category)),
      lines,
    },
    generatedAt: now.toISOString(),
  };
}
