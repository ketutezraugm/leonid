import type { SponsorSummary } from '@quartermaster/shared';
import { describe, expect, it } from 'vitest';
import { demoSponsors } from './demoPlan';
import { planSponsors } from './sponsorSource';

const real = (name: string, status: SponsorSummary['status']): SponsorSummary => ({
  id: crypto.randomUUID(),
  eventId: 'e1',
  name,
  tier: 'gold',
  pledged: 300_000,
  currency: 'USD',
  paypalInvoiceId: null,
  status,
});

describe('planSponsors', () => {
  it('uses the sample statuses when there is no live data', () => {
    expect(planSponsors(demoSponsors, null)).toEqual({ sponsors: demoSponsors, live: false });
    expect(planSponsors(demoSponsors, [])).toEqual({ sponsors: demoSponsors, live: false });
  });

  it("takes each matching sponsor's real status, by name", () => {
    const { sponsors, live } = planSponsors(demoSponsors, [
      real('Harbor Cloud', 'paid'),
      real('lumen labs', 'invoiced'),
      real('Pixel Foundry', 'pledged'),
    ]);
    expect(live).toBe(true);
    expect(sponsors.map((s) => s.status)).toEqual(['paid', 'invoiced', 'pledged']);
    expect(sponsors.map((s) => s.id)).toEqual(demoSponsors.map((s) => s.id));
  });

  it('stays sample when none of the sponsors match (another event)', () => {
    expect(planSponsors(demoSponsors, [real('Spring Co', 'paid')])).toEqual({
      sponsors: demoSponsors,
      live: false,
    });
  });
});
