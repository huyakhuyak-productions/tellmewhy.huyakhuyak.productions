// @vitest-environment happy-dom
// The crisis banner is purely presentational; this pins the one behaviour that
// isn't self-evident from reading it: its `bottom` offset is calc'd off
// `--composer-height`, which the failure-notice toggle changes at runtime. A
// motion-safe transition makes that move glide instead of snap, while
// reduced-motion readers keep the instant reposition. Class-level assertion —
// the resolved layout can't be measured in happy-dom, but the intent can.
import "../../test/component-setup";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CrisisBanner } from "./crisis-banner";

describe("CrisisBanner composer-height glide", () => {
  it("transitions its bottom offset motion-safely without dropping the entrance", () => {
    render(<CrisisBanner onDismiss={vi.fn()} />);
    const card = screen.getByRole("alertdialog");
    // A composer-height change glides the card rather than snapping it...
    expect(card.className).toContain("motion-safe:transition-[bottom]");
    // ...and the entrance animation is untouched.
    expect(card.className).toContain("animate-crisis-rise");
  });

  it("centers on desktop without a translate, so the reduced-motion hover rule cannot shift it", () => {
    // globals.css neutralises `translate` on every hovered/pressed element under
    // prefers-reduced-motion, and :hover matches the card whenever the pointer
    // is over any of its buttons. A -translate-x-1/2 centering would then jump.
    render(<CrisisBanner onDismiss={vi.fn()} />);
    const card = screen.getByRole("alertdialog");
    expect(card.className).not.toMatch(/translate-x-1\/2/);
    expect(card.className).toMatch(/\blg:inset-x-0\b/);
    expect(card.className).toMatch(/\bmx-auto\b/);
  });
});
