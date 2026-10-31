import { z } from 'zod';
import catalogJson from '../../data/venues.json' with { type: 'json' };
import type { SearchClient, SearchResult } from './client.js';
import { VenueListing } from './venueListing.js';

export { VenueListing };

// Seeded demo venues for Indonesia, Malaysia and Singapore, written by scripts/generate-venues.ts.
// They stand in for web search: every listing is served as a page at a reserved .example URL, so
// the venue scout reads, quotes and verifies them exactly as it would a real page.
export const CATALOG_HOST = 'venues.example';

const SEARCH_RESULTS = 5;

// Validated at load like any other external input, so a hand-edited file fails loudly.
let catalog: VenueListing[] | null = null;
export function loadVenueCatalog(): VenueListing[] {
  catalog ??= z.array(VenueListing).parse(catalogJson);
  return catalog;
}

export function listingUrl(listing: VenueListing): string {
  return `https://${CATALOG_HOST}/${listing.country}/${slug(listing.city)}/${listing.id}`;
}

// The catalog listing a source URL points at, or null for any other page (a web search result).
// The deposit route uses it so the amount always comes from the catalog, never from the agent.
export function findListing(url: string, listings = loadVenueCatalog()): VenueListing | null {
  return listings.find((l) => listingUrl(l) === url) ?? null;
}

