import type { VenueTerms } from './index.js';

// How long an estimate assumes the venue is hired for.
export const VENUE_DAY_HOURS = 8;

export interface VenueEstimate {
  lines: { label: string; amountMinor: number }[];
  total: number;
}

// Just what the estimate reads, so a scout result (price may be null, terms may be absent) and a seeded
// listing (both always set) can share it.
export interface EstimateInput {
  price: { amountMinor: number; per: 'pax' | 'package' | 'hour' | 'day' } | null;
  terms?: VenueTerms | undefined;
}

// What one day costs for this headcount: the price at its minimums, the required add-ons, then tax
// and service. Null for a venue with no terms, as nothing says what its price covers.
export function venueEstimate(
  venue: EstimateInput,
  headcount: number | null,
): VenueEstimate | null {
  const { price, terms } = venue;
  if (!price || !terms || headcount === null) return null;
  const hours = Math.max(VENUE_DAY_HOURS, terms.minHours ?? 0);
  const billed = Math.max(headcount, terms.minPax ?? 0);
  const base = {
    pax: { label: `${billed} people`, quantity: billed },
    hour: { label: `${hours} hours`, quantity: hours },
    day: { label: '1 day', quantity: 1 },
    package: { label: 'Package', quantity: 1 },
  }[price.per];
  const quantities = { person: headcount, hour: hours, event: 1 };
  const lines = [
    { label: base.label, amountMinor: price.amountMinor * base.quantity },
    ...terms.addOns
      .filter((addOn) => addOn.required)
      .map(({ name, amountMinor, unit }) => ({
        label: unit === 'event' ? name : `${name} x ${quantities[unit]}`,
        amountMinor: amountMinor * quantities[unit],
      })),
  ];
  const subtotal = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const tax = Math.round((subtotal * terms.taxPercent) / 100);
  if (tax > 0) lines.push({ label: `Tax and service ${terms.taxPercent}%`, amountMinor: tax });
  return { lines, total: subtotal + tax };
}
