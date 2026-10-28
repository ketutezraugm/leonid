import { describe, expect, it } from 'vitest';
import type { ProductOffer } from './client.js';
import { packSizeOf, shortlist } from './shortlist.js';

let n = 0;
function offer(over: Partial<ProductOffer>): ProductOffer {
  n += 1;
  return {
    productId: `p${n}`,
    title: 'Lanyard with Badge Holder',
    retailer: `shop${n}.example`,
    priceCents: 1000,
    compareAtCents: null,
    currency: 'USD',
    availability: 'InStock',
    condition: 'new',
    buyUrl: `https://buy.trychannel3.com/p${n}`,
    ...over,
  };
}

const req = { keywords: ['lanyard'], quantity: 200, currency: 'USD' };

describe('packSizeOf', () => {
  it.each([
    ['ID Badge Holder with Lanyard, 50 Pack', 50],
    ['Lanyards 4-pack', 4],
    ['Lanyard 100 ct', 100],
    ['Pack of 12 lanyards', 12],
    ['Lanyard Badge & ID Holder', null],
    ['USB-C Adapter 4K', null],
  ])('%s → %s', (title, size) => {
    expect(packSizeOf(title)).toBe(size);
  });
});

describe('shortlist', () => {
  it('drops irrelevant, used, out-of-stock and wrong-currency offers, and counts why', () => {
    const result = shortlist(
      [
        offer({ title: 'Trail Mix Dog Treats' }),
        offer({ condition: 'used' }),
        offer({ condition: null }),
        offer({ availability: 'SoldOut' }),
        offer({ currency: 'CAD' }),
        offer({}),
      ],
      req,
    );
    expect(result.options).toHaveLength(1);
    expect(result.considered).toBe(6);
    expect(result.dropped).toMatchObject({
      irrelevant: 1,
      not_new: 2,
      out_of_stock: 1,
      currency: 1,
    });
  });

  it('ranks by unit price using the pack size, and sizes the order', () => {
    const single = offer({ title: 'Lanyard', priceCents: 199 });
    const pack = offer({ title: 'Lanyard 50 Pack', priceCents: 2500 });
    const { options } = shortlist([single, pack], req);
    expect(options.map((o) => o.productId)).toEqual([pack.productId, single.productId]);
    expect(options[0]).toMatchObject({
      packSize: 50,
      packSizeKnown: true,
      unitCents: 50,
      packsNeeded: 4,
      totalCents: 10_000,
    });
    expect(options[1]).toMatchObject({ packSizeKnown: false, packsNeeded: 200 });
  });

  it('applies the unit price cap', () => {
    const { options, dropped } = shortlist(
      [offer({ priceCents: 150 }), offer({ priceCents: 90 })],
      { ...req, maxUnitCents: 100 },
    );
    expect(options.map((o) => o.unitCents)).toEqual([90]);
    expect(dropped.over_cap).toBe(1);
  });

  it('keeps at most three, removes duplicates, and breaks ties by discount', () => {
    const base = { title: 'Lanyard', priceCents: 500 };
    const discounted = offer({ ...base, compareAtCents: 900 });
    const dup = offer({ ...base, retailer: 'same.example' });
    const { options, dropped } = shortlist(
      [
        offer(base),
        dup,
        { ...dup, productId: 'variant' },
        discounted,
        offer({ ...base, priceCents: 700 }),
      ],
      req,
    );
    expect(options).toHaveLength(3);
    expect(options[0]?.productId).toBe(discounted.productId);
    expect(dropped.duplicate).toBe(1);
  });

  it('returns nothing rather than a bad match when no offer is relevant', () => {
    const { options } = shortlist([offer({ title: 'Squirrel Treats' })], req);
    expect(options).toEqual([]);
  });
});
