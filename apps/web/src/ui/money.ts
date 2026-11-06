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

// Reads what a person typed into a money field ("2,500", "2500.5", "$1 200.00") as integer minor units, without floats.
// Returns null for anything that is not a plain non-negative amount with at most the currency's decimals.
export function parseMoneyInput(text: string, currency = 'USD'): number | null {
  const digits = WHOLE_UNIT_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
  const cleaned = text.trim().replace(/^[^\d.-]+/, '').replace(/[,\s_]/g, '');
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > digits) return null;
  const minor = Number(`${match[1]}${fraction.padEnd(digits, '0')}`);
  return Number.isSafeInteger(minor) ? minor : null;
}
