// @vitest-environment happy-dom
// The collapsed restore drawer must leave its rows out of the tab order — the
// 0fr grid collapse hides them visually but keeps them tabbable, so `inert`
// carries the removal. happy-dom doesn't implement inert's focus semantics, so
// this asserts the attribute is present while collapsed and gone once open.
import "../../test/component-setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { HiddenConversations, type HiddenConversation } from "./hidden-conversations";

function conv(): HiddenConversation {
  return { id: "conv-1", title: "An old thread", hiddenAt: new Date("2026-07-19T10:00:00Z") };
}

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HiddenConversations collapsed drawer inertness", () => {
  it("marks the collapsed clip inert and clears it once expanded", () => {
    const { container } = render(<HiddenConversations conversations={[conv()]} />);
    // Collapsed by default — the clip carrying the rows is inert.
    expect(container.querySelector("[inert]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Hidden/ }));
    expect(container.querySelector("[inert]")).toBeNull();
  });
});
