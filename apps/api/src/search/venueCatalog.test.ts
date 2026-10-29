import { describe, expect, it } from 'vitest';
import type { VenueCandidate } from '@quartermaster/shared';
import { generateVenues } from '../../scripts/generate-venues.js';
import { verifyCandidate } from '../agents/venueScout.js';
import {
  createCatalogSearchClient,
  findListing,
  listingUrl,
  loadVenueCatalog,
  priceText,
  renderListingPage,
  searchCatalog,
} from './venueCatalog.js';

const catalog = loadVenueCatalog();

describe('venue catalog', () => {
  it('matches what the seeded generator writes', () => {
    // Fails when someone edits data/venues.json by hand or changes the generator without rerunning it.
    expect(catalog).toEqual(generateVenues(20261029));
  });

  it('covers Indonesia, Malaysia and Singapore with unique ids', () => {
    expect(new Set(catalog.map((l) => l.country))).toEqual(new Set(['id', 'my', 'sg']));
    expect(new Set(catalog.map((l) => l.id)).size).toBe(catalog.length);
  });

  it('formats prices so their digits are the minor-unit amount', () => {
    expect(priceText({ amountMinor: 175_000, currency: 'IDR', per: 'pax' }, 'id')).toBe(
      'Rp 175.000 per pax',
    );
    expect(priceText({ amountMinor: 8_500, currency: 'MYR', per: 'pax' }, 'en')).toBe(
      'RM 85.00 per pax',
    );
    expect(priceText({ amountMinor: 120_000, currency: 'SGD', per: 'hour' }, 'en')).toBe(
      'S$ 1,200.00 per hour',
    );
  });
});

describe('venue deposits', () => {
  it('lists a USD deposit on every page, some within the $200 auto-pay rule and some over it', () => {
    for (const listing of catalog) {
      expect(listing.deposit.currency).toBe('USD');
      expect(renderListingPage(listing)).toContain(
        `US$ ${(listing.deposit.amountMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      );
    }
    expect(catalog.some((l) => l.deposit.amountMinor <= 20_000)).toBe(true);
    expect(catalog.some((l) => l.deposit.amountMinor > 20_000)).toBe(true);
  });

  it('finds a listing only by its own catalog URL', () => {
    const [first] = catalog;
    expect(findListing(listingUrl(first!))).toEqual(first);
    expect(findListing('https://hotel.test/meeting')).toBeNull();
  });
});

describe('searchCatalog', () => {
  it('finds venues by city in English or the local language', () => {
    for (const query of ['event venue West Jakarta', 'paket meeting jakarta barat 200 orang']) {
      const results = searchCatalog(catalog, query);
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((l) => l.city === 'Jakarta')).toBe(true);
    }
    expect(
      searchCatalog(catalog, 'hackathon venue KL').every((l) => l.city === 'Kuala Lumpur'),
    ).toBe(true);
  });

  it('ranks venues that fit the headcount first', () => {
    const [top] = searchCatalog(catalog, 'venue singapore 200 people');
    expect(top?.capacity).toBeGreaterThanOrEqual(200);
  });

  it('prefers the area the query names', () => {
    expect(searchCatalog(catalog, 'venue west jakarta')[0]?.area).toBe('West Jakarta');
    expect(searchCatalog(catalog, 'paket meeting jakarta barat')[0]?.area).toBe('West Jakarta');
  });

  it('returns nothing for a place it has no venues for', () => {
    expect(searchCatalog(catalog, 'venue in Reykjavik for 200 people')).toEqual([]);
  });
});

describe('catalog search client', () => {
  const client = createCatalogSearchClient();

  it('serves each search result as a readable page', async () => {
    const [first] = await client.search('venue bandung');
    expect(first?.url).toMatch(/^https:\/\/venues\.example\/id\/bandung\//);
    expect(await client.extract(first!.url)).toContain('Bandung');
  });

  it('refuses a URL that is not in the catalog', async () => {
    await expect(client.extract('https://venues.example/id/x/nope')).rejects.toThrow('not found');
  });

  // The scout's verifier keeps only claims quoted from a page it read. Every catalog fact must
  // survive that when quoted from its own page, or the scout would drop real demo data.
  it('states every price, capacity and catering claim in a form the scout verifier accepts', () => {
    for (const listing of catalog) {
      const url = listingUrl(listing);
      const page = renderListingPage(listing);
      const lang = listing.country === 'id' ? 'id' : 'en';
      const capacityLine = page.split('\n').find((l) => /^(Kapasitas \d|Capacity: up to)/.test(l));
      const cateringLine =
        listing.catering === 'unknown'
          ? undefined
          : page.split('\n').find((l) => /catering|katering|makan siang/i.test(l));
      const candidate: VenueCandidate = {
        name: listing.name,
        sourceUrls: [url],
        capacity:
          listing.capacity === null ? null : { value: listing.capacity, quote: capacityLine ?? '' },
        price:
          listing.price === null
            ? null
            : { ...listing.price, quote: priceText(listing.price, lang) },
        cateringIncluded: listing.catering,
        cateringQuote: cateringLine,
        booking: listing.booking,
      };
      expect(verifyCandidate(candidate, new Map([[url, page]]))).toEqual(candidate);
    }
  });
});
