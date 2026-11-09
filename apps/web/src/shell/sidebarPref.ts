const KEY = 'leonid.sidebarOpen';

// The person's choice to keep the sidebar open or closed, on every screen. Null until they make one, and
// when storage throws (private windows, blocked data); each screen then uses its own default.

export function readSidebarOpen(): boolean | null {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === null ? null : saved === 'true';
  } catch {
    return null;
  }
}

export function saveSidebarOpen(open: boolean) {
  try {
    localStorage.setItem(KEY, String(open));
  } catch {
    // ignore
  }
}
