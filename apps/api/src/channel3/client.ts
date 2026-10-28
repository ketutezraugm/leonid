import { z } from 'zod';

export const CHANNEL3_BASE_URL = 'https://api.trychannel3.com';

const DEFAULT_LIMIT = 10;
const REQUEST_TIMEOUT_MS = 20_000;

export class Channel3ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// One retailer listing of a product, in our money convention. Product text (title) comes from
// third-party retailers and is untrusted data. There is no delivery estimate: Channel3 offers
// do not carry one, so nothing downstream may claim a delivery date.
export interface ProductOffer {
  productId: string;
  title: string;
  retailer: string;
  priceCents: number;
  compareAtCents: number | null;
  currency: string;
  availability: string;
  condition: string | null;
  buyUrl: string;
}

export interface SearchOptions {
  maxPriceCents?: number;
  limit?: number;
}

export interface Channel3Client {
  search(query: string, options?: SearchOptions): Promise<ProductOffer[]>;
}

export interface Channel3ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

// The live shape, checked with scripts/channel3-coverage.ts. The amount sits at price.price, not
// price.amount as the product guide shows. Fields we do not use are left out of the schema.
const Offer = z.object({
  url: z.url(),
  domain: z.string(),
  price: z.object({
    price: z.number().nonnegative(),
    compare_at_price: z.number().nonnegative().nullish(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  availability: z.string(),
  condition: z.string().nullish(),
});

const SearchResponse = z.object({
  products: z.array(z.object({ id: z.string(), title: z.string(), offers: z.array(Offer) })),
  next_page_token: z.string().nullish(),
});

// The Channel3 money boundary: decimal major units in, integer cents out, rounded once.
export function toCents(amount: number): number {
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`Unexpected Channel3 amount: ${amount}`);
  }
  return cents;
}

export function createChannel3Client(options: Channel3ClientOptions): Channel3Client {
  const baseUrl = options.baseUrl ?? CHANNEL3_BASE_URL;
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return {
    async search(query, { maxPriceCents, limit = DEFAULT_LIMIT } = {}) {
      const filters: Record<string, unknown> = { availability: ['InStock', 'LimitedAvailability'] };
      if (maxPriceCents !== undefined) filters.price = { max_price: maxPriceCents / 100 };

      const res = await fetchImpl(`${baseUrl}/v1/search`, {
        method: 'POST',
        headers: { 'x-api-key': options.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit, filters }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Channel3ApiError(res.status, `Channel3 returned HTTP ${res.status}`);

      const body = SearchResponse.parse(await res.json());
      const offers: ProductOffer[] = body.products.flatMap((product) =>
        product.offers.map((offer) => ({
          productId: product.id,
          title: product.title.slice(0, 200),
          retailer: offer.domain,
          priceCents: toCents(offer.price.price),
          compareAtCents:
            offer.price.compare_at_price == null ? null : toCents(offer.price.compare_at_price),
          currency: offer.price.currency,
          availability: offer.availability,
          condition: offer.condition ?? null,
          buyUrl: offer.url,
        })),
      );
      // Channel3 treats the price filter as a hint (a live $30 cap returned $49.99 listings),
      // so the cap is enforced here.
      return maxPriceCents === undefined
        ? offers
        : offers.filter((o) => o.priceCents <= maxPriceCents);
    },
  };
}

// Null when no key is set, so the agent has no procurement tools instead of failing at boot.
export function channel3ClientFromEnv(): Channel3Client | null {
  const apiKey = process.env.CHANNEL3_API_KEY;
  return apiKey ? createChannel3Client({ apiKey }) : null;
}
