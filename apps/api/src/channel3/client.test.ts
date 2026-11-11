import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { Channel3ApiError, createChannel3Client, toCents } from './client.js';

const fixture = JSON.parse(
  await readFile(new URL('./__fixtures__/search-adapters.json', import.meta.url), 'utf8'),
) as unknown;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(res: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(res);
  return { client: createChannel3Client({ apiKey: 'c3-key', fetch }), fetch };
}

describe('toCents', () => {
  it('rounds decimal major units to integer cents once', () => {
    expect(toCents(12.98)).toBe(1298);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(6)).toBe(600);
  });

  it('rejects negative or non-finite amounts', () => {
    expect(() => toCents(-1)).toThrow(RangeError);
    expect(() => toCents(Number.NaN)).toThrow(RangeError);
  });
});

describe('createChannel3Client', () => {
  it('searches with the api key header and in-stock filter', async () => {
    const { client, fetch } = setup(json(200, fixture));
    await client.search('USB-C to HDMI adapter', { maxPriceCents: 2500, limit: 5 });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.trychannel3.com/v1/search');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('c3-key');
    expect(JSON.parse(init?.body as string)).toEqual({
      query: 'USB-C to HDMI adapter',
      limit: 5,
      filters: { availability: ['InStock', 'LimitedAvailability'], price: { max_price: 25 } },
    });
  });

  it('flattens products into offers in integer cents', async () => {
    const { client } = setup(json(200, fixture));
    const offers = await client.search('adapter');
    expect(offers).toHaveLength(3);
    expect(offers[0]).toEqual({
      productId: 'P1adapt',
      title: 'USB-C to HDMI Adapter 4K',
      retailer: 'officeshop.example',
      priceCents: 1298,
      compareAtCents: 1999,
      currency: 'USD',
      availability: 'InStock',
      condition: 'new',
      buyUrl: 'https://buy.trychannel3.com/P1adapt-a',
    });
    expect(offers[1]?.compareAtCents).toBeNull();
    expect(offers[2]?.condition).toBe('used');
  });

  it('enforces the price cap itself, since Channel3 treats it as a hint', async () => {
    const { client } = setup(json(200, fixture));
    const offers = await client.search('adapter', { maxPriceCents: 1500 });
    expect(offers.map((o) => o.priceCents)).toEqual([1298, 600]);
  });

  it('throws Channel3ApiError on an error status', async () => {
    const { client } = setup(json(401, { detail: 'bad key' }));
    await expect(client.search('x')).rejects.toBeInstanceOf(Channel3ApiError);
  });

  it('rejects the documented-but-wrong price.amount shape', async () => {
    const wrong = {
      products: [
        {
          id: 'x',
          title: 'x',
          offers: [
            {
              url: 'https://buy.trychannel3.com/x',
              domain: 'a.example',
              price: { amount: 10, currency: 'USD' },
              availability: 'InStock',
            },
          ],
        },
      ],
    };
    const { client } = setup(json(200, wrong));
    await expect(client.search('x')).rejects.toThrow();
  });
});
