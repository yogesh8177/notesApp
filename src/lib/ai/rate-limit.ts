const WINDOW_MS = 60_000;
const MAX_TOKENS = 5;
const REFILL_PER_MS = MAX_TOKENS / WINDOW_MS;

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

const globalForRateLimit = globalThis as typeof globalThis & {
  __summaryRateLimit?: Map<string, BucketState>;
};

const buckets = globalForRateLimit.__summaryRateLimit ?? new Map<string, BucketState>();

if (!globalForRateLimit.__summaryRateLimit) {
  globalForRateLimit.__summaryRateLimit = buckets;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function consumeSummaryToken(
  userId: string,
  nowMs: number = Date.now(),
): RateLimitResult {
  const current = buckets.get(userId) ?? {
    tokens: MAX_TOKENS,
    lastRefillMs: nowMs,
  };

  const elapsed = Math.max(0, nowMs - current.lastRefillMs);
  const refilledTokens = Math.min(MAX_TOKENS, current.tokens + elapsed * REFILL_PER_MS);

  if (refilledTokens < 1) {
    const retryAfterMs = Math.ceil((1 - refilledTokens) / REFILL_PER_MS);
    buckets.set(userId, {
      tokens: refilledTokens,
      lastRefillMs: nowMs,
    });
    return {
      ok: false,
      remaining: 0,
      retryAfterMs,
    };
  }

  const nextTokens = refilledTokens - 1;
  buckets.set(userId, {
    tokens: nextTokens,
    lastRefillMs: nowMs,
  });

  return {
    ok: true,
    remaining: Math.floor(nextTokens),
    retryAfterMs: 0,
  };
}
