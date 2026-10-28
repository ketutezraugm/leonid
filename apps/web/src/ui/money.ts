// The one money formatter for the web app. Amounts arrive as integer minor
// units (cents) plus an ISO currency code, and never become floats here.

export function formatMoney(minorUnits: number, currency = 'USD', locale = 'en-US'): string {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError(`Money must be an integer number of minor units, got ${minorUnits}`);
  }
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  const scale = 10 ** digits;
  const abs = Math.abs(minorUnits);
  const whole = Math.trunc(abs / scale);
  const fraction = String(abs % scale).padStart(digits, '0');
  const decimal = `${minorUnits < 0 ? '-' : ''}${whole}${digits > 0 ? `.${fraction}` : ''}`;
  // Intl formats decimal strings exactly (NumberFormat v3); the ES2022 lib types only know numbers.
  return format.format(decimal as unknown as number);
}
