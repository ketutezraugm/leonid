import { SponsorReportView } from '@quartermaster/shared';
import { eq } from 'drizzle-orm';
import type { LanguageModel } from 'ai';
import type { Db } from '../db/client.js';
import { clearedIncome, clearedIncomeBySponsor } from '../db/ledger.js';
import { sponsors } from '../db/schema.js';
import { loadSponsorWithEvent } from '../invoices/draft.js';
import { recentSpends } from '../payments/recent.js';
import { buildReport } from './build.js';
import { writeNarrative } from './narrative.js';
import { publishReport } from './store.js';

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
  options: { model?: LanguageModel; now?: Date } = {},
): Promise<{ view: SponsorReportView } | undefined> {
  const found = await loadSponsorWithEvent(db, sponsorId);
  if (!found) return undefined;
  const { sponsor, event } = found;
  const [clearedBySponsor, clearedTotal, spends] = await Promise.all([
    clearedIncomeBySponsor(db, event.id, event.currency),
    clearedIncome(db, event.id, event.currency),
    recentSpends(db, { eventId: event.id, limit: 1000 }),
  ]);
  const figures = buildReport({
    sponsor: { id: sponsor.id, name: sponsor.name, tier: sponsor.tier, pledged: sponsor.pledged, status: sponsor.status },
    event: { name: event.name, date: event.date, currency: event.currency },
    clearedBySponsor,
    clearedTotal,
    spends,
    now: options.now ?? new Date(),
  });
  const view = SponsorReportView.parse({ ...figures, narrative: await writeNarrative(figures, options.model) });
  await publishReport(db, sponsorId, view);
  return { view };
}
