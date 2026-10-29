import { describe, expect, it } from 'vitest';
import type { VenueCandidate } from '@quartermaster/shared';
import { filterVenues, noFilters, safeLinks, sortVenues } from './venues';

const venue = (name: string, over: Partial<VenueCandidate> = {}): VenueCandidate => ({
  name,
  sourceUrls: [`https://example.com/${name}`],
  capacity: null,
  price: null,
  cateringIncluded: 'unknown',
  booking: 'unknown',
  ...over,
});

const cap = (value: number) => ({ value, quote: `up to ${value} people` });
const price = (amountMinor: number, per: 'pax' | 'package' = 'package') => ({
  amountMinor,
  currency: 'IDR',
  per,
  quote: `Rp ${amountMinor}`,
});

describe('sortVenues', () => {
  const small = venue('small', { capacity: cap(20), price: price(500_000) });
  const fitting = venue('fitting', { capacity: cap(40), price: price(3_000_000) });
  const unknown = venue('unknown');
  const perPax = venue('perPax', { capacity: cap(100), price: price(50_000, 'pax') });

  it('puts venues known to fit first for best fit, unknowns before ones too small', () => {
    expect(sortVenues([small, unknown, fitting], 'best', 30).map((v) => v.name)).toEqual([
      'fitting',
      'unknown',
      'small',
    ]);
  });

  it('scales per-person prices by headcount for the lowest price and sinks missing prices', () => {
    // 50,000 x 30 = 1,500,000, between the two package prices.
    expect(
      sortVenues([unknown, fitting, perPax, small], 'cheapest', 30).map((v) => v.name),
    ).toEqual(['small', 'perPax', 'fitting', 'unknown']);
  });

  it('sorts by capacity for most room', () => {
    expect(sortVenues([small, unknown, perPax], 'roomiest', 30).map((v) => v.name)).toEqual([
      'perPax',
      'small',
      'unknown',
    ]);
  });
});

describe('filterVenues', () => {
  const venues = [
    venue('a', { capacity: cap(50), cateringIncluded: 'yes', booking: 'whatsapp' }),
    venue('b', { capacity: cap(10), price: price(1), booking: 'website' }),
    venue('c'),
  ];

  it('keeps only what every active filter allows', () => {
    const names = (f: Parameters<typeof filterVenues>[1]) =>
      filterVenues(venues, f, 30).map((v) => v.name);
    expect(names(noFilters)).toEqual(['a', 'b', 'c']);
    expect(names({ ...noFilters, fitsHeadcount: true })).toEqual(['a']);
    expect(names({ ...noFilters, priceListed: true })).toEqual(['b']);
    expect(names({ ...noFilters, cateringIncluded: true })).toEqual(['a']);
    expect(names({ ...noFilters, booking: new Set(['website'] as const) })).toEqual(['b']);
  });
});

describe('safeLinks', () => {
  it('renders only http(s) links', () => {
    expect(safeLinks(['https://www.venue.id/a', 'javascript:alert(1)', 'not a url'])).toEqual([
      { href: 'https://www.venue.id/a', host: 'venue.id' },
    ]);
  });
});
