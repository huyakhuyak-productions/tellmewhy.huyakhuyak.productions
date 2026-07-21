// @vitest-environment happy-dom
// Hook pins for the client-side auto-title watcher (extracted from
// chat-screen.tsx). The watcher arms once the session's first exchange settles,
// polls GET /api/conversations for the fire-and-forget rename, and refreshes
// once it lands. The split-effect design (arm-once effect + mount-scoped
// cancellation) exists to keep a fast follow-up send from killing the poll —
// the historical bug pinned executably below for the first time.
import "../../test/component-setup";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTitleWatcher } from "./use-title-watcher";

type Row = { id: string; title: string };
const fetchMock = vi.fn();

// A minimal Response carrying the conversation list the watcher reads.
function jsonRes(list: Row[]): Response {
  return { ok: true, json: async () => list } as unknown as Response;
}

// Advance timers AND flush the fetch → json microtask chain the watcher awaits.
function flush(ms = 0) {
  return vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const base = {
  conversationId: "c1",
  conversations: [{ id: "c1", title: "Untitled" }] as Row[],
  initialMessageCount: 1,
  messageCount: 2,
  status: "ready",
};

describe("useTitleWatcher", () => {
  it("arms and refreshes once the polled title changes", async () => {
    const refresh = vi.fn();
    fetchMock
      .mockResolvedValueOnce(jsonRes([{ id: "c1", title: "Untitled" }])) // baseline
      .mockResolvedValueOnce(jsonRes([{ id: "c1", title: "Renamed" }])); // poll #1

    renderHook(() => useTitleWatcher({ ...base, refresh }));

    // Baseline matches what the rail shows → no immediate refresh; poll armed.
    await flush();
    expect(refresh).not.toHaveBeenCalled();

    // The rename lands on the first poll tick.
    await flush(1500);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT arm before the first exchange settles", async () => {
    const refresh = vi.fn();
    // Only one message (no AI reply yet) — the watcher must stay dormant.
    renderHook(() => useTitleWatcher({ ...base, messageCount: 1, refresh }));
    await flush(1500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the running poll alive across a fast follow-up send", async () => {
    // The historical bug: a second send before the poll finished re-ran the
    // arming effect, whose (old) cleanup cancelled the in-flight timer, and the
    // arm-once guard then blocked any restart — killing the watcher for good.
    const refresh = vi.fn();
    fetchMock
      .mockResolvedValueOnce(jsonRes([{ id: "c1", title: "Untitled" }])) // baseline
      .mockResolvedValueOnce(jsonRes([{ id: "c1", title: "Renamed" }])); // poll #1

    const { rerender } = renderHook((props) => useTitleWatcher(props), {
      initialProps: { ...base, refresh },
    });
    await flush(); // baseline resolved → poll scheduled

    // A fast follow-up send: the thread grows, re-running the arming effect.
    rerender({ ...base, messageCount: 3, refresh });

    // The poll survives the re-arm re-run and still delivers the rename.
    await flush(1500);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("re-arms after a StrictMode double-mount", async () => {
    // Dev StrictMode mounts, unmounts, then remounts the SAME instance — its
    // refs persist. The mount-scoped cleanup must reset the arm-once guard, or
    // the second mount early-returns forever and the watcher never arms (the
    // first mount's poll was already cancelled by the interleaved cleanup).
    const refresh = vi.fn();
    fetchMock
      .mockResolvedValueOnce(jsonRes([{ id: "c1", title: "Untitled" }])) // 1st mount (cancelled)
      .mockResolvedValueOnce(jsonRes([{ id: "c1", title: "Untitled" }])) // re-arm baseline
      .mockResolvedValueOnce(jsonRes([{ id: "c1", title: "Renamed" }])); // re-arm poll

    renderHook(() => useTitleWatcher({ ...base, refresh }), { wrapper: StrictMode });

    await flush();
    await flush(1500);
    // The re-armed poll delivers the rename — proof the guard was reset.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("cancels the poll on unmount", async () => {
    const refresh = vi.fn();
    fetchMock.mockResolvedValue(jsonRes([{ id: "c1", title: "Untitled" }]));

    const { unmount } = renderHook(() => useTitleWatcher({ ...base, refresh }));
    await flush(); // baseline resolved → poll scheduled

    unmount();
    fetchMock.mockClear();

    await flush(1500);
    // The poll tick short-circuits on the cancelled flag before fetching.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
