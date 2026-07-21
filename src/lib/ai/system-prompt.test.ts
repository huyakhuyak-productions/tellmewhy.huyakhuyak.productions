import { describe, expect, it } from "vitest";
import { buildHomeworkSection, buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  it("always carries the thought-record walk-through protocol — therapist or not", () => {
    // The standalone law: the same column-by-column walk-through the chat
    // affordance promises is present with no assignment and no therapist. It
    // lives in the unconditional base prompt, not the (conditional) homework
    // section, so a client with no homework still gets it.
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("one column at a time");
    expect(prompt).toContain("situation");
    expect(prompt).toContain("thoughts");
    expect(prompt).toContain("emotions");
    expect(prompt).toContain("behavior");
    expect(prompt).toContain("body sensations");
    expect(prompt.toLowerCase()).toContain("never");
  });
});

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

  it("tells the model it may gently weave homework in, never forcing it", () => {
    const section = buildHomeworkSection([{ type: "thought_record", instruction: "Track a moment of tension." }])!;
    // The listing part only: the walk-through protocol itself now lives
    // unconditionally in buildSystemPrompt (covered above).
    expect(section.toLowerCase()).toContain("gently");
    expect(section.toLowerCase()).toContain("never");
    expect(section).toContain("active homework");
  });

  it("clamps each instruction to 300 characters", () => {
    const long = "a".repeat(500);
    const section = buildHomeworkSection([{ type: "thought_record", instruction: long }])!;
    expect(section).toContain("a".repeat(300));
    expect(section).not.toContain("a".repeat(301));
  });

  it("folds CRLF and caps runs of blank lines so an instruction can't reshape the prompt", () => {
    // A therapist-authored instruction is free text spliced into the system
    // prompt. Stray CRLFs and long runs of blank lines could smuggle structure
    // or balloon the section, so they are normalized at interpolation time
    // (never at storage — encrypted history can't be retro-fixed).
    const section = buildHomeworkSection([
      { type: "thought_record", instruction: "Notice the thought.\r\n\r\n\r\n\r\nThen write it down." },
    ])!;
    expect(section).toContain("Notice the thought.\n\nThen write it down.");
    expect(section).not.toContain("\r");
    expect(section).not.toContain("\n\n\n");
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
