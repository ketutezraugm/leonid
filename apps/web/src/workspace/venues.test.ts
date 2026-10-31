import { describe, expect, it } from 'vitest';
import type { VenueCandidate } from '@quartermaster/shared';
import {
  chargeFacts,
  filterVenues,
  noFilters,
  safeLinks,
  sortVenues,
  venueEstimate,
} from './venues';

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

describe('venueEstimate', () => {
  const terms = (over: Partial<NonNullable<VenueCandidate['terms']>> = {}) => ({
    minPax: null,
    minHours: null,
    includes: [],
    addOns: [],
    taxPercent: 0,
    ...over,
  });
  const chair = { name: 'Chair', amountMinor: 20_000, unit: 'person', required: true } as const;
  const stage = { name: 'Stage', amountMinor: 900_000, unit: 'event', required: false } as const;
  const cleaning = { name: 'Clean', amountMinor: 500_000, unit: 'event', required: true } as const;

  it('needs a price, terms and a headcount', () => {
    expect(venueEstimate(venue('a', { terms: terms() }), 100)).toBeNull();
    expect(venueEstimate(venue('a', { price: price(1_000) }), 100)).toBeNull();
    expect(venueEstimate(venue('a', { price: price(1_000), terms: terms() }), null)).toBeNull();
  });

  it('bills a per-person package at its minimum headcount, plus tax', () => {
    const package_ = venue('a', {
      price: price(100_000, 'pax'),
      terms: terms({ minPax: 50, taxPercent: 21 }),
    });
    expect(venueEstimate(package_, 80)?.total).toBe(9_680_000);
    expect(venueEstimate(package_, 20)).toEqual({
      lines: [
        { label: '50 people', amountMinor: 5_000_000 },
        { label: 'Tax and service 21%', amountMinor: 1_050_000 },
      ],
      total: 6_050_000,
    });
  });

  it('adds required add-ons to whole-venue hire and leaves optional ones out', () => {
    const hall = venue('a', {
      price: { ...price(30_000_000), per: 'day' },
      terms: terms({ addOns: [chair, cleaning, stage] }),
    });
    expect(venueEstimate(hall, 200)).toEqual({
      lines: [
        { label: '1 day', amountMinor: 30_000_000 },
        { label: 'Chair x 200', amountMinor: 4_000_000 },
        { label: 'Clean', amountMinor: 500_000 },
      ],
      total: 34_500_000,
    });
  });

  it('bills hourly hire for a full day', () => {
    const floor = venue('a', {
      price: { ...price(1_000_000), per: 'hour' },
      terms: terms({ minHours: 4 }),
    });
    expect(venueEstimate(floor, 100)?.total).toBe(8_000_000);
  });

  it('ranks by the estimate, so a cheap hall with costly chairs is not the lowest price', () => {
    const hall = venue('hall', {
      price: { ...price(1_000_000), per: 'day' },
      terms: terms({ addOns: [chair] }),
    });
    const room = venue('room', { price: price(3_000_000), terms: terms() });
    expect(sortVenues([hall, room], 'cheapest', 200).map((v) => v.name)).toEqual(['room', 'hall']);
  });

  it('says how the venue charges', () => {
    const perPerson = { price: price(1, 'pax'), terms: terms({ minPax: 50 }) };
    expect(chargeFacts(venue('a', perPerson))).toEqual(['Per-person package', 'Minimum 50 people']);
    expect(chargeFacts(venue('a', { price: price(1), terms: terms() }))).toEqual([
      'Whole venue hire',
    ]);
    expect(chargeFacts(venue('a', { price: price(1) }))).toEqual([]);
  });
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
