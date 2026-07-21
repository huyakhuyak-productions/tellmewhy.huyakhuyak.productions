// @vitest-environment happy-dom
// Unit pin for the intervention resync (fix 1edb0fe, reading-view.tsx ~254-256):
// after a successful intervention POST, the handler reads the created id from
// the response and snaps the VIEW-LOCAL leaf to it, so the therapist sees the
// message they just sent — even though `viewLeafId` was seeded once at mount and
// the client's own active leaf never moved. Previously pinned only by e2e.
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

// The raw nodes the view resolves paths over — every row's plaintext columns,
// mirroring getReadingView's `nodes`. Here they line up 1:1 with the decrypted
// messages (nothing corrupt); the corrupt-row test below deliberately diverges.
function nodesFrom(messages: ReadingMessage[]) {
  return messages.map((m) => ({
    id: m.id,
    parentId: m.parentId,
    createdAt: m.createdAt,
    riskLevel: m.riskLevel,
  }));
}

function renderView() {
  const messages = tree();
  return render(
    <ReadingView
      conversationId="conv-1"
      clientId="client-1"
      messages={messages}
      nodes={nodesFrom(messages)}
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

describe("ReadingView corrupt-row resilience", () => {
  it("keeps ancestors visible when a mid-chain message body won't decrypt", () => {
    const rootText = "This is the very first thing I wrote.";
    const leafText = "And this is what I said after.";
    // The whole raw tree — every branch, corrupt bodies included. Path math
    // resolves over THIS, so a body that fails to decrypt can't sever the chain.
    const nodes = [
      { id: "root", parentId: null, createdAt: new Date("2026-07-20T10:00:00Z"), riskLevel: "none" as const },
      { id: "middle", parentId: "root", createdAt: new Date("2026-07-20T10:00:05Z"), riskLevel: "none" as const },
      { id: "leaf", parentId: "middle", createdAt: new Date("2026-07-20T10:00:10Z"), riskLevel: "none" as const },
    ];
    // The decrypted list — the middle body failed to decrypt, so it's ABSENT.
    // Resolving the path over this alone would orphan the root from the leaf.
    const messages: ReadingMessage[] = [
      { id: "root", parentId: null, createdAt: nodes[0]!.createdAt, sender: "client", text: rootText, riskLevel: "none", flagged: false, authorName: null },
      { id: "leaf", parentId: "middle", createdAt: nodes[2]!.createdAt, sender: "client", text: leafText, riskLevel: "none", flagged: false, authorName: null },
    ];

    render(
      <ReadingView
        conversationId="conv-corrupt"
        clientId="client-1"
        messages={messages}
        nodes={nodes}
        activeLeafId="leaf"
        markerMessageId={null}
      />,
    );

    // Both readable ancestors survive; only the unreadable middle is omitted.
    expect(screen.getByText(rootText)).toBeTruthy();
    expect(screen.getByText(leafText)).toBeTruthy();
  });
});

// A short path whose leaf is a crisis message, reused by the two tests below.
function crisisTree(): ReadingMessage[] {
  return [
    {
      id: "root",
      parentId: null,
      createdAt: new Date("2026-07-20T10:00:00Z"),
      sender: "client",
      text: "How the week opened.",
      riskLevel: "none",
      flagged: false,
      authorName: null,
    },
    {
      id: "crisis-msg",
      parentId: "root",
      createdAt: new Date("2026-07-20T10:00:05Z"),
      sender: "client",
      text: "A line that reads as crisis.",
      riskLevel: "crisis",
      flagged: false,
      authorName: null,
    },
  ];
}

describe("ReadingView crisis navigator on a `?focus=` arrival", () => {
  // Regression pin for the c7339d7 break: the attention queue links here with
  // `?focus=<crisis-id>`, and that mount landing must NOT claim the navigator.
  // If it did, arriving on a single-crisis thread would dead-end the pill at
  // "1/1" with both arrows disabled — the reader would never see the count and
  // could never step. The pill stays at the honest count until an arrow moves it.
  it("keeps the pre-landing count when the `?focus=` mount lands on the crisis", async () => {
    const messages = crisisTree();
    render(
      <ReadingView
        conversationId="conv-crisis"
        clientId="client-1"
        messages={messages}
        nodes={nodesFrom(messages)}
        activeLeafId="crisis-msg"
        markerMessageId={null}
        focusMessageId="crisis-msg"
      />,
    );

    // Let the rAF-deferred mount landing run — it scrolls/flashes but must not
    // touch the navigator.
    await waitFor(() => expect(screen.getByText("1 crisis message")).toBeTruthy());
    // Never claimed: the landed "1/1" readout must not appear from the arrival.
    expect(screen.queryByText("1/1")).toBeNull();
  });
});

describe("ReadingView crisis navigator on a digest risk-anchor click", () => {
  // A digest risk anchor IS a reader-driven jump, so clicking one onto a crisis
  // DOES claim the navigator — its i/N syncs to where the reader landed.
  it("syncs the readout when a digest risk anchor lands on a crisis message", async () => {
    const messages = crisisTree();

    // A digest whose single anchor is a risk pointer at the crisis message.
    const digest = {
      overview: "",
      themes: [],
      anchors: [{ messageId: "crisis-msg", label: "A hard moment", kind: "risk" as const }],
      coversUpToMessageId: "crisis-msg",
      generatedAt: "2026-07-20T10:00:05Z",
      stale: false,
    };
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/digest")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ digest }) } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ digest: null }) } as Response);
    });

    render(
      <ReadingView
        conversationId="conv-crisis"
        clientId="client-1"
        messages={messages}
        nodes={nodesFrom(messages)}
        activeLeafId="crisis-msg"
        markerMessageId={null}
      />,
    );

    // Before any jump the pill shows the count, not a position.
    expect(screen.getByText("1 crisis message")).toBeTruthy();

    // The anchor renders once the digest fetch resolves; clicking it claims the
    // navigator, so the readout advances to the crisis it landed on.
    const anchor = await screen.findByRole("button", { name: /Jump to a crisis moment/ });
    fireEvent.click(anchor);
    await waitFor(() => expect(screen.getByText("1/1")).toBeTruthy());
  });
});

