const DEFAULT_CAPACITY = 20;
const DEFAULT_REFILL_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

interface RateLimiterOptions {
  /** Max tokens (= max requests) a bucket can hold. */
  capacity?: number;
  /** Time to go from empty to full under continuous refill. */
  refillWindowMs?: number;
  /** Injectable clock so tests are deterministic — no real-time sleeps. */
  now?: () => number;
}

// In-memory per-key token bucket. Tokens refill continuously (not in a lump
// sum per window), so a caller who spaces out requests never gets throttled
// even near a window boundary.
//
// Limitation: state lives in process memory only. It resets on restart and,
// on a horizontally-scaled or serverless deployment, each instance keeps its
// own buckets — the effective limit becomes (instances × capacity) rather
// than a single global ceiling. Acceptable for this app's single-instance
// deployment; move to a shared store (e.g. Redis) before scaling out.
export class RateLimiter {
  private readonly capacity: number;
  private readonly refillWindowMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimiterOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.refillWindowMs = options.refillWindowMs ?? DEFAULT_REFILL_WINDOW_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** Attempts to consume one token for `key`. Returns whether it was allowed. */
  consume(key: string): boolean {
    const now = this.now();
    const refillRatePerMs = this.capacity / this.refillWindowMs;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillAt: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsedMs = Math.max(0, now - bucket.lastRefillAt);
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedMs * refillRatePerMs);
      bucket.lastRefillAt = now;
    }

    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}

// Single shared instance used by the chat route (see the in-memory
// limitation documented on the class above).
const chatRateLimiter = new RateLimiter();
export default chatRateLimiter;

// Separate instance (own bucket namespace, keyed by userId) for conversation
// creation — generous enough for real use, just enough to stop orphan
// conversations piling up from a runaway client or a scripted retry loop.
// Kept apart from chatRateLimiter so exhausting one never throttles the other.
export const conversationCreateRateLimiter = new RateLimiter({ capacity: 10, refillWindowMs: 5 * 60 * 1000 });
