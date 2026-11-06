import type { SponsorSummary } from '@quartermaster/shared';
import type { PlanSponsor } from './gating';

// Which sponsor statuses the plan shows. The tasks are still the sample plan (until P1's plan endpoint), and its
// sponsors carry the seed's names, so the event's real sponsors (GET /api/sponsors) are matched to them by name.
// A match makes the gating real: when PayPal reports an invoice paid, its purchases unblock. Sponsors with no
// match keep their sample status, and with no match at all the whole plan is sample (the preview buttons).
export function planSponsors(
  sample: PlanSponsor[],
  live: SponsorSummary[] | null,
): { sponsors: PlanSponsor[]; live: boolean } {
  if (!live || live.length === 0) return { sponsors: sample, live: false };
  const byName = new Map(live.map((s) => [s.name.trim().toLowerCase(), s]));
  let matched = 0;
  const sponsors = sample.map((s) => {
    const real = byName.get(s.name.toLowerCase());
    if (!real) return s;
    matched += 1;
    return { ...s, status: real.status };
  });
  return matched > 0 ? { sponsors, live: true } : { sponsors: sample, live: false };
}
