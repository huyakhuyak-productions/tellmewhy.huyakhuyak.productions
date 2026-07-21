// @vitest-environment happy-dom
// Unit pin for the intervention resync (fix 1edb0fe, reading-view.tsx ~254-256):
// after a successful intervention POST, the handler reads the created id from
// the response and snaps the VIEW-LOCAL leaf to it, so the therapist sees the
// message they just sent — even though `viewLeafId` was seeded once at mount and
// the client's own active leaf never moved. Previously pinned only by e2e.
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
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ReadingView } from "./reading-view";
import type { ReadingMessage } from "@/lib/therapist-desk";

const CREATED_ID = "intervention-just-sent";
const NOTE_TEXT = "Here is a note from me, your therapist.";

// A minimal but realistic tree, mirroring loadSharedMessages' shape: a client
// root, the AI's reply (the client's active leaf), and — appended onto that
// leaf, exactly where an intervention lands — the therapist message that the
// POST response points the view at. It sits OFF the initial displayed path
// (which resolves from the client's active leaf, the AI reply), so it only
// renders once the submit handler snaps the view to it.
function tree(): ReadingMessage[] {
  return [
    {
      id: "root-client",
      parentId: null,
      createdAt: new Date("2026-07-20T10:00:00Z"),
      sender: "client",
      text: "I have been struggling this week.",
      riskLevel: "none",
      flagged: false,
      authorName: null,
    },
    {
      id: "ai-reply",
      parentId: "root-client",
      createdAt: new Date("2026-07-20T10:00:05Z"),
      sender: "ai",
      text: "Thank you for telling me. What has this week been like?",
      riskLevel: "none",
      flagged: false,
      authorName: null,
    },
    {
      id: CREATED_ID,
      parentId: "ai-reply",
      createdAt: new Date("2026-07-20T10:05:00Z"),
      sender: "therapist",
      text: NOTE_TEXT,
      riskLevel: "none",
      flagged: false,
      authorName: "Dr. Reed",
    },
  ];
}

function renderView() {
  return render(
    <ReadingView
      conversationId="conv-1"
      clientId="client-1"
      messages={tree()}
      // The client's active leaf is the AI reply — the therapist's initial view
      // is seeded from it, so the not-yet-shown intervention is its descendant.
      activeLeafId="ai-reply"
      markerMessageId={null}
    />,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockClear();
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/intervention")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: CREATED_ID }),
      } as Response);
    }
    // The digest panel fires a GET on mount; answer it honestly-empty.
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ digest: null }),
    } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReadingView intervention resync", () => {
  it("snaps the view leaf to the created id so the just-sent message appears", async () => {
    renderView();

    // The intervention lives off the seeded path — it must not show yet.
    expect(screen.queryByText(NOTE_TEXT)).toBeNull();

    fireEvent.change(screen.getByLabelText("Write a message as yourself"), {
      target: { value: "Sending you a note." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send as yourself" }));

    // After the POST resolves, the handler advances viewLeafId to the created
    // id, re-resolving the displayed path to include the new leaf.
    expect(await screen.findByText(NOTE_TEXT)).toBeTruthy();

    // And it did POST the intervention, then refresh to carry server data onto
    // the freshly snapped path.
    const posted = fetchMock.mock.calls.find(([input]) => String(input).includes("/intervention"));
    expect(posted).toBeTruthy();
    expect((posted![1] as RequestInit).method).toBe("POST");
    expect(refresh).toHaveBeenCalled();
  });
});
