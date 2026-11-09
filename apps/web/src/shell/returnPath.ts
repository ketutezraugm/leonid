const KEY = 'leonid.returnPath';

// PayPal always redirects back to "/", so a flow that left from a deeper page notes where to resume.
// Storage can throw (private windows, blocked data); the person then just lands on Event home.

export function rememberReturnPath(path: string) {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // ignore
  }
}

export function peekReturnPath(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearReturnPath() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
