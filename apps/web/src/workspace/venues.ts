import { venueEstimate, type VenueAddOn, type VenueCandidate } from '@leonid/shared';

export type VenueSort = 'best' | 'cheapest' | 'roomiest';

export interface VenueFilters {
  fitsHeadcount: boolean;
  priceListed: boolean;
  cateringIncluded: boolean;
  booking: ReadonlySet<VenueCandidate['booking']>;
}

export const noFilters: VenueFilters = {
  fitsHeadcount: false,
  priceListed: false,
  cateringIncluded: false,
  booking: new Set(),
};

export const perLabel: Record<NonNullable<VenueCandidate['price']>['per'], string> = {
  pax: 'per person',
  package: 'package',
  hour: 'per hour',
  day: 'per day',
};

export const addOnUnitLabel: Record<VenueAddOn['unit'], string> = {
  person: 'per person',
  hour: 'per hour',
  event: 'per event',
};

export { VENUE_DAY_HOURS, venueEstimate, type VenueEstimate } from '@leonid/shared';

// The short facts on a card: how the venue charges and any minimum.
export function chargeFacts({ price, terms }: VenueCandidate): string[] {
  if (!price || !terms) return [];
  return [
    price.per === 'pax' ? 'Per-person package' : 'Whole venue hire',
    ...(terms.minPax !== null ? [`Minimum ${terms.minPax} people`] : []),
    ...(terms.minHours !== null ? [`Minimum ${terms.minHours} hours`] : []),
  ];
}

export function fits(venue: VenueCandidate, headcount: number | null): boolean | null {
  if (!venue.capacity || headcount === null) return null;
  return venue.capacity.value >= headcount;
}

// A comparable number for sorting: the one-day estimate when there is one. Otherwise a per-person
// price is scaled by headcount so it sits next to package and day prices, and hourly prices stay
// as listed.
function sortPrice(venue: VenueCandidate, headcount: number | null): number | null {
  const estimate = venueEstimate(venue, headcount);
  if (estimate) return estimate.total;
  if (!venue.price) return null;
  return venue.price.per === 'pax'
    ? venue.price.amountMinor * (headcount ?? 1)
    : venue.price.amountMinor;
}

// Best fit: venues known to hold everyone first, then ones with a listed price, then the least
// spare room. Unknowns sink, they are not dropped.
function bestScore(venue: VenueCandidate, headcount: number | null): number {
  const fit = fits(venue, headcount);
  return (fit === true ? 0 : fit === null ? 2 : 4) + (venue.price ? 0 : 1);
}

export function sortVenues(
  venues: readonly VenueCandidate[],
  sort: VenueSort,
  headcount: number | null,
): VenueCandidate[] {
  const unknownLast = (a: number | null, b: number | null, dir: 1 | -1) =>
    a === null ? (b === null ? 0 : 1) : b === null ? -1 : (a - b) * dir;
  return venues
    .map((venue, index) => ({ venue, index }))
    .sort((a, b) => {
      let order: number;
      if (sort === 'cheapest') {
        order = unknownLast(sortPrice(a.venue, headcount), sortPrice(b.venue, headcount), 1);
      } else if (sort === 'roomiest') {
        order = unknownLast(a.venue.capacity?.value ?? null, b.venue.capacity?.value ?? null, -1);
      } else {
        order =
          bestScore(a.venue, headcount) - bestScore(b.venue, headcount) ||
          unknownLast(a.venue.capacity?.value ?? null, b.venue.capacity?.value ?? null, 1);
      }
      // Stable: equal venues keep the scout's order.
      return order || a.index - b.index;
    })
    .map(({ venue }) => venue);
}

export function filterVenues(
  venues: readonly VenueCandidate[],
  filters: VenueFilters,
  headcount: number | null,
): VenueCandidate[] {
  return venues.filter(
    (venue) =>
      (!filters.fitsHeadcount || fits(venue, headcount) === true) &&
      (!filters.priceListed || venue.price !== null) &&
      (!filters.cateringIncluded || venue.cateringIncluded === 'yes') &&
      (filters.booking.size === 0 || filters.booking.has(venue.booking)),
  );
}

// Source links come from the server, which only keeps pages the scout read, but a link is still
// third-party data: only http(s) is ever rendered as an href.
export function safeLinks(urls: readonly string[]): { href: string; host: string }[] {
  return urls.flatMap((url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return [];
      return [{ href: parsed.href, host: parsed.hostname.replace(/^www\./, '') }];
    } catch {
      return [];
    }
  });
}
