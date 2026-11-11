// The one money formatter for the web app. Amounts arrive as integer minor
// units (cents) plus an ISO currency code, and never become floats here.

// Currencies the API stores as whole units, whatever Intl's default digits are.
const WHOLE_UNIT_CURRENCIES = new Set(['IDR', 'JPY', 'KRW', 'VND']);

export function formatMoney(minorUnits: number, currency = 'USD', locale = 'en-US'): string {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError(`Money must be an integer number of minor units, got ${minorUnits}`);
  }
  const code = currency.toUpperCase();
  const format = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    ...(WHOLE_UNIT_CURRENCIES.has(code) ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  const scale = 10 ** digits;
  const abs = Math.abs(minorUnits);
  const whole = Math.trunc(abs / scale);
  const fraction = String(abs % scale).padStart(digits, '0');
  const decimal = `${minorUnits < 0 ? '-' : ''}${whole}${digits > 0 ? `.${fraction}` : ''}`;
  // Intl formats decimal strings exactly (NumberFormat v3); the ES2022 lib types only know numbers.
  return format.format(decimal as unknown as number);
}

// What a person typed in a money field ("8,000" or "8000.50") as integer minor units of a two-decimal currency,
// or null when it isn't an amount. Parsed as text, so no float ever touches it.
export function parseMoneyInput(text: string, currency = 'USD'): number | null {
  if (WHOLE_UNIT_CURRENCIES.has(currency.toUpperCase())) {
    return /^\d{1,12}$/.test(text.trim().replace(/,/g, '')) ? Number(text.trim().replace(/,/g, '')) : null;
  }
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(
    text.trim().replace(/^\$/, '').replace(/,/g, ''),
  );
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}
