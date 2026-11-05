import type { SponsorReportLine } from '@quartermaster/shared';
import type { FoundTransaction } from '../paypal/search.js';
import { SEARCH_MAX_DAYS } from '../paypal/search.js';

// Checks each purchase of a report against PayPal's own transaction records (Transaction Search). Pure. The ledger and the executor
// stay the source of the report's figures; this only adds whether PayPal agrees, and it never turns a missing record into an
// accusation, because Transaction Search lags (up to ~3 hours) and a payment can simply not be listed yet.
//   confirmed  a successful (S) transaction for the same id and the same gross amount
//   differs    PayPal lists the id, but not as a successful payment of that amount (reversed, pending, another amount)
//   not_found  PayPal does not list the id (yet)
// A purchase's PayPal id is the capture id or, for a spend the treasurer approved, the order id; a transaction matches on either its
// own id or the base (reference) id it points at. A line with no PayPal id is left unchecked.
export function crossCheckLines(lines: readonly SponsorReportLine[], found: readonly FoundTransaction[], currency: string): SponsorReportLine[] {
  return lines.map((line) => {
    if (!line.paypalId) return line;
    const matches = found.filter((f) => f.transactionId === line.paypalId || f.referenceId === line.paypalId);
    if (matches.length === 0) return { ...line, paypalCheck: 'not_found' };
    const agrees = matches.some((f) => f.status === 'S' && f.currency === currency && f.amountMinor !== null && Math.abs(f.amountMinor) === line.purchaseMinor);
    return { ...line, paypalCheck: agrees ? 'confirmed' : 'differs' };
  });
}

// The windows to search so that every line is covered: from a day before the earliest purchase to `now`, in chunks Transaction Search
// accepts. Empty when there is nothing to look up.
export function searchWindows(lines: readonly SponsorReportLine[], now: Date): { start: Date; end: Date }[] {
  const times = lines.filter((l) => l.paypalId).map((l) => Date.parse(l.at));
  if (times.length === 0) return [];
  const from = Math.min(...times) - 86_400_000;
  const step = (SEARCH_MAX_DAYS - 1) * 86_400_000;
  const windows: { start: Date; end: Date }[] = [];
  for (let start = from; start < now.getTime(); start += step) {
    windows.push({ start: new Date(start), end: new Date(Math.min(start + step, now.getTime())) });
  }
  return windows;
}
