/**
 * Watchlist storage — localStorage-backed with a subscription pattern so
 * star buttons, nav badges, and the watchlist page all stay in sync when
 * the list changes.
 *
 * SSR-safe: every function guards against `window` being undefined. On the
 * server we just return an empty list.
 *
 * Storage shape (v1):
 *   key:   "bioradar.watchlist"
 *   value: JSON string array of tickers, uppercase.
 *          e.g. '["AMGN","CRSP","BEAM"]'
 */

const KEY = "bioradar.watchlist";

// In-browser event target so React components can subscribe to changes
// without reaching for a full state library. Also listens to the `storage`
// event from other tabs for cross-tab sync.
type Listener = (tickers: string[]) => void;
const listeners = new Set<Listener>();

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readRaw(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Normalize — uppercase, dedupe, drop non-strings.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of parsed) {
      if (typeof t !== "string") continue;
      const up = t.toUpperCase().trim();
      if (!up || seen.has(up)) continue;
      seen.add(up);
      out.push(up);
    }
    return out;
  } catch {
    return [];
  }
}

function writeRaw(tickers: string[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(tickers));
  } catch {
    // Quota / privacy mode — swallow. Watchlist just won't persist this session.
  }
}

function emit(tickers: string[]) {
  for (const l of listeners) {
    try {
      l(tickers);
    } catch {
      // Don't let one broken listener blow up the rest.
    }
  }
}

/**
 * Get the current watchlist, oldest-first (order = insertion order).
 */
export function getWatchlist(): string[] {
  return readRaw();
}

/**
 * True if the given ticker is in the watchlist.
 */
export function isWatching(ticker: string): boolean {
  if (!ticker) return false;
  const up = ticker.toUpperCase().trim();
  return readRaw().includes(up);
}

/**
 * Add a ticker to the watchlist. No-op if already present.
 * Returns the new watchlist.
 */
export function addToWatchlist(ticker: string): string[] {
  const up = ticker.toUpperCase().trim();
  if (!up) return readRaw();
  const current = readRaw();
  if (current.includes(up)) return current;
  const next = [...current, up];
  writeRaw(next);
  emit(next);
  return next;
}

/**
 * Remove a ticker from the watchlist. No-op if not present.
 * Returns the new watchlist.
 */
export function removeFromWatchlist(ticker: string): string[] {
  const up = ticker.toUpperCase().trim();
  const current = readRaw();
  if (!current.includes(up)) return current;
  const next = current.filter((t) => t !== up);
  writeRaw(next);
  emit(next);
  return next;
}

/**
 * Toggle a ticker's watched state. Returns `true` if the ticker is now
 * watched, `false` if it was removed.
 */
export function toggleWatchlist(ticker: string): boolean {
  if (isWatching(ticker)) {
    removeFromWatchlist(ticker);
    return false;
  }
  addToWatchlist(ticker);
  return true;
}

/**
 * Subscribe to watchlist changes. Fires on add/remove in this tab AND on
 * cross-tab changes via the `storage` event. Returns an unsubscribe fn.
 */
export function subscribeWatchlist(listener: Listener): () => void {
  listeners.add(listener);
  if (isBrowser() && listeners.size === 1) {
    // Hook the cross-tab `storage` event the first time someone subscribes.
    window.addEventListener("storage", handleStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (isBrowser() && listeners.size === 0) {
      window.removeEventListener("storage", handleStorageEvent);
    }
  };
}

function handleStorageEvent(e: StorageEvent) {
  if (e.key !== KEY) return;
  emit(readRaw());
}
