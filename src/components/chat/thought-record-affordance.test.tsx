// @vitest-environment happy-dom
// D9 pin for the walk-through seed latch: one tap seeds (a double tap can't drop
// the line in twice), and the affordance re-arms once the composer empties again
// so the same line can be offered later in the conversation.
import "../../test/component-setup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SERVICE_ISSUE_TRY_LATER } from "@/lib/service-issue-copy";

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

import { ThoughtRecordAffordance } from "./thought-record-affordance";

afterEach(() => {
  vi.unstubAllGlobals();
});

const WALK = /Walk through a thought record/;

describe("ThoughtRecordAffordance walk-through latch", () => {
  it("seeds once per tap, guarding a double tap", () => {
    const onSeed = vi.fn();
    render(
      <ThoughtRecordAffordance conversationId="c1" canExtract={false} draftEmpty onSeed={onSeed} />,
    );
    const btn = screen.getByRole("button", { name: WALK });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onSeed).toHaveBeenCalledTimes(1);
  });

  it("re-arms once the composer empties again", () => {
    const onSeed = vi.fn();
    const { rerender } = render(
      <ThoughtRecordAffordance conversationId="c1" canExtract={false} draftEmpty onSeed={onSeed} />,
    );
    const btn = screen.getByRole("button", { name: WALK });
    fireEvent.click(btn);
    // The seed filled the composer — still latched while it holds text.
    rerender(
      <ThoughtRecordAffordance
        conversationId="c1"
        canExtract={false}
        draftEmpty={false}
        onSeed={onSeed}
      />,
    );
    fireEvent.click(btn);
    expect(onSeed).toHaveBeenCalledTimes(1);
    // The person sent it — the composer is empty again, so the latch re-arms.
    rerender(
      <ThoughtRecordAffordance conversationId="c1" canExtract={false} draftEmpty onSeed={onSeed} />,
    );
    fireEvent.click(btn);
    expect(onSeed).toHaveBeenCalledTimes(2);
  });
});

describe("ThoughtRecordAffordance extraction failures", () => {
  function stubExtract(status: number) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "x" }), { status })),
    );
  }

  it("maps a 503 (our outage) to the service-issue notice, not the try-talking-more one", async () => {
    stubExtract(503);
    render(<ThoughtRecordAffordance conversationId="c1" canExtract draftEmpty onSeed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Save what we worked out/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(SERVICE_ISSUE_TRY_LATER);
    });
  });

  it("keeps the gentle 'talk it through' note for a 502 (nothing to extract yet)", async () => {
    stubExtract(502);
    render(<ThoughtRecordAffordance conversationId="c1" canExtract draftEmpty onSeed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Save what we worked out/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/talk it through a little more/);
    });
  });
});
