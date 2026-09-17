// @vitest-environment happy-dom
// The "Jump to latest" pill: shown once new words land below a reader who
// scrolled up mid-reply. It stays mounted so its enter/exit can transition,
// and while hidden it is out of the accessibility tree and the tab order.
import "../../test/component-setup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { JumpToLatest } from "./jump-to-latest";

describe("JumpToLatest", () => {
  it("is a real button the reader can press to return to the newest words", () => {
    const onJump = vi.fn();
    render(<JumpToLatest visible onJump={onJump} />);
    const button = screen.getByRole("button", { name: "Jump to latest" });
    expect(button).toHaveProperty("type", "button");
    fireEvent.click(button, { detail: 1 }); // a pointer click
    expect(onJump).toHaveBeenCalledWith(false);
  });

  it("tells the caller when it was activated from the keyboard, so focus can be handed on", () => {
    // The pill hides (and goes inert) the moment it is used, which would drop
    // keyboard focus onto the body; a keyboard activation has `detail === 0`.
    const onJump = vi.fn();
    render(<JumpToLatest visible onJump={onJump} />);
    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }), { detail: 0 });
    expect(onJump).toHaveBeenCalledWith(true);
  });

  it("is hidden from assistive tech and the tab order while not visible", () => {
    render(<JumpToLatest visible={false} onJump={() => {}} />);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
    const button = screen.getByText("Jump to latest").closest("button");
    expect(button?.hasAttribute("inert")).toBe(true);
    expect(button?.getAttribute("aria-hidden")).toBe("true");
    expect(button?.className).toContain("invisible");
  });

  it("centers itself without a translate, so the reduced-motion hover rule cannot shift it", () => {
    // globals.css neutralises `translate` on every hovered/pressed element under
    // prefers-reduced-motion. A pill centered by `-translate-x-1/2` would jump
    // half its width to the right the moment such a reader hovers it.
    render(<JumpToLatest visible onJump={() => {}} />);
    const button = screen.getByRole("button", { name: "Jump to latest" });
    expect(button.className).not.toMatch(/translate-x-1\/2/);
    expect(button.className).toMatch(/\binset-x-0\b/);
    expect(button.className).toMatch(/\bmx-auto\b/);
    expect(button.className).toMatch(/\bw-fit\b/);
  });

  it("transitions in and out motion-safely, never with `transition: all`", () => {
    render(<JumpToLatest visible onJump={() => {}} />);
    const button = screen.getByRole("button", { name: "Jump to latest" });
    expect(button.className).toMatch(/motion-safe:transition-\[[^\]]*opacity[^\]]*\]/);
    expect(button.className).not.toContain("transition-all");
  });
});
