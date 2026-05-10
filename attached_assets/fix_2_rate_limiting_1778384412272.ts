// =============================================================================
// FILE: /lib/rate-limit.ts
// In-memory rate limiter for the SMS inbound endpoint.
// Limits per sender phone number — not per IP, since Telnyx proxies requests.
//
// Limits (adjust as needed):
// - 20 messages per phone number per 10 minutes
// - If exceeded: returns 429, logs the number, sends no reply
//
// NOTE: This is in-memory, which means it resets on server restart and
// does not share state across multiple instances. Good enough for a single
// server. If you scale to multiple instances, replace with Redis.
// =============================================================================

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 20;           // per window per number

// Clean up expired entries every 30 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > WINDOW_MS) {
      store.delete(key);
    }
  }
}, 30 * 60 * 1000);

export function checkRateLimit(identifier: string): {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
} {
  const now = Date.now();
  const entry = store.get(identifier);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // New window
    store.set(identifier, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetInMs: WINDOW_MS };
  }

  if (entry.count >= MAX_REQUESTS) {
    const resetInMs = WINDOW_MS - (now - entry.windowStart);
    console.warn(`[RATE_LIMIT] ${identifier} exceeded limit — ${entry.count} messages in window`);
    return { allowed: false, remaining: 0, resetInMs };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: MAX_REQUESTS - entry.count,
    resetInMs: WINDOW_MS - (now - entry.windowStart),
  };
}


// =============================================================================
// USAGE: Add these lines to /app/api/sms/inbound/route.ts
// immediately after signature verification passes (after step 2).
//
// import { checkRateLimit } from '@/lib/rate-limit';
//
// const rateLimit = checkRateLimit(fromNumber);
// if (!rateLimit.allowed) {
//   console.warn(`[SMS_INBOUND] Rate limit exceeded for ${fromNumber}`);
//   return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
// }
//
// That's it. The check happens before any DB query or API call.
// =============================================================================
