import { describe, it, expect, beforeEach } from "vitest";
import { consumeSummaryToken } from "@/lib/ai/rate-limit";

// The module holds a reference to a Map on globalThis. Clearing that Map between
// tests is enough — no module reset needed because consumeSummaryToken takes `nowMs`.
beforeEach(() => {
  (globalThis as unknown as Record<string, Map<string, unknown> | undefined>).__summaryRateLimit?.clear();
});

describe("consumeSummaryToken", () => {
  const USER = "user-1";
  const NOW = 1_000_000;
  const WINDOW = 60_000;

  it("allows the first 5 requests in the same window", () => {
    for (let i = 0; i < 5; i++) {
      const r = consumeSummaryToken(USER, NOW);
      expect(r.ok).toBe(true);
    }
  });

  it("blocks the 6th request within the same window", () => {
    for (let i = 0; i < 5; i++) consumeSummaryToken(USER, NOW);
    const r = consumeSummaryToken(USER, NOW);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it("remaining decrements with each successful request", () => {
    const first = consumeSummaryToken(USER, NOW);
    expect(first.remaining).toBe(4);
    const second = consumeSummaryToken(USER, NOW);
    expect(second.remaining).toBe(3);
  });

  it("refills tokens after a full window elapses", () => {
    // Exhaust the bucket.
    for (let i = 0; i < 5; i++) consumeSummaryToken(USER, NOW);
    expect(consumeSummaryToken(USER, NOW).ok).toBe(false);

    // Advance time by one full window — should be refilled back to max.
    const r = consumeSummaryToken(USER, NOW + WINDOW);
    expect(r.ok).toBe(true);
  });

  it("partially refills after half a window", () => {
    // Use 4 of 5 tokens.
    for (let i = 0; i < 4; i++) consumeSummaryToken(USER, NOW);
    // After half a window ~2.5 tokens refill — total ~3.5, so at least 1 ok.
    const r = consumeSummaryToken(USER, NOW + WINDOW / 2);
    expect(r.ok).toBe(true);
  });

  it("rate-limits users independently", () => {
    for (let i = 0; i < 5; i++) consumeSummaryToken("alice", NOW);
    // alice is exhausted, bob should still be fine
    expect(consumeSummaryToken("alice", NOW).ok).toBe(false);
    expect(consumeSummaryToken("bob", NOW).ok).toBe(true);
  });
});
