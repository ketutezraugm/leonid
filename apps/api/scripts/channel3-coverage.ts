// Day-1 Channel3 coverage check (.claude/rules/channel3.md): real search calls for each demo item.
//
//   pnpm --filter @quartermaster/api channel3:coverage            summary per category
//   pnpm --filter @quartermaster/api channel3:coverage --raw DIR  also save each raw response to DIR
//
// The live response puts the amount at offer.price.price (a decimal in major units), not
// price.amount as the product guide shows. Offers carry no delivery estimate.
//
// One credit-costing call per category. If a category returns nothing usable, change the demo
// item; do not mock the API.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SEARCH_URL = 'https://api.trychannel3.com/v1/search';

const CATEGORIES = [
  // Short noun-first queries: words like "blank" or "bulk" pull in unrelated craft products.
  { item: 'lanyards', query: 'lanyard with badge holder' },
  { item: 'adapters', query: 'USB-C to HDMI adapter' },
  // Snacks were dropped: Channel3 has no grocery catalog (food queries return pet treats).
  { item: 'power strips', query: 'power strip surge protector' },
  { item: 'keyboards', query: 'wired USB keyboard' },
  { item: 'T-shirts', query: 'cotton crew neck t-shirt' },
];

const IN_STOCK = new Set(['InStock', 'LimitedAvailability']);

interface Offer {
  domain?: string;
  price?: { price?: number; compare_at_price?: number | null; currency?: string };
  availability?: string;
  url?: string;
}
interface Product {
  id?: string;
  title?: string;
  offers?: Offer[];
}

async function search(apiKey: string, query: string): Promise<unknown> {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 10 }),
    signal: AbortSignal.timeout(20_000),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

function summarize(body: unknown) {
  const products = ((body as { products?: Product[] })?.products ?? []) as Product[];
  const offers = products.flatMap((p) => p.offers ?? []);
  const usable = offers.filter(
    (o) => o.price?.price !== undefined && IN_STOCK.has(o.availability ?? ''),
  );
  const prices = usable.map((o) => o.price!.price!);
  return {
    products: products.length,
    offers: offers.length,
    usable: usable.length,
    priceRange: prices.length ? `${Math.min(...prices)}–${Math.max(...prices)}` : '-',
    currencies: [...new Set(offers.map((o) => o.price?.currency))].join(','),
    retailers: [...new Set(offers.map((o) => o.domain))].slice(0, 4).join(', '),
    productKeys: Object.keys(products[0] ?? {})
      .sort()
      .join(','),
    offerKeys: Object.keys(offers[0] ?? {})
      .sort()
      .join(','),
    // Eyeball relevance: semantic search can return near-misses.
    topTitles: products.slice(0, 5).map((p) => {
      const o = p.offers?.[0];
      return `${(p.title ?? '').slice(0, 55)} | ${o?.price?.price ?? '?'} ${o?.price?.currency ?? ''} @ ${o?.domain ?? '?'}`;
    }),
  };
}

async function main() {
  const apiKey = process.env.CHANNEL3_API_KEY;
  if (!apiKey) {
    console.log('CHANNEL3_API_KEY is not set (see .env.example)');
    process.exit(1);
  }
  const rawFlag = process.argv.indexOf('--raw');
  const rawDir = rawFlag > -1 ? process.argv[rawFlag + 1] : undefined;
  if (rawDir) await mkdir(rawDir, { recursive: true });

  let failed = false;
  for (const { item, query } of CATEGORIES) {
    try {
      const body = await search(apiKey, query);
      if (rawDir) await writeFile(path.join(rawDir, `${item}.json`), JSON.stringify(body, null, 2));
      const s = summarize(body);
      const mark = s.usable > 0 ? '✓' : '✗';
      if (s.usable === 0) failed = true;
      console.log(
        `${mark} ${item}: ${s.products} products, ${s.usable}/${s.offers} usable offers, ` +
          `price ${s.priceRange} ${s.currencies}, retailers: ${s.retailers || '-'}`,
      );
      console.log(`    product fields: ${s.productKeys}`);
      console.log(`    offer fields:   ${s.offerKeys}`);
      for (const t of s.topTitles) console.log(`      - ${t}`);
    } catch (err) {
      failed = true;
      console.log(`✗ ${item}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

await main();
