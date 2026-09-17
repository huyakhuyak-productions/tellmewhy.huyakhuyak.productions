"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

// How close to the bottom (in px) still counts as "reading the newest words":
// the band in which scrolling back DOWN re-engages the follow. Scrolling up
// is read from intent (a wheel tick, a finger drag, an upward scroll event),
// not from this band, so a slow trackpad is never fought by the next follow.
const PIN_THRESHOLD_PX = 48;

// A finger has to travel this far before a touch reads as a deliberate drag.
const TOUCH_DEAD_ZONE_PX = 4;

function distanceFromBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Keep the newest words in view while the reader is at the bottom of the
// column, and let go the moment they scroll up — a streaming reply then grows
// underneath them instead of yanking the viewport back on every token.
//
// The follow is driven by content SIZE (a ResizeObserver on the message
// wrapper), not by the message array: `useChat` mints a fresh array per text
// delta, and re-scrolling smoothly on each one is exactly the jitter this
// replaces. Instant scrolls per growth step are imperceptible (a few px each)
// and never fight the reader's own gesture.
//
// Releasing is read from intent, ahead of the scroll it causes: an upward
// wheel tick, a finger dragging the column down, or an upward key press. Each
// can move less than the bottom band, where a scroll event alone says nothing.
//
// Re-pinning happens three ways, all explicit reader intent: scrolling back
// down into the bottom band, `pin()` on their own send, or `jumpToLatest()`
// from the affordance the caller shows off `showJump`.
//
// `showJump` is derived, never stored: released AND (the content grew since
// the release OR a reply is in flight). Both sources are needed because size
// alone is blind to a reply whose words keep landing on one unwrapped line.
export function useStickToBottom({
  containerRef,
  contentRef,
  busy,
}: {
  /** The `overflow-y-auto` element that actually scrolls. */
  containerRef: RefObject<HTMLElement | null>;
  /** The element whose size tracks the messages; its growth is "new content". */
  contentRef: RefObject<HTMLElement | null>;
  /** A reply is arriving (the transport is submitted or streaming). */
  busy: boolean;
}) {
  const [pinned, setPinned] = useState(true);
  // The content grew while released — something new sits below the reader.
  const [grewBelow, setGrewBelow] = useState(false);
  // Mirrors `pinned` for the DOM handlers, which run outside React's render
  // cycle and must read the current value, not a stale closure.
  const pinnedRef = useRef(true);
  // True while the jump's smooth glide is still animating, so words landing
  // mid-glide extend the glide instead of snapping it. Never used to swallow
  // input: the glide only ever moves DOWN, so the reader's own scroll-up is
  // told apart by direction alone. Cleared on `scrollend`, or on arrival in
  // the band for engines without that event.
  const glidingRef = useRef(false);
  // Where the last scroll event (or our own instant scroll) left the column.
  // Updated on every programmatic scroll too: the browser coalesces scroll
  // events per frame, so an upward wheel tick that lands in the same frame as
  // a big follow must be measured against the follow's position.
  const lastTopRef = useRef(0);
  const lastHeightRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);

  const setPin = useCallback((next: boolean) => {
    pinnedRef.current = next;
    setPinned(next);
    if (next) setGrewBelow(false);
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      if (behavior === "smooth") {
        glidingRef.current = true;
      } else {
        glidingRef.current = false;
        lastTopRef.current = el.scrollTop;
      }
    },
    [containerRef],
  );

  const pin = useCallback(() => {
    setPin(true);
    scrollToBottom("auto");
  }, [setPin, scrollToBottom]);

  const jumpToLatest = useCallback(() => {
    setPin(true);
    scrollToBottom(prefersReducedMotion() ? "auto" : "smooth");
  }, [setPin, scrollToBottom]);

  // A layout effect so the mount scroll lands before the first paint: a long
  // history must open at its newest message, not flash its top for a frame.
  useLayoutEffect(() => {
    const el = containerRef.current;
    const content = contentRef.current;
    if (!el || !content) return;

    // A fresh mount (each conversation remounts this screen) opens at the
    // newest message, instantly — no glide across the whole history.
    setPin(true);
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    lastTopRef.current = el.scrollTop;
    lastHeightRef.current = el.scrollHeight;

    const release = () => {
      if (pinnedRef.current) setPin(false);
    };

    const onScroll = () => {
      const top = el.scrollTop;
      const movedUp = top < lastTopRef.current;
      lastTopRef.current = top;
      const distance = distanceFromBottom(el);
      if (distance <= PIN_THRESHOLD_PX) {
        glidingRef.current = false;
        // Scrolling DOWN into the band re-pins. Drifting UP within it does
        // not — the wheel/touch handlers may have just released on purpose.
        // Landing on the bottom always pins: that is the browser clamping a
        // released reader after the content shrank. Under zoom or on HiDPI the
        // metrics are fractional, so "on the bottom" is anything under a pixel.
        if ((!movedUp || distance < 1) && !pinnedRef.current) setPin(true);
        return;
      }
      if (movedUp) release();
    };
    const onScrollEnd = () => {
      glidingRef.current = false;
    };
    // Intent, ahead of the scroll event it causes: a wheel tick or a finger
    // drag towards the top releases at once, however small the move.
    const canScroll = () => el.scrollHeight > el.clientHeight;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && canScroll()) release();
    };
    // Keyboard scrolling: ArrowUp on a focused scroller (or a focused control
    // inside it) moves ~40px, inside the band, so it needs the same intent path.
    const onKeyDown = (e: KeyboardEvent) => {
      const up =
        e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home" || (e.key === " " && e.shiftKey);
      if (up && canScroll()) release();
    };
    const onTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const startY = touchStartYRef.current;
      const y = e.touches[0]?.clientY;
      if (startY === null || y === undefined) return;
      // The finger moving DOWN the screen drags the content down: a scroll up.
      if (y - startY > TOUCH_DEAD_ZONE_PX && canScroll()) release();
    };

    const observer = new ResizeObserver((entries) => {
      const height = el.scrollHeight;
      const grew = height > lastHeightRef.current;
      lastHeightRef.current = height;
      if (pinnedRef.current) {
        scrollToBottom(glidingRef.current ? "smooth" : "auto");
        return;
      }
      // Released: only the CONTENT growing means there is something new to
      // jump to. The container resizing (window, composer autosize) does not,
      // and neither does the content shrinking (a failed send, a stopped reply).
      if (grew && entries.some((entry) => entry.target === content)) setGrewBelow(true);
    });
    observer.observe(content);
    observer.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", onScrollEnd);
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", onScrollEnd);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [containerRef, contentRef, setPin, scrollToBottom]);

  const showJump = !pinned && (grewBelow || busy);
  return { pinned, showJump, jumpToLatest, pin };
}
