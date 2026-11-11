const KEY = 'leonid.balanceHidden';

// Whether the person hid the PayPal balance in the account card. Shown until they choose, and when storage
// throws (private windows, blocked data).

export function readBalanceHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveBalanceHidden(hidden: boolean) {
  try {
    localStorage.setItem(KEY, String(hidden));
  } catch {
    // ignore
  }
}
