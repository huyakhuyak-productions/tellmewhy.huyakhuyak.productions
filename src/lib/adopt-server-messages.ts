// Decide whether the on-screen thread must adopt the server's active path.
//
// ChatScreen's useChat Chat instance is created once and survives every
// `router.refresh()` — its `messages:` option is an initial seed only, so new
// server props (a switched branch, a settled edit gaining real ids) never reach
// the rendered SDK state on their own. This pure predicate compares the ordered
// id lists so the component can re-seed exactly when — and only when — they
// diverge. Keep it dumb and total: it looks at ids and order, nothing else, and
// adopting makes the lists equal, so it can never loop.
export function shouldAdoptServerMessages(
  localIds: string[],
  serverIds: string[],
): boolean {
  if (localIds.length !== serverIds.length) return true;
  return localIds.some((id, i) => id !== serverIds[i]);
}
