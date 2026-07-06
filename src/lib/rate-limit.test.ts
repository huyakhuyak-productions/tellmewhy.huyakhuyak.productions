import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

// A manually-advanced clock keeps every assertion below deterministic — no
// real-time sleeps, no flakiness under load.
function fakeClock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("RateLimiter", () => {
  it("allows requests up to capacity, then denies", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ capacity: 3, refillWindowMs: 5 * 60 * 1000, now: clock.now });
    expect(limiter.consume("u1")).toBe(true);
    expect(limiter.consume("u1")).toBe(true);
    expect(limiter.consume("u1")).toBe(true);
    expect(limiter.consume("u1")).toBe(false);
  });

  it("refills continuously as time passes, not in a single burst", () => {
    const clock = fakeClock();
    // 2 tokens per 1000ms == 1 token every 500ms.
    const limiter = new RateLimiter({ capacity: 2, refillWindowMs: 1000, now: clock.now });
    expect(limiter.consume("u1")).toBe(true);
    expect(limiter.consume("u1")).toBe(true);
    expect(limiter.consume("u1")).toBe(false);

    clock.advance(499);
    expect(limiter.consume("u1")).toBe(false); // not quite a full token yet

    clock.advance(1);
    expect(limiter.consume("u1")).toBe(true); // exactly one token refilled
    expect(limiter.consume("u1")).toBe(false);
  });

  it("never refills past capacity even after a long idle period", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ capacity: 2, refillWindowMs: 1000, now: clock.now });
    limiter.consume("u1");
    limiter.consume("u1");
    clock.advance(60 * 60 * 1000); // an hour of idle time
    expect(limiter.consume("u1")).toBe(true);
    expect(limiter.consume("u1")).toBe(true);
    expect(limiter.consume("u1")).toBe(false);
  });

  it("tracks a separate bucket per key", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ capacity: 1, refillWindowMs: 1000, now: clock.now });
    expect(limiter.consume("a")).toBe(true);
    expect(limiter.consume("a")).toBe(false);
    expect(limiter.consume("b")).toBe(true);
  });

  it("defaults to 20 requests per 5 minutes and a real clock", () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 20; i++) expect(limiter.consume("default-user")).toBe(true);
    expect(limiter.consume("default-user")).toBe(false);
  });
});
