import { z } from 'zod';

// The only place integer minor units become PayPal's decimal-string money and back.

export const PayPalMoney = z.object({
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  value: z.string(),
});
export type PayPalMoney = z.infer<typeof PayPalMoney>;

// PayPal takes these without decimals; our minor-unit convention doesn't map cleanly, so refuse them.
const ZERO_DECIMAL_CURRENCIES = new Set(['HUF', 'JPY', 'TWD']);

function assertCurrency(currency: string): string {
  const code = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new RangeError(`Invalid currency code: ${currency}`);
  if (ZERO_DECIMAL_CURRENCIES.has(code)) throw new RangeError(`Unsupported currency: ${code}`);
  return code;
}

export function toPayPalMoney(amountMinor: number, currency: string): PayPalMoney {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError(
      `Amount must be a non-negative integer of minor units, got ${amountMinor}`,
    );
  }
  const major = Math.floor(amountMinor / 100);
  const minor = String(amountMinor % 100).padStart(2, '0');
  return { currency_code: assertCurrency(currency), value: `${major}.${minor}` };
}

export function fromPayPalMoney(money: PayPalMoney): { amountMinor: number; currency: string } {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(money.value);
  if (!match) throw new RangeError(`Unexpected PayPal amount: ${money.value}`);
  const amountMinor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return { amountMinor, currency: assertCurrency(money.currency_code) };
}

// For balances, which can be negative after refunds. Never used for amounts we send or compare against a spend.
export function fromPayPalSignedMoney(money: PayPalMoney): { amountMinor: number; currency: string } {
  const negative = money.value.startsWith('-');
  const { amountMinor, currency } = fromPayPalMoney({ ...money, value: negative ? money.value.slice(1) : money.value });
  return { amountMinor: negative ? -amountMinor : amountMinor, currency };
}
