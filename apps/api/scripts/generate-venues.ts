// Builds data/venues.json, the seeded demo venue catalog that src/search/venueCatalog.ts serves to
// the venue scout. Runs offline, never on the request path. Same seed, same file:
//
//   pnpm --filter @quartermaster/api venues:generate
//   VENUES_SEED=7 pnpm --filter @quartermaster/api venues:generate    # a different dataset
//
// Every venue is invented: names are built from area names and generic words, with no hotel or
// venue brands (AGENTS.md: no third-party brands in seed data) and no phone numbers.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { VenueListing } from '../src/search/venueListing.js';

const DEFAULT_SEED = 20261029;
const VENUES_PER_AREA = 3;

type Country = VenueListing['country'];
type VenueType = VenueListing['type'];
type Currency = NonNullable<VenueListing['price']>['currency'];

const CITIES: { country: Country; city: string; areas: string[] }[] = [
  {
    country: 'id',
    city: 'Jakarta',
    areas: ['West Jakarta', 'South Jakarta', 'Central Jakarta', 'North Jakarta', 'East Jakarta'],
  },
  { country: 'id', city: 'Bandung', areas: ['Dago', 'Braga', 'Pasteur'] },
  { country: 'id', city: 'Surabaya', areas: ['Gubeng', 'Tegalsari', 'Wiyung'] },
  { country: 'id', city: 'Yogyakarta', areas: ['Malioboro', 'Sleman', 'Prawirotaman'] },
  { country: 'id', city: 'Bali', areas: ['Denpasar', 'Canggu', 'Ubud'] },
  {
    country: 'my',
    city: 'Kuala Lumpur',
    areas: ['Bukit Bintang', 'Bangsar', 'KLCC', 'Mont Kiara'],
  },
  { country: 'my', city: 'Petaling Jaya', areas: ['Damansara', 'SS2', 'Section 13'] },
  { country: 'my', city: 'Penang', areas: ['George Town', 'Bayan Lepas'] },
  { country: 'my', city: 'Johor Bahru', areas: ['Iskandar Puteri', 'Taman Molek'] },
  {
    country: 'sg',
    city: 'Singapore',
    areas: ['Raffles Place', 'Orchard', 'one-north', 'Bugis', 'Jurong East', 'Tanjong Pagar'],
  },
];

// Local area names used in Indonesian venue names; areas not listed use their own name.
const LOCAL_AREA: Record<string, string> = {
  'West Jakarta': 'Jakarta Barat',
  'South Jakarta': 'Jakarta Selatan',
  'Central Jakarta': 'Jakarta Pusat',
  'North Jakarta': 'Jakarta Utara',
  'East Jakarta': 'Jakarta Timur',
};

const NAMES: Record<VenueType, { id: string[]; en: string[] }> = {
  hotel_ballroom: {
    id: ['Hotel Cendana {a}', 'Hotel Kenanga {a}', 'Grand Melati Ballroom {a}'],
    en: ['The Meridian Ballroom {a}', 'Harbourline Hotel {a}', 'Cinnamon Grand Ballroom {a}'],
  },
  meeting_room: {
    id: ['Ruang Rapat Sinergi {a}', 'Paket Meeting Lentera {a}', 'Meeting Point {a}'],
    en: ['Boardroom Collective {a}', 'The Briefing Rooms {a}', 'Quorum Meeting Suites {a}'],
  },
  coworking: {
    id: ['Ruang Kolaborasi {a}', 'Kerja Bareng Hub {a}', 'Titik Temu Coworking {a}'],
    en: ['Common Ground Studio {a}', 'The Workbench {a}', 'Basecamp Coworking {a}'],
  },
  auditorium: {
    id: ['Aula Nusantara {a}', 'Auditorium Cipta {a}', 'Aula Bhinneka {a}'],
    en: ['Lecture Theatre {a}', 'The Forum Auditorium {a}', 'Keynote Hall {a}'],
  },
  rooftop: {
    id: ['Rooftop Senja {a}', 'Teras Langit {a}', 'Atap Kota {a}'],
    en: ['Skyline Deck {a}', 'The Terrace {a}', 'Twelfth Floor Rooftop {a}'],
  },
  restaurant: {
    id: ['Rumah Makan Lestari {a}', 'Dapur Kayu {a}', 'Restoran Rempah {a}'],
    en: ['The Long Table {a}', 'Copper Pot Dining {a}', 'Lantern Kitchen {a}'],
  },
  convention_hall: {
    id: ['Gedung Serbaguna {a}', 'Balai Pertemuan {a}', 'Convention Hall {a}'],
    en: ['Exhibition Hall {a}', 'The Assembly Hall {a}', 'Convention Centre {a}'],
  },
};

