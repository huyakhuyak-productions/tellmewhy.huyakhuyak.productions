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
});
