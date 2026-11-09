// Demo exchange rates for the venue catalog's currencies, as local minor units per 1 USD. Sandbox only: PayPal cannot
// charge IDR and takes MYR only between Malaysian accounts, so a venue's price is converted to USD to be paid. A fixed
// table keeps the demo repeatable and keeps a live FX call out of the money path.
export const LOCAL_MINOR_PER_USD = {
  IDR: 16_000, // whole rupiah, no minor unit
  MYR: 440, // sen
  SGD: 130, // cents
} as const;

export type FxCurrency = keyof typeof LOCAL_MINOR_PER_USD;

export function isFxCurrency(currency: string): currency is FxCurrency {
  return Object.hasOwn(LOCAL_MINOR_PER_USD, currency);
}

// USD cents for an amount in a venue currency's minor units. Integer maths, rounded up so the charge never falls short.
export function toUsdCents(amountMinor: number, currency: string): number {
  if (!isFxCurrency(currency)) throw new Error(`No demo exchange rate for ${currency}`);
  return Math.ceil((amountMinor * 100) / LOCAL_MINOR_PER_USD[currency]);
}
