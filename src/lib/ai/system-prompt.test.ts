import { describe, expect, it } from "vitest";
import { buildHomeworkSection } from "./system-prompt";

describe("buildHomeworkSection", () => {
  it("returns null when there are no active exercises", () => {
    expect(buildHomeworkSection([])).toBeNull();
  });

  it("lists the client's active exercise instructions", () => {
    const section = buildHomeworkSection([
      { type: "thought_record", instruction: "Notice one anxious thought each evening." },
    ]);
    expect(section).not.toBeNull();
    expect(section!).toContain("Notice one anxious thought each evening.");
  });

  it("tells the model it may gently weave homework in and guide one column at a time", () => {
    const section = buildHomeworkSection([{ type: "thought_record", instruction: "Track a moment of tension." }])!;
    // The guidance the client depends on: never forced, walked one column at a
    // time when asked, in the thought-record order.
    expect(section.toLowerCase()).toContain("gently");
    expect(section).toContain("one column at a time");
    expect(section).toContain("situation");
    expect(section).toContain("thoughts");
    expect(section).toContain("emotions");
    expect(section).toContain("behavior");
    expect(section).toContain("body sensations");
    expect(section.toLowerCase()).toContain("never");
  });

  it("clamps each instruction to 300 characters", () => {
    const long = "a".repeat(500);
    const section = buildHomeworkSection([{ type: "thought_record", instruction: long }])!;
    expect(section).toContain("a".repeat(300));
    expect(section).not.toContain("a".repeat(301));
  });

  it("keeps only the three newest exercises (input is newest-first)", () => {
    const section = buildHomeworkSection([
      { type: "thought_record", instruction: "NEWEST_ONE" },
      { type: "thought_record", instruction: "SECOND_ONE" },
      { type: "thought_record", instruction: "THIRD_ONE" },
      { type: "thought_record", instruction: "OLDEST_DROPPED" },
    ])!;
    expect(section).toContain("NEWEST_ONE");
    expect(section).toContain("SECOND_ONE");
    expect(section).toContain("THIRD_ONE");
    expect(section).not.toContain("OLDEST_DROPPED");
  });
});