// Capacity range and how each type usually prices, per currency (minor units).
const TYPES: Record<
  VenueType,
  {
    capacity: [number, number];
    per: NonNullable<VenueListing['price']>['per'];
    price: Record<Currency, [number, number]>;
    // USD cents. Small rooms stay under the $200 auto-pay rule; big venues go to the treasurer.
    deposit: [number, number];
    catering: VenueListing['catering'][];
    amenities: string[];
    blurb: { id: string; en: string };
  }
> = {
  hotel_ballroom: {
    capacity: [150, 600],
    per: 'pax',
    price: { IDR: [250_000, 550_000], MYR: [9_000, 20_000], SGD: [8_000, 18_000] },
    deposit: [15_000, 50_000],
    catering: ['yes'],
    amenities: ['Projector', 'Sound system', 'Stage', 'Parking', 'Wi-Fi', 'Prayer room'],
    blurb: {
      id: 'Ballroom hotel dengan paket meeting full day, cocok untuk konferensi dan hackathon.',
      en: 'Hotel ballroom with full-day meeting packages, suited to conferences and hackathons.',
    },
  },
  meeting_room: {
    capacity: [20, 120],
    per: 'pax',
    price: { IDR: [150_000, 350_000], MYR: [6_000, 14_000], SGD: [5_000, 12_000] },
    deposit: [5_000, 15_000],
    catering: ['yes', 'yes', 'unknown'],
    amenities: ['Projector', 'Whiteboard', 'Wi-Fi', 'Video conferencing', 'Parking'],
    blurb: {
      id: 'Ruang meeting dengan paket half day dan full day, termasuk coffee break.',
      en: 'Meeting rooms with half-day and full-day packages.',
    },
  },
  coworking: {
    capacity: [40, 200],
    per: 'hour',
    price: { IDR: [750_000, 2_500_000], MYR: [25_000, 90_000], SGD: [30_000, 120_000] },
    deposit: [5_000, 20_000],
    catering: ['no', 'unknown'],
    amenities: ['Fast Wi-Fi', 'Projector', 'Breakout rooms', 'Power at every seat', 'Pantry'],
    blurb: {
      id: 'Event space di coworking, cocok untuk meetup, workshop, dan hackathon komunitas.',
      en: 'Event space inside a coworking floor, popular with meetups, workshops and community hackathons.',
    },
  },
  auditorium: {
    capacity: [100, 500],
    per: 'day',
    price: { IDR: [8_000_000, 25_000_000], MYR: [300_000, 900_000], SGD: [350_000, 1_200_000] },
    deposit: [20_000, 50_000],
    catering: ['no', 'unknown'],
    amenities: ['Tiered seating', 'Stage', 'Sound system', 'Dual projectors', 'Green room'],
    blurb: {
      id: 'Auditorium dengan kursi bertingkat untuk keynote dan demo day.',
      en: 'Tiered auditorium for keynotes and demo days.',
    },
  },
  rooftop: {
    capacity: [50, 250],
    per: 'package',
    price: {
      IDR: [15_000_000, 45_000_000],
      MYR: [500_000, 1_500_000],
      SGD: [600_000, 2_000_000],
    },
    deposit: [25_000, 60_000],
    catering: ['yes', 'unknown'],
    amenities: ['City view', 'Bar', 'Sound system', 'Outdoor lighting', 'Rain cover'],
    blurb: {
      id: 'Rooftop untuk networking malam dan after party.',
      en: 'Rooftop for evening networking and after-parties.',
    },
  },
  restaurant: {
    capacity: [20, 100],
    per: 'pax',
    price: { IDR: [120_000, 300_000], MYR: [5_000, 12_000], SGD: [4_500, 10_000] },
    deposit: [5_000, 12_000],
    catering: ['yes'],
    amenities: ['Private room', 'TV screen', 'Wi-Fi', 'Set menu'],
    blurb: {
      id: 'Ruang privat restoran untuk meetup kecil dan makan malam sponsor.',
      en: 'Private dining room for small meetups and sponsor dinners.',
    },
  },
  convention_hall: {
    capacity: [300, 1500],
    per: 'day',
    price: {
      IDR: [30_000_000, 90_000_000],
      MYR: [1_000_000, 3_500_000],
      SGD: [1_500_000, 5_000_000],
    },
    deposit: [40_000, 80_000],
    catering: ['no', 'unknown', 'yes'],
    amenities: ['Loading dock', 'Booth space', 'Stage', 'Sound system', 'Parking', 'Generator'],
    blurb: {
      id: 'Gedung serbaguna untuk expo, konferensi besar, dan acara ratusan peserta.',
      en: 'Large hall for expos, big conferences and events with hundreds of attendees.',
    },
  },
};

