// @vitest-environment happy-dom
// Focus/announce pins for the notes "let it go" delete: the confirm lands focus
// on the safe option, and a confirmed delete hands focus to a stable target and
// announces through an always-mounted live region (the delete/keep idiom shared
// with the exercise panel and the card menus).
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

import { NotesScreen } from "./notes-screen";
import type { SelfNote } from "@/lib/notes";

function note(overrides: Partial<SelfNote> = {}): SelfNote {
  return {
    id: "note-1",
    body: "Be gentle with yourself tonight.",
    createdAt: new Date("2026-07-20T10:00:00Z"),
    sourceMessageId: null,
    ...overrides,
  } as SelfNote;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockClear();
  fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NotesScreen delete focus + announcement", () => {
  it("lands focus on the safe 'Keep it' when the confirm opens", () => {
    render(<NotesScreen notes={[note()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Let it go" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep it" }));
  });

  it("hands focus to the composer and announces after a confirmed delete", async () => {
    render(<NotesScreen notes={[note()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Let it go" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, let it go" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/let go/i);
    });
    const composer = screen.getByRole("textbox", { name: "Write a note to your future self" });
    await waitFor(() => expect(document.activeElement).toBe(composer));
    expect(refresh).toHaveBeenCalled();
  });
});