// "US$ 150.00", as the listing page shows a deposit.
export function depositText(deposit: VenueListing['deposit']): string {
  return `US$ ${(deposit.amountMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// Words a query may use for each city, in English and the local language.
const CITY_ALIASES: Record<string, string[]> = {
  Jakarta: ['jakarta', 'jkt', 'dki'],
  Bandung: ['bandung'],
  Surabaya: ['surabaya'],
  Yogyakarta: ['yogyakarta', 'jogja', 'jogjakarta', 'yogya', 'diy'],
  Bali: ['bali', 'denpasar', 'canggu', 'seminyak', 'ubud'],
  'Kuala Lumpur': ['kuala lumpur', 'kl'],
  'Petaling Jaya': ['petaling jaya', 'pj', 'selangor'],
  Penang: ['penang', 'george town', 'georgetown', 'pulau pinang'],
  'Johor Bahru': ['johor bahru', 'johor', 'jb'],
  Singapore: ['singapore', 'singapura', 'sg'],
};

const COUNTRY_ALIASES: Record<VenueListing['country'], string[]> = {
  id: ['indonesia'],
  my: ['malaysia'],
  sg: ['singapore', 'singapura'],
};

// Local names for areas, so "jakarta barat" finds West Jakarta.
const AREA_ALIASES: Record<string, string[]> = {
  'West Jakarta': ['jakarta barat', 'jakbar'],
  'South Jakarta': ['jakarta selatan', 'jaksel'],
  'Central Jakarta': ['jakarta pusat', 'jakpus'],
  'North Jakarta': ['jakarta utara', 'jakut'],
  'East Jakarta': ['jakarta timur', 'jaktim'],
};

const TYPE_WORDS: Record<VenueListing['type'], string[]> = {
  hotel_ballroom: ['hotel', 'ballroom'],
  meeting_room: ['meeting', 'rapat', 'paket'],
  coworking: ['coworking', 'co-working', 'workspace'],
  auditorium: ['auditorium', 'aula', 'theatre', 'theater'],
  rooftop: ['rooftop', 'outdoor'],
  restaurant: ['restaurant', 'restoran', 'cafe', 'kafe'],
  convention_hall: ['convention', 'hall', 'gedung', 'serbaguna', 'expo'],
};

const has = (text: string, phrase: string) =>
  new RegExp(`(^|[^a-z])${phrase.replace(/[-]/g, '\\-')}([^a-z]|$)`).test(text);

// The headcount a query asks for, if it names one ("200 orang", "for 150 people", "200 pax").
function headcountOf(query: string): number | null {
  const counts = [...query.matchAll(/\b(\d{2,4})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 10 && n <= 5000 && (n < 1900 || n > 2100));
  return counts[0] ?? null;
}

// Ranks listings for a free-text query. A query must name a place we have venues for; otherwise
// nothing comes back, the way a web search for an unknown town finds nothing useful.
export function searchCatalog(listings: readonly VenueListing[], query: string): VenueListing[] {
  const q = query.toLowerCase();
  const cities = Object.entries(CITY_ALIASES)
    .filter(([, aliases]) => aliases.some((a) => has(q, a)))
    .map(([city]) => city);
  const countries = (Object.keys(COUNTRY_ALIASES) as VenueListing['country'][]).filter((c) =>
    COUNTRY_ALIASES[c].some((a) => has(q, a)),
  );
  if (cities.length === 0 && countries.length === 0) return [];

  const headcount = headcountOf(q);
  const scored = listings
    .filter((l) => (cities.length > 0 ? cities.includes(l.city) : countries.includes(l.country)))
    .map((l) => {
      let score = 0;
      const areaNames = [l.area.toLowerCase(), ...(AREA_ALIASES[l.area] ?? [])];
      if (areaNames.some((a) => has(q, a))) score += 4;
      if (TYPE_WORDS[l.type].some((w) => has(q, w))) score += 2;
      if (headcount !== null && l.capacity !== null) {
        // Fits with room to spare scores best; too small is pushed to the bottom.
        if (l.capacity < headcount) score -= 6;
        else score += 3 - Math.min(3, (l.capacity - headcount) / headcount);
      }
      return { l, score };
    });
  scored.sort((a, b) => b.score - a.score || a.l.id.localeCompare(b.l.id));
  return scored.slice(0, SEARCH_RESULTS).map((s) => s.l);
}

const TYPE_LABEL: Record<VenueListing['type'], { id: string; en: string }> = {
  hotel_ballroom: { id: 'Ballroom hotel', en: 'Hotel ballroom' },
  meeting_room: { id: 'Ruang meeting', en: 'Meeting room' },
  coworking: { id: 'Coworking space', en: 'Coworking event space' },
  auditorium: { id: 'Auditorium', en: 'Auditorium' },
  rooftop: { id: 'Rooftop', en: 'Rooftop venue' },
  restaurant: { id: 'Ruang privat restoran', en: 'Restaurant private room' },
  convention_hall: { id: 'Gedung serbaguna', en: 'Convention hall' },
};

const PER_LABEL = {
  id: { pax: 'per pax', package: 'per paket', hour: 'per jam', day: 'per hari' },
  en: { pax: 'per pax', package: 'per package', hour: 'per hour', day: 'per day' },
} as const;

const ADD_ON_UNIT = {
  id: { person: 'per orang', hour: 'per jam', event: 'per acara' },
  en: { person: 'per person', hour: 'per hour', event: 'per event' },
} as const;

function moneyText(amountMinor: number, currency: VenueListing['price']['currency']): string {
  return currency === 'IDR'
    ? `Rp ${amountMinor.toLocaleString('de-DE')}`
    : `${currency === 'MYR' ? 'RM' : 'S$'} ${(amountMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

// The price as it appears on the page. Its digits equal amountMinor, which is what the scout's
// verifier checks: "Rp 175.000" for 175000 rupiah, "RM 85.00" for 8500 sen.
export function priceText(price: VenueListing['price'], lang: 'id' | 'en'): string {
  return `${moneyText(price.amountMinor, price.currency)} ${PER_LABEL[lang][price.per]}`;
}

// The page's price line, in the venue's local language.
export function priceLine(listing: VenueListing): string {
  const lang = listing.country === 'id' ? 'id' : 'en';
  return `${lang === 'id' ? 'Harga mulai' : 'Price from'} ${priceText(listing.price, lang)}`;
}

// Minimums, what the price covers, tax and every add-on, one fact per line.
function termsLines({ terms, price }: VenueListing, lang: 'id' | 'en'): string[] {
  const id = lang === 'id';
  const { minPax, minHours, includes, addOns, taxPercent } = terms;
  return [
    ...(minPax !== null ? [id ? `Minimum ${minPax} orang` : `Minimum ${minPax} guests`] : []),
    ...(minHours !== null
      ? [id ? `Minimum sewa ${minHours} jam` : `Minimum hire ${minHours} hours`]
      : []),
    `${id ? 'Termasuk' : 'Included'}: ${includes.join(', ')}`,
    taxPercent > 0
      ? id
        ? `Belum termasuk pajak dan layanan ${taxPercent}%`
        : `Excludes ${taxPercent}% tax and service`
      : id
        ? 'Sudah termasuk pajak dan layanan'
        : 'Includes tax and service',
    ...(addOns.length > 0 ? [id ? 'Biaya tambahan:' : 'Add-ons:'] : []),
    ...addOns.map(({ name, amountMinor, unit, required }) => {
      const need = required ? (id ? 'wajib' : 'required') : id ? 'opsional' : 'optional';
      return `- ${name}: ${moneyText(amountMinor, price.currency)} ${ADD_ON_UNIT[lang][unit]} (${need})`;
    }),
  ];
}

// A plain-text listing page in the venue's local language (Indonesian for Indonesia, English otherwise).
export function renderListingPage(listing: VenueListing): string {
  const lang = listing.country === 'id' ? 'id' : 'en';
  const id = lang === 'id';
  const lines = [
    `# ${listing.name}`,
    `${TYPE_LABEL[listing.type][lang]} · ${listing.area}, ${listing.city}`,
    '',
    listing.description,
    '',
    listing.capacity !== null
      ? id
        ? `Kapasitas ${listing.capacity} orang`
        : `Capacity: up to ${listing.capacity} guests`
      : id
        ? 'Kapasitas: hubungi venue'
        : 'Capacity: ask the venue',
    priceLine(listing),
    ...termsLines(listing, lang),
    {
      yes: id
        ? 'Termasuk makan siang dan coffee break'
        : 'Catering included: lunch and coffee breaks',
      no: id
        ? 'Tidak termasuk katering, boleh vendor luar'
        : 'No in-house catering; outside caterers allowed',
      unknown: null,
    }[listing.catering],
    id
      ? `DP untuk mengunci tanggal: ${depositText(listing.deposit)}, bayar via PayPal`
      : `Deposit to hold the date: ${depositText(listing.deposit)}, payable with PayPal`,
    `${id ? 'Fasilitas' : 'Amenities'}: ${listing.amenities.join(', ')}`,
    {
      whatsapp: id ? 'Pemesanan via WhatsApp' : 'Book via WhatsApp',
      phone: id ? 'Pemesanan via telepon' : 'Book by phone',
      website: id ? 'Pemesanan via website' : 'Book online',
    }[listing.booking],
  ];
  return lines.filter((line) => line !== null).join('\n');
}

// A SearchClient over the catalog. It never touches the network, so the demo runs without a
// search API key and always finds the same venues.
export function createCatalogSearchClient(
  listings: readonly VenueListing[] = loadVenueCatalog(),
): SearchClient {
  const byUrl = new Map(listings.map((l) => [listingUrl(l), l]));
  return {
    search(query) {
      const results: SearchResult[] = searchCatalog(listings, query).map((l) => ({
        url: listingUrl(l),
        title: `${l.name} · ${l.area}, ${l.city}`,
        snippet: l.description.slice(0, 160),
      }));
      return Promise.resolve(results);
    },
    extract(url) {
      const listing = byUrl.get(url);
      return listing
        ? Promise.resolve(renderListingPage(listing))
        : Promise.reject(new Error('Could not read the page: not found'));
    },
  };
}
