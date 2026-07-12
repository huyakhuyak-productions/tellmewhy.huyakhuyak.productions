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

// Separate instance, own bucket namespace, keyed by the initiating userId —
// invite tokens are a resource (each one is a live credential that grants a
// therapist link), so creating them gets its own small, tighter bucket
// rather than sharing the conversation-create one.
export const inviteCreateRateLimiter = new RateLimiter({ capacity: 5, refillWindowMs: 5 * 60 * 1000 });

// Therapist interventions and notes reach the client's chat directly; keyed by therapistId.
export const therapistWriteRateLimiter = new RateLimiter({ capacity: 20, refillWindowMs: 5 * 60 * 1000 });

// Mood check-ins, keyed by the client's userId. A repeat check-in on the same
// day just overwrites (see checkInMood), so this bucket exists to blunt a
// runaway client or scripted loop, not to cap legitimate use — hence a
// generous ceiling on its own namespace, isolated from the other limiters.
export const moodRateLimiter = new RateLimiter({ capacity: 10, refillWindowMs: 5 * 60 * 1000 });

// Thought-record entry saves, keyed by the client's userId. Each save writes a
// new encrypted row, so unlike mood these accumulate — its own small bucket
// stops a runaway client from flooding entries, kept apart from moodRateLimiter
// so draining one never throttles the other.
export const entryRateLimiter = new RateLimiter({ capacity: 10, refillWindowMs: 5 * 60 * 1000 });

// Self-note writes (hand-written or kept-from-chat), keyed by the owner's
// userId. Each create writes a new encrypted row, so these accumulate — its
// own small bucket blunts a runaway client or scripted keep loop, kept apart
// from entryRateLimiter so draining one never throttles the other.
export const noteRateLimiter = new RateLimiter({ capacity: 10, refillWindowMs: 5 * 60 * 1000 });

// Session-digest reads, keyed by the therapistId. Reading a client's digest is
// cheap and a therapist may reopen a desk often, so the ceiling is generous —
// this only blunts a script hammering the endpoint (each miss can trigger an AI
// regeneration), never normal review. Its own namespace, isolated from the
// therapist-write bucket so reading never eats into interventions or notes.
export const digestReadRateLimiter = new RateLimiter({ capacity: 30, refillWindowMs: 5 * 60 * 1000 });
