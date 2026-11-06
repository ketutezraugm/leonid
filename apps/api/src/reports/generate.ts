import { SponsorReportView } from '@quartermaster/shared';
import { eq } from 'drizzle-orm';
import type { LanguageModel } from 'ai';
import type { Db } from '../db/client.js';
import { clearedIncome, clearedIncomeBySponsor } from '../db/ledger.js';
import { sponsors } from '../db/schema.js';
import { loadSponsorWithEvent } from '../invoices/draft.js';
import type { FoundTransaction } from '../paypal/search.js';
import { recentSpends } from '../payments/recent.js';
import { buildReport } from './build.js';
import { captureIdsByOrder } from './captures.js';
import { crossCheckLines, searchWindows } from './crosscheck.js';
import { writeNarrative } from './narrative.js';
import { errorLabel, publishReport } from './store.js';

// Looks up PayPal's transaction records for a window (paypal/search.ts). Optional: with none, the report has no PayPal check.
export type TransactionSearch = (window: { start: Date; end: Date }) => Promise<FoundTransaction[]>;

// Sponsors that have paid: the ones with something to report on.
export async function listReportSponsorIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: sponsors.id }).from(sponsors).where(eq(sponsors.status, 'paid'));
  return rows.map((r) => r.id);
}

// Builds one sponsor's report from the ledger and the executor's records, adds the summary, and publishes it at the sponsor's
// stable link. Undefined when there is no such sponsor. Moves no money.
// ponytail: reads up to 1000 spends of the event and filters in memory; paginate if one event ever has more.
export async function generateSponsorReport(
  db: Db,
  sponsorId: string,
  options: { model?: LanguageModel; now?: Date; search?: TransactionSearch } = {},
): Promise<{ view: SponsorReportView } | undefined> {
  const found = await loadSponsorWithEvent(db, sponsorId);
  if (!found) return undefined;
  const { sponsor, event } = found;
  const [clearedBySponsor, clearedTotal, recorded, captures] = await Promise.all([
    clearedIncomeBySponsor(db, event.id, event.currency),
    clearedIncome(db, event.id, event.currency),
    recentSpends(db, { eventId: event.id, limit: 1000 }),
    captureIdsByOrder(db),
  ]);
  // An approved spend is recorded under its order id; the report shows (and checks against PayPal) the capture id instead.
  const spends = recorded.map((s) => ({ ...s, paypalId: (s.paypalId && captures.get(s.paypalId)) ?? s.paypalId }));
  const now = options.now ?? new Date();
  const built = buildReport({
    sponsor: { id: sponsor.id, name: sponsor.name, tier: sponsor.tier, pledged: sponsor.pledged, status: sponsor.status },
    event: { name: event.name, date: event.date, currency: event.currency },
    clearedBySponsor,
    clearedTotal,
    spends,
    now,
  });
  // Check each purchase against PayPal's own records. Best effort: a failed search leaves the report as built, never an error.
  let figures = built;
  const windows = options.search ? searchWindows(built.spend.lines, now) : [];
  if (options.search && windows.length > 0) {
    try {
      const search = options.search;
      const found = (await Promise.all(windows.map((w) => search(w)))).flat();
      figures = {
        ...built,
        spend: { ...built.spend, lines: crossCheckLines(built.spend.lines, found, event.currency), paypalCheckedAt: now.toISOString() },
      };
    } catch (err) {
      console.error('sponsor report: PayPal transaction search unavailable:', errorLabel(err));
    }
  }
  const view = SponsorReportView.parse({ ...figures, narrative: await writeNarrative(figures, options.model) });
  await publishReport(db, sponsorId, view);
  return { view };
}
