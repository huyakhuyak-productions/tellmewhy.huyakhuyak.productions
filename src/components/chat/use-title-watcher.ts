"use client";

import { useEffect, useRef } from "react";

// The bare minimum this hook reads off each conversation to spot a title change.
type TitledConversation = { id: string; title: string };

// Watch for the auto-title that lands server-side some time after the stream
// closes (a fire-and-forget classify+rename call — see /api/chat). Rather than
// hold the response stream open (which would keep the composer disabled), watch
// for it client-side: once THIS session's first exchange finishes, poll
// GET /api/conversations for a title change and refresh exactly once.
//
// The caller owns the reactive inputs (message counts, status, the conversation
// list) and hands us `refresh` (router.refresh); we own the poll's lifetime and
// the arm-once guard. Split across two coupled effects on purpose — see each.
export function useTitleWatcher({
  conversationId,
  conversations,
  initialMessageCount,
  messageCount,
  status,
  refresh,
}: {
  conversationId: string;
  conversations: readonly TitledConversation[];
  /** How many messages the server render carried — > 1 means this isn't the
      session's first exchange, so there's no fresh title to wait for. */
  initialMessageCount: number;
  /** The live SDK thread length — the second entry is the first AI reply. */
  messageCount: number;
  status: string;
  refresh: () => void;
}) {
  const titleWatchStarted = useRef(false);
  // Owns the running poll's lifetime (timers + fetch loop) once armed below.
  // Cancelled ONLY by the mount-scoped unmount effect, never by re-runs of
  // the arming effect — see both effects for why that split matters.
  const titleWatchControllerRef = useRef<{ cancel: () => void } | null>(null);

  // The rail/home re-render (and hand this hook a brand-new `conversations`
  // array) on every `router.refresh()` — including ones triggered by DnD,
  // rename, or folder actions on OTHER rows that have nothing to do with this
  // conversation. The title watcher below must survive those refreshes, so it
  // reads `conversations` through this ref instead of depending on the prop
  // directly (see the effect for why). The sync happens in its own effect
  // (declared ahead of the watcher, so it always commits first) rather than
  // inline during render, since refs must not be written while rendering
  // (react-hooks/refs).
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  });

  // ARMING is the only thing this effect reacts to — it must NOT own the
  // poll's cancellation. It used to: the poll's timers were cleared by this
  // effect's own cleanup, which runs on every re-run, including the one
  // triggered by a fast follow-up send (`messageCount`/`status` are both
  // deps, so sending a second message before the poll finished re-ran this
  // effect, whose cleanup cancelled the in-flight timer — then the
  // `titleWatchStarted` guard immediately blocked any restart, killing the
  // watcher for good). Now this effect only ever arms once (guarded below)
  // and stashes a cancel() for the poll in a ref; the poll's actual lifetime
  // is owned by the mount-scoped effect further down, whose cleanup fires
  // ONLY on unmount.
  useEffect(() => {
    if (titleWatchStarted.current) return;
    if (initialMessageCount > 1) return;
    if (messageCount < 2 || status !== "ready") return;
    titleWatchStarted.current = true;

    // What the rail/home are currently showing for this conversation (from
    // the server render before this exchange). A fast rename can land before
    // this effect even gets to run its own baseline fetch below — in that
    // case the "baseline" would already be the new title and would never
    // appear to change on its own, so this is the reference a real change
    // must diverge from. Read via the ref, not the `conversations` prop
    // directly: this effect intentionally does NOT depend on `conversations`
    // (see below), so the prop binding here would otherwise be stale.
    const displayedTitle = conversationsRef.current.find(
      (c) => c.id === conversationId,
    )?.title;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    titleWatchControllerRef.current = {
      cancel: () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      },
    };

    async function currentTitle(): Promise<string | undefined> {
      try {
        const res = await fetch("/api/conversations");
        if (!res.ok) return undefined;
        const list = (await res.json()) as { id: string; title: string }[];
        return list.find((c) => c.id === conversationId)?.title;
      } catch {
        return undefined;
      }
    }

    function poll(baseline: string | undefined, attempt: number) {
      timer = setTimeout(async () => {
        if (cancelled) return;
        const latest = await currentTitle();
        if (cancelled) return;
        if (latest !== undefined && latest !== baseline) {
          refresh();
          return;
        }
        if (attempt < 6) poll(baseline, attempt + 1);
      }, 1500);
    }

    void (async () => {
      const baseline = await currentTitle();
      if (cancelled) return;
      if (baseline !== undefined && baseline !== displayedTitle) {
        refresh();
        return;
      }
      poll(baseline, 1);
    })();

    // Deliberately no cleanup returned here — see the mount-scoped effect
    // below, which owns cancellation instead.
    // `conversations` is deliberately excluded from the deps below: the rail
    // hands us a fresh array identity on every `router.refresh()` (including
    // refreshes from unrelated rows — a drag, rename, or folder move
    // elsewhere), which would re-run this effect on every such refresh. A
    // re-run is now harmless (the `titleWatchStarted` guard just returns
    // early), but there is still no reason to depend on a prop this effect
    // never reads directly — read the latest value via `conversationsRef`
    // instead (exhaustive-deps doesn't flag this: the ref read isn't a
    // reactive dependency).
  }, [initialMessageCount, messageCount, status, conversationId, refresh]);

  // Owns the title poll's cancellation. Mount-scoped ([] deps) on purpose:
  // this cleanup must run ONLY when the host actually unmounts (navigating
  // away mid-poll) — never when the arming effect above re-runs. That split
  // is the fix for the fast-follow-up-send bug described there: the poll's
  // lifetime is no longer coupled to `messageCount`/`status` churn.
  useEffect(() => {
    return () => {
      titleWatchControllerRef.current?.cancel();
      // Re-arm on a genuine remount. A dev StrictMode double-mount reuses the
      // SAME instance (refs persist), so without this reset the arm-once guard
      // would still read `true` after the interleaved cleanup and the second
      // mount would early-return forever — leaving the watcher permanently
      // dead. Pairs with cancel above: the first mount's poll is torn down and
      // the guard cleared, so the second mount arms a fresh one.
      titleWatchStarted.current = false;
    };
  }, []);
}
