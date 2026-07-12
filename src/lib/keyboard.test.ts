import { describe, expect, it } from "vitest";
import { composeSubmitTitle, isComposeSubmit, type ComposeKeyEvent } from "./keyboard";

function event(overrides: Partial<ComposeKeyEvent>): ComposeKeyEvent {
  return { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false, ...overrides };
}

describe("isComposeSubmit", () => {
  it("submits on Cmd+Enter (macOS metaKey)", () => {
    expect(isComposeSubmit(event({ metaKey: true }))).toBe(true);
  });

  it("submits on Ctrl+Enter (non-Mac)", () => {
    expect(isComposeSubmit(event({ ctrlKey: true }))).toBe(true);
  });

  it("ignores a plain Enter — the newline gesture", () => {
    expect(isComposeSubmit(event({}))).toBe(false);
  });

  it("ignores Shift+Enter even with a submit modifier held", () => {
    expect(isComposeSubmit(event({ shiftKey: true }))).toBe(false);
    expect(isComposeSubmit(event({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isComposeSubmit(event({ ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it("ignores a modifier held over any non-Enter key", () => {
    expect(isComposeSubmit(event({ key: "a", metaKey: true }))).toBe(false);
    expect(isComposeSubmit(event({ key: "s", ctrlKey: true }))).toBe(false);
    expect(isComposeSubmit(event({ key: " ", metaKey: true }))).toBe(false);
  });
});

describe("composeSubmitTitle", () => {
  it("titles the shortcut per platform", () => {
    expect(composeSubmitTitle("save", true)).toBe("⌘↵ to save");
    expect(composeSubmitTitle("save", false)).toBe("Ctrl+↵ to save");
  });

  it("carries the verb through for each site", () => {
    expect(composeSubmitTitle("assign", true)).toBe("⌘↵ to assign");
    expect(composeSubmitTitle("send", false)).toBe("Ctrl+↵ to send");
  });
});
