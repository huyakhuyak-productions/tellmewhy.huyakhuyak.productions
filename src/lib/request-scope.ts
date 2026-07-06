import { AsyncLocalStorage } from "node:async_hooks";

type Scope = Map<string, Promise<unknown>>;

const storage = new AsyncLocalStorage<Scope>();

// Route handlers aren't part of React's render lifecycle, so React's own
// `cache()` never dedupes here — empirically it's a no-op outside an active
// render (confirmed by reading react.development.js's `exports.cache`, which
// falls back to a bare `fn.apply` when there's no dispatcher, and by running
// it directly: three identical calls outside a render produced three real
// invocations, zero cache hits). AsyncLocalStorage gives per-request scoping
// without that gap.

/**
 * Runs `fn` inside a fresh, isolated request scope. The scope follows the
 * async context, so it deliberately survives into detached continuations the
 * request spawns (e.g. a streaming route's onFinish work) — but nothing
 * survives to the NEXT request, and no other concurrent scope can see it.
 * This is the point: callers that hold secrets (e.g. a decrypted key) must
 * never leak them across requests via a shared, longer-lived cache.
 */
export function withRequestScope<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(new Map(), fn);
}

/**
 * Per-request memoization keyed by an arbitrary string. Outside of a
 * `withRequestScope` call there is no scope to store anything in, so
 * `compute` always runs fresh — that's a deliberate fail-safe, not a bug:
 * it means code that forgets to wrap itself in a scope simply loses the perf
 * win instead of silently sharing state with unrelated calls.
 */
export function scopedMemo<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const scope = storage.getStore();
  if (!scope) return compute();

  const existing = scope.get(key);
  if (existing) return existing as Promise<T>;

  const promise = compute();
  // A rejected compute must not poison the scope for the rest of the
  // request — remove it so a later call in the same scope can retry fresh.
  promise.catch(() => scope.delete(key));
  scope.set(key, promise);
  return promise;
}