const CURRENCY: Record<Country, Currency> = { id: 'IDR', my: 'MYR', sg: 'SGD' };

// Indonesian venues mostly take bookings on WhatsApp; Singapore venues mostly online.
const BOOKING: Record<Country, VenueListing['booking'][]> = {
  id: ['whatsapp', 'whatsapp', 'whatsapp', 'phone'],
  my: ['whatsapp', 'phone', 'website'],
  sg: ['website', 'website', 'phone'],
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateVenues(seed: number): VenueListing[] {
  const rand = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const between = (lo: number, hi: number, step: number) =>
    Math.round((lo + rand() * (hi - lo)) / step) * step;
  const types = Object.keys(TYPES) as VenueType[];
  const listings: VenueListing[] = [];
  const usedNames = new Set<string>();

  for (const { country, city, areas } of CITIES) {
    const lang = country === 'id' ? 'id' : 'en';
    const currency = CURRENCY[country];
    for (const area of areas) {
      // Distinct types within one area, so a search there shows a spread.
      const areaTypes = [...types].sort(() => rand() - 0.5).slice(0, VENUES_PER_AREA);
      for (const type of areaTypes) {
        const spec = TYPES[type];
        const localArea = lang === 'id' ? (LOCAL_AREA[area] ?? area) : area;
        let name = pick(NAMES[type][lang]).replace('{a}', localArea);
        for (let n = 2; usedNames.has(name); n++) name = `${name.replace(/ \d+$/, '')} ${n}`;
        usedNames.add(name);

        const [priceLo, priceHi] = spec.price[currency];
        // IDR prices round to Rp 5.000; MYR and SGD to whole units.
        const step = currency === 'IDR' ? 5_000 : 100;
        listings.push({
          id: slug(`${country} ${area} ${type}`),
          name,
          country,
          city,
          area,
          type,
          // A few venues leave capacity or price off the page, as real ones do.
          capacity: rand() < 0.1 ? null : between(...spec.capacity, 10),
          price:
            rand() < 0.2
              ? null
              : { amountMinor: between(priceLo, priceHi, step), currency, per: spec.per },
          // Whole dollars in steps of $10.
          deposit: { amountMinor: between(...spec.deposit, 1_000), currency: 'USD' },
          catering: pick(spec.catering),
          booking: pick(BOOKING[country]),
          amenities: [...spec.amenities].sort(() => rand() - 0.5).slice(0, 4),
          description: spec.blurb[lang],
        });
      }
    }
  }
  return listings;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const seed = Number(process.env.VENUES_SEED ?? DEFAULT_SEED);
  if (!Number.isInteger(seed)) throw new Error(`VENUES_SEED must be an integer`);
  // Validate before writing: the catalog loader would reject a bad file at boot anyway.
  const venues = z.array(VenueListing).parse(generateVenues(seed));
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/venues.json');
  writeFileSync(out, `${JSON.stringify(venues, null, 2)}\n`);
  console.log(`[venues] wrote ${venues.length} venues (seed ${seed}) to ${out}`);
}
