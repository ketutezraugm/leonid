// The one money formatter for the web app. Amounts are integer minor units; currencies the API
// stores as whole units (IDR has no minor unit in our data) are listed here.
const WHOLE_UNIT_CURRENCIES = new Set(['IDR', 'JPY', 'KRW', 'VND']);

export function minorUnitDigits(currency: string): number {
  return WHOLE_UNIT_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

export function formatMoney(amountMinor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  const amount = amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    // An unknown currency code: still show the number rather than nothing.
    return `${currency.toUpperCase()} ${amount.toFixed(digits)}`;
  }
}
