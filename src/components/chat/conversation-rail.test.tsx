// @vitest-environment happy-dom
// D1 pins for the rail: dismissing a row's hide confirm restores focus to the
// menu it came from (never <body>), and a collapsed folder marks its clipped
// rows inert so they leave the tab order.
import "../../test/component-setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
vi.mock("@/lib/sharing-client", () => ({
  shareConversation: vi.fn(() => Promise.resolve(true)),
  stopSharingConversation: vi.fn(() => Promise.resolve(true)),
}));

import { ConversationRail, type RailConversation, type RailFolder } from "./conversation-rail";

const conversations: RailConversation[] = [
  { id: "conv-1", title: "A quiet evening", updatedAt: new Date("2026-07-20T10:00:00Z"), folderId: "f1" },
];
const folders: RailFolder[] = [{ id: "f1", name: "Reflections" }];

function renderRail() {
  return render(<ConversationRail conversations={conversations} folders={folders} currentId="conv-1" />);
}

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConversationRail hide confirm focus restore", () => {
  it("returns focus to the Hide item when the confirm is dismissed", async () => {
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Conversation actions" }));
    const hideItem = screen.getByRole("menuitem", { name: "Hide" });
    fireEvent.click(hideItem);
    // The confirm takes the safe option.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep it" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Hide" })),
    );
  });
});

describe("ConversationRail hide rate-limit copy", () => {
  afterEach(() => vi.unstubAllGlobals());

  function hideWith(status: number) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status } as Response)),
    );
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Conversation actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide it" }));
  }

  it("shows the gentle-pace copy when a hide is rate-limited", async () => {
    hideWith(429);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/A gentle pace/));
  });

  it("shows the generic copy on any other failure", async () => {
    hideWith(500);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Couldn't hide/));
  });
});

describe("ConversationRail collapsed folder inertness", () => {
  it("marks a collapsed folder's clip inert and clears it when reopened", () => {
    const { container } = renderRail();
    // Expanded by default — nothing inert yet.
    expect(container.querySelector("[inert]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reflections" }));
    expect(container.querySelector("[inert]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reflections" }));
    expect(container.querySelector("[inert]")).toBeNull();
  });
});
