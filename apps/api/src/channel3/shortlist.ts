import type { ProductOffer } from './client.js';

export const SHORTLIST_SIZE = 3;

const IN_STOCK = new Set(['InStock', 'LimitedAvailability']);

// "24 Pack", "4-pack", "50 ct", "100 count", "10 pcs", "pack of 12", "set of 6".
const PACK_PATTERNS = [
  /\b(\d{1,4})\s*-?\s*(?:pack|pk|count|ct|pcs|pieces|pc)\b/i,
  /\b(?:pack|set|box)\s+of\s+(\d{1,4})\b/i,
];

// Pack size from the title, or null when the title does not say. Null is treated as one unit,
// which can only overstate the unit price, never understate it.
export function packSizeOf(title: string): number | null {
  for (const pattern of PACK_PATTERNS) {
    const n = Number(pattern.exec(title)?.[1]);
    if (Number.isInteger(n) && n > 1) return n;
  }
  return null;
}

export interface ShortlistRequest {
  // Every keyword must appear in the title (case-insensitive). This is what stops "trail mix"
  // matching dog treats: semantic search returns near-misses.
  keywords: string[];
  quantity: number;
  currency: string;
  maxUnitCents?: number;
}

export interface ShortlistOption extends ProductOffer {
  packSize: number;
  packSizeKnown: boolean;
  unitCents: number;
  packsNeeded: number;
  totalCents: number;
}

export type DropReason =
  'irrelevant' | 'not_new' | 'out_of_stock' | 'currency' | 'over_cap' | 'duplicate';

export interface Shortlist {
  options: ShortlistOption[];
  considered: number;
  dropped: Record<DropReason, number>;
}

// Deterministic choice of the top options: code ranks, the LLM only explains. Same offers in,
// same shortlist out.
export function shortlist(offers: ProductOffer[], req: ShortlistRequest): Shortlist {
  const dropped: Record<DropReason, number> = {
    irrelevant: 0,
    not_new: 0,
    out_of_stock: 0,
    currency: 0,
    over_cap: 0,
    duplicate: 0,
  };
  const keywords = req.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  const kept: ShortlistOption[] = [];

  for (const offer of offers) {
    const title = offer.title.toLowerCase();
    let reason: DropReason | null = null;
    if (!keywords.every((k) => title.includes(k))) reason = 'irrelevant';
    else if (offer.condition !== 'new') reason = 'not_new';
    else if (!IN_STOCK.has(offer.availability)) reason = 'out_of_stock';
    else if (offer.currency !== req.currency) reason = 'currency';
    if (reason) {
      dropped[reason] += 1;
      continue;
    }

    // The same listing often appears under several product variants.
    const key = `${title}|${offer.retailer}|${offer.priceCents}`;
    if (seen.has(key)) {
      dropped.duplicate += 1;
      continue;
    }
    seen.add(key);

    const known = packSizeOf(offer.title);
    const packSize = known ?? 1;
    const unitCents = Math.ceil(offer.priceCents / packSize);
    if (req.maxUnitCents !== undefined && unitCents > req.maxUnitCents) {
      dropped.over_cap += 1;
      continue;
    }
    const packsNeeded = Math.ceil(req.quantity / packSize);
    kept.push({
      ...offer,
      packSize,
      packSizeKnown: known !== null,
      unitCents,
      packsNeeded,
      totalCents: packsNeeded * offer.priceCents,
    });
  }

  const discount = (o: ShortlistOption) => (o.compareAtCents ?? o.priceCents) - o.priceCents;
  kept.sort(
    (a, b) =>
      a.unitCents - b.unitCents ||
      discount(b) - discount(a) ||
      a.retailer.localeCompare(b.retailer) ||
      a.productId.localeCompare(b.productId),
  );

  return { options: kept.slice(0, SHORTLIST_SIZE), considered: offers.length, dropped };
}
