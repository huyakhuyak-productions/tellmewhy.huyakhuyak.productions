// @vitest-environment happy-dom
// Hook pins for the chat column's "stick to bottom" behaviour. The column
// follows new content only while the reader is at (or near) the bottom;
// scrolling up releases the pin so a reply can stream underneath while they
// read; returning to the bottom, sending, or the jump affordance re-pins.
//
// happy-dom has no layout, so the container's scroll metrics are plain data
// properties the test drives by hand, and ResizeObserver is a controllable
// stub whose callbacks the test fires to stand in for content growth. Like a
// real browser, a programmatic `scrollTo` here does NOT fire a synchronous
// scroll event — the tests dispatch those explicitly, which is what lets them
// pin the coalescing race (see "a scroll-up that lands in the same frame").
import "../../test/component-setup";
import { createRef, StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStickToBottom } from "./use-stick-to-bottom";

type Observed = { callback: ResizeObserverCallback; targets: Element[] };
const observers: Observed[] = [];

class FakeResizeObserver {
  private readonly entry: Observed;
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: [] };
    observers.push(this.entry);
  }
  observe(target: Element) {
    this.entry.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.entry.targets = [];
  }
}

// Fire every live observer as if `target` changed size.
function resize(target: Element) {
  for (const o of observers) {
    if (!o.targets.includes(target)) continue;
    o.callback([{ target } as unknown as ResizeObserverEntry], o as unknown as ResizeObserver);
  }
}

// A scroll container with hand-driven metrics: 1000px of content in a 400px
// viewport. `scrollTo` writes scrollTop (instant) or leaves it for the test to
// step (smooth) and never dispatches a scroll event itself.
function makeContainer(scrollHeight = 1000, clientHeight = 400) {
  const el = document.createElement("div");
  const metrics = { scrollTop: 0, scrollHeight, clientHeight };
  Object.defineProperty(el, "scrollHeight", { get: () => metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { get: () => metrics.clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", {
    get: () => metrics.scrollTop,
    set: (v: number) => {
      metrics.scrollTop = v;
    },
    configurable: true,
  });
  const scrollTo = vi.fn((opts: ScrollToOptions) => {
    if (opts.behavior === "smooth") return;
    metrics.scrollTop = opts.top ?? 0;
  });
  el.scrollTo = scrollTo as unknown as typeof el.scrollTo;
  // The column lands at `top` and the browser reports it.
  const scrollEvent = (top: number) => {
    metrics.scrollTop = top;
    el.dispatchEvent(new Event("scroll"));
  };
  const wheel = (deltaY: number) => el.dispatchEvent(new WheelEvent("wheel", { deltaY }));
  const key = (key: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  const touch = (fromY: number, toY: number) => {
    el.dispatchEvent(new TouchEvent("touchstart", { touches: [{ clientY: fromY } as Touch] }));
    el.dispatchEvent(new TouchEvent("touchmove", { touches: [{ clientY: toY } as Touch] }));
  };
  const grow = (by: number) => {
    metrics.scrollHeight += by;
  };
  return { el, metrics, scrollTo, scrollEvent, wheel, key, touch, grow };
}

function setup(wrapper?: typeof StrictMode) {
  const c = makeContainer();
  const content = document.createElement("div");
  c.el.appendChild(content);
  document.body.appendChild(c.el);
  const containerRef = createRef<HTMLDivElement>();
  const contentRef = createRef<HTMLDivElement>();
  Object.assign(containerRef, { current: c.el });
  Object.assign(contentRef, { current: content });
  const hook = renderHook(
    ({ busy }: { busy: boolean }) => useStickToBottom({ containerRef, contentRef, busy }),
    { wrapper, initialProps: { busy: false } },
  );
  return { ...c, content, ...hook };
}

// The reader has scrolled well up: released, with the column 300px from the top.
function released() {
  const s = setup();
  act(() => s.scrollEvent(300));
  expect(s.result.current.pinned).toBe(false);
  s.scrollTo.mockClear();
  return s;
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("useStickToBottom — following", () => {
  it("lands at the bottom instantly on mount and is pinned", () => {
    const { result, scrollTo, metrics } = setup();
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" });
    expect(metrics.scrollTop).toBe(1000);
    expect(result.current.pinned).toBe(true);
    expect(result.current.showJump).toBe(false);
  });

  it("follows content growth instantly while pinned", () => {
    const { content, grow, scrollTo } = setup();
    scrollTo.mockClear();
    grow(120);
    act(() => resize(content));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1120, behavior: "auto" });
  });

  it("keeps the pin on a small nudge that stays inside the bottom band", () => {
    const { result, scrollEvent } = setup();
    act(() => scrollEvent(580)); // 20px from the bottom
    expect(result.current.pinned).toBe(true);
  });

  it("still follows after a StrictMode double-mount, with the first mount's observers gone", () => {
    const { content, grow, scrollTo } = setup(StrictMode);
    scrollTo.mockClear();
    grow(120);
    act(() => resize(content));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1120, behavior: "auto" });
    // The interleaved cleanup disconnected the first observer; only the
    // remount's is live.
    expect(observers.filter((o) => o.targets.length > 0)).toHaveLength(1);
  });
});

