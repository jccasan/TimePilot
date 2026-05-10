const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 20;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > WINDOW_MS) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

export function checkRateLimit(identifier: string): {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
} {
  const now = Date.now();
  const entry = store.get(identifier);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(identifier, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetInMs: WINDOW_MS };
  }

  if (entry.count >= MAX_REQUESTS) {
    const resetInMs = WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, remaining: 0, resetInMs };
  }

  entry.count++;
  const resetInMs = WINDOW_MS - (now - entry.windowStart);
  return { allowed: true, remaining: MAX_REQUESTS - entry.count, resetInMs };
}
