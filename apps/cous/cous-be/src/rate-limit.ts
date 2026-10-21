/**
 * A fixed-window counter for each key (an IP address). `allow` returns
 * false when the key used all of its `limit` requests in the current window.
 * The counters are in memory, so a restart clears them.
 */
const createRateLimiter = (limit: number, windowMs: number) => {
  const windows = new Map<string, { start: number; count: number }>();

  const allow = (key: string, now = Date.now()): boolean => {
    const entry = windows.get(key);
    if (!entry || now - entry.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      // Remove old windows, so the map does not grow without limit.
      if (windows.size > 10_000) {
        for (const [k, w] of windows) {
          if (now - w.start >= windowMs) windows.delete(k);
        }
      }
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count += 1;
    return true;
  };

  return { allow };
};

export { createRateLimiter };