describe("useStickToBottom — releasing", () => {
  it("releases when the reader scrolls up past the band, and new content then offers the jump", () => {
    const { result, content, grow, scrollTo } = released();
    expect(result.current.showJump).toBe(false); // nothing new yet
    grow(120);
    act(() => resize(content));
    expect(scrollTo).not.toHaveBeenCalled(); // the column stays where the reader put it
    expect(result.current.showJump).toBe(true);
  });

  it("releases on an upward wheel tick even inside the band (a slow trackpad must not be fought)", () => {
    const { result, wheel, scrollEvent, content, grow, scrollTo } = setup();
    act(() => wheel(-5));
    act(() => scrollEvent(595)); // the tick's own 5px move, still inside the band
    expect(result.current.pinned).toBe(false);
    scrollTo.mockClear();
    grow(20);
    act(() => resize(content));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not release on a downward wheel tick", () => {
    const { result, wheel } = setup();
    act(() => wheel(5));
    expect(result.current.pinned).toBe(true);
  });

  it("releases when a finger drags the column down (touch scroll-up)", () => {
    const { result, touch } = setup();
    act(() => touch(100, 140));
    expect(result.current.pinned).toBe(false);
  });

  it("releases on an upward key press (ArrowUp moves less than the band, so intent must count)", () => {
    // A focused scroller, or a focused button inside it, scrolls on ArrowUp by
    // ~40px — inside the 48px band, where a scroll event alone never releases.
    const { result, key, scrollEvent, content, grow, scrollTo } = setup();
    act(() => key("ArrowUp"));
    act(() => scrollEvent(560));
    expect(result.current.pinned).toBe(false);
    scrollTo.mockClear();
    grow(20);
    act(() => resize(content));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("releases on PageUp, Home and Shift+Space, but not on downward keys", () => {
    for (const press of [() => ({ key: "PageUp" }), () => ({ key: "Home" }), () => ({ key: " ", shiftKey: true })]) {
      const { result, key } = setup();
      const { key: name, ...init } = press() as { key: string; shiftKey?: boolean };
      act(() => key(name, init));
      expect(result.current.pinned).toBe(false);
    }
    for (const name of ["ArrowDown", "PageDown", "End", " "]) {
      const { result, key } = setup();
      act(() => key(name));
      expect(result.current.pinned).toBe(true);
    }
  });

  it("ignores upward keys and wheel ticks when the column does not overflow", () => {
    const { result, key, wheel, metrics } = setup();
    metrics.scrollHeight = 400; // everything fits: nothing to scroll away from
    act(() => key("ArrowUp"));
    act(() => wheel(-5));
    expect(result.current.pinned).toBe(true);
  });

  it("releases on a scroll-up that lands in the same frame as a big follow", () => {
    // A 600px chunk lands; the follow scrolls to the new bottom, but the
    // browser has not fired its (coalesced) scroll event yet when a wheel tick
    // moves the column 100px up. The one scroll event that follows must read
    // as an upward move against the follow's position, not the stale one.
    const { result, content, grow, scrollEvent } = setup();
    grow(600);
    act(() => resize(content)); // scrollTop is now 1200, silently
    act(() => scrollEvent(1100));
    expect(result.current.pinned).toBe(false);
  });

  it("releases on a scroll-up during the jump's own glide (the reader's intent wins)", () => {
    const { result, content, grow, scrollEvent } = released();
    grow(120);
    act(() => resize(content));
    act(() => result.current.jumpToLatest());
    expect(result.current.pinned).toBe(true);
    act(() => scrollEvent(450)); // gliding down…
    act(() => scrollEvent(600));
    expect(result.current.pinned).toBe(true);
    act(() => scrollEvent(400)); // …then the reader wheels back up
    expect(result.current.pinned).toBe(false);
  });
});

describe("useStickToBottom — the jump offer", () => {
  it("ignores container resizes for the offer (only content counts)", () => {
    const { result, el } = released();
    act(() => resize(el));
    expect(result.current.showJump).toBe(false);
  });

  it("does not offer the jump when only the container reports a resize while the height grew", () => {
    // The composer autosizing taller can coincide with a height change the
    // observer attributes to the container alone; that is not new content.
    const { result, el, grow } = released();
    grow(120);
    act(() => resize(el));
    expect(result.current.showJump).toBe(false);
  });

  it("does not offer the jump when the content shrinks (a failed send, a stopped reply)", () => {
    const { result, content, metrics } = released();
    metrics.scrollHeight -= 200;
    act(() => resize(content));
    expect(result.current.showJump).toBe(false);
  });

  it("offers the jump as soon as a reply is in flight below a released reader", () => {
    // A reply's words can land on an unwrapped line — no height change for a
    // ResizeObserver to see — so the transport's busy state is the signal.
    const { result, rerender, scrollEvent } = setup();
    rerender({ busy: true });
    expect(result.current.showJump).toBe(false); // pinned: still following
    act(() => scrollEvent(300));
    expect(result.current.showJump).toBe(true);
  });

  it("offers the jump when a reply starts after the reader already scrolled up", () => {
    const { result, rerender } = released();
    expect(result.current.showJump).toBe(false); // idle conversation: nothing new below
    rerender({ busy: true });
    expect(result.current.showJump).toBe(true);
  });
});

describe("useStickToBottom — re-pinning", () => {
  it("re-pins and clears the offer once the reader scrolls back down near the bottom", () => {
    const { result, content, grow, scrollEvent } = released();
    grow(120);
    act(() => resize(content));
    expect(result.current.showJump).toBe(true);
    act(() => scrollEvent(690)); // 1120 - 400 - 690 = 30px from the bottom, moving down
    expect(result.current.pinned).toBe(true);
    expect(result.current.showJump).toBe(false);
  });

  it("re-pins when the browser clamps a released reader onto the bottom after a shrink", () => {
    const { result, metrics, scrollEvent } = released();
    metrics.scrollHeight = 500; // the column is now 100px of scroll room
    act(() => scrollEvent(100)); // clamped: exactly at the bottom, though "moving up"
    expect(result.current.pinned).toBe(true);
  });

  it("treats a sub-pixel distance as the bottom (zoomed or HiDPI scroll metrics are fractional)", () => {
    const { result, metrics, scrollEvent } = released();
    metrics.scrollHeight = 500;
    act(() => scrollEvent(99.5)); // 500 - 99.5 - 400 = 0.5px: the browser's idea of "at the bottom"
    expect(result.current.pinned).toBe(true);
  });

  it("jumpToLatest glides to the bottom and re-pins", () => {
    const { result, scrollTo, content, grow } = released();
    grow(120);
    act(() => resize(content));
    scrollTo.mockClear();
    act(() => result.current.jumpToLatest());
    expect(scrollTo).toHaveBeenCalledWith({ top: 1120, behavior: "smooth" });
    expect(result.current.pinned).toBe(true);
    expect(result.current.showJump).toBe(false);
  });

  it("keeps gliding when words land mid-jump, and snaps again once the glide has ended", () => {
    const { result, scrollTo, content, grow, el } = released();
    act(() => result.current.jumpToLatest());
    scrollTo.mockClear();
    grow(40);
    act(() => resize(content));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1040, behavior: "smooth" });
    act(() => el.dispatchEvent(new Event("scrollend")));
    grow(40);
    act(() => resize(content));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1080, behavior: "auto" });
  });

  it("uses an instant jump under prefers-reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList,
    );
    const { result, scrollTo } = released();
    act(() => result.current.jumpToLatest());
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" });
  });

  it("pin() forces the pin and lands at the bottom instantly (the reader's own send)", () => {
    const { result, scrollTo } = released();
    act(() => result.current.pin());
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" });
    expect(result.current.pinned).toBe(true);
  });
});

describe("useStickToBottom — teardown", () => {
  it("disconnects its observers and listeners on unmount", () => {
    const { unmount, content, grow, scrollTo, scrollEvent, wheel, key, result } = setup();
    unmount();
    scrollTo.mockClear();
    grow(120);
    resize(content);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(observers.every((o) => o.targets.length === 0)).toBe(true);
    scrollEvent(300);
    wheel(-5);
    key("ArrowUp");
    expect(result.current.pinned).toBe(true); // no listener left to flip it
  });
});