describe("ReadingView navigator steps past a body-less crisis", () => {
  it("advances the readout onto a body-less crisis so the next press reaches the next one", () => {
    // Two crisis messages on one chain: the first (A) is body-less — its row is
    // a crisis in `nodes` (so it counts) but its body failed to decrypt, so
    // it's ABSENT from the decrypted `messages` and can never scroll-land. The
    // second (B) is present. The navigator must still be able to step PAST A to
    // reach B — stepping advances its own readout even when it can't scroll.
    const bText = "The second thing, which reads as crisis.";
    const nodes = [
      { id: "root", parentId: null, createdAt: new Date("2026-07-20T10:00:00Z"), riskLevel: "none" as const },
      { id: "A", parentId: "root", createdAt: new Date("2026-07-20T10:00:05Z"), riskLevel: "crisis" as const },
      { id: "B", parentId: "A", createdAt: new Date("2026-07-20T10:00:10Z"), riskLevel: "crisis" as const },
    ];
    // A's body is absent (won't decrypt); root and B decrypt fine.
    const messages: ReadingMessage[] = [
      { id: "root", parentId: null, createdAt: nodes[0]!.createdAt, sender: "client", text: "How it started.", riskLevel: "none", flagged: false, authorName: null },
      { id: "B", parentId: "A", createdAt: nodes[2]!.createdAt, sender: "client", text: bText, riskLevel: "crisis", flagged: false, authorName: null },
    ];

    render(
      <ReadingView
        conversationId="conv-bodyless"
        clientId="client-1"
        messages={messages}
        nodes={nodes}
        activeLeafId="B"
        markerMessageId={null}
      />,
    );

    // Fresh mount: the pill shows the count, no position yet.
    expect(screen.getByText("2 crisis messages")).toBeTruthy();

    // First step lands on A (index 0). A can't scroll (body-less), but the
    // readout must still advance to 1/2 — otherwise Next stays a dead button.
    fireEvent.click(screen.getByLabelText("Next crisis message"));
    expect(screen.getByText("1/2")).toBeTruthy();

    // The following press reaches B (index 1) — proving A didn't deadlock it.
    fireEvent.click(screen.getByLabelText("Next crisis message"));
    expect(screen.getByText("2/2")).toBeTruthy();
  });
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
