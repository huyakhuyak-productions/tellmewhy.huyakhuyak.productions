// Browser-API stubs for happy-dom component tests. Imported explicitly at the
// top of every `// @vitest-environment happy-dom` test file — NOT wired as a
// global setupFile, so the node-environment suite (the vast majority) never
// pays for or is perturbed by these shims.
//
// Only what the therapist reading view (and the bits it renders) actually
// reaches for: matchMedia (reduced-motion checks + the digest's motion-safe
// pulses), ResizeObserver (streamdown's layout probing), and
// Element.scrollIntoView (the crisis/anchor landing). happy-dom ships none of
// these, and jsdom-style tests crash the moment a component touches them.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

// React Testing Library keeps each mounted tree in the document; unmount it
// between tests so state (and effects like the digest fetch) can't bleed across.
afterEach(() => {
  cleanup();
});
