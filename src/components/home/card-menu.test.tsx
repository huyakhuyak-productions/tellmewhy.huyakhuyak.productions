// @vitest-environment happy-dom
// Focus pins for the card menu's hide confirm: opening it lands on the safe
// "Keep it", and dismissing it returns focus to the actions trigger instead of
// dropping to <body>.
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
vi.mock("@/lib/sharing-client", () => ({
  shareConversation: vi.fn(() => Promise.resolve(true)),
  stopSharingConversation: vi.fn(() => Promise.resolve(true)),
}));

import { CardMenu } from "./card-menu";

function renderMenu() {
  return render(
    <CardMenu conversationId="conv-1" title="A quiet evening" currentFolderId={null} folders={[]} />,
  );
}

function openHideConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "Conversation actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));
}

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CardMenu hide confirm focus", () => {
  it("lands focus on the safe 'Keep it' when the confirm opens", () => {
    renderMenu();
    openHideConfirm();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep it" }));
  });

  it("returns focus to the actions trigger when the confirm is dismissed", async () => {
    renderMenu();
    openHideConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Conversation actions" }),
      ),
    );
  });

  it("dismisses and restores focus on Escape", async () => {
    renderMenu();
    openHideConfirm();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Conversation actions" }),
      ),
    );
  });
});
