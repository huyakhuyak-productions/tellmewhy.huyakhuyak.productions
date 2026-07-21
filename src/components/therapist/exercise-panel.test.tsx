// @vitest-environment happy-dom
// D9 pin: the panel serializes closes one at a time, so while one card's close
// is in flight every other card's Close button is held too — not just the card
// whose close is pending.
import "../../test/component-setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { ExercisePanel } from "./exercise-panel";
import type { TherapistAssignment } from "@/lib/exercises";

function assignment(id: string): TherapistAssignment {
  return {
    id,
    type: "thought_record",
    instruction: `Notice ${id}`,
    status: "open",
    createdAt: new Date("2026-07-20T10:00:00Z"),
    entryCount: 0,
    lastEntryAt: null,
    sharedEntryIds: [],
  };
}

let resolveClose: ((value: unknown) => void) | null;

beforeEach(() => {
  resolveClose = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise((resolve) => (resolveClose = resolve))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExercisePanel close serialization", () => {
  it("holds every card's Close button while one close is in flight", async () => {
    render(
      <ExercisePanel
        clientId="client-1"
        clientName="Sam"
        assignments={[assignment("a1"), assignment("a2")]}
      />,
    );
    const closeButtons = screen.getAllByRole("button", { name: "Close this assignment" });
    expect(closeButtons).toHaveLength(2);
    fireEvent.click(closeButtons[0]!);

    await waitFor(() => {
      const buttons = screen.getAllByRole("button", { name: "Close this assignment" });
      // The clicked card shows "Closing…"; the OTHER card must be disabled too.
      expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    });

    // Let the in-flight close settle so the test leaves nothing pending.
    resolveClose?.({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
});
