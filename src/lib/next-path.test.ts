import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("accepts a root-relative path", () => {
    expect(safeNextPath("/trust")).toBe("/trust");
    expect(safeNextPath("/link/abc123")).toBe("/link/abc123");
    expect(safeNextPath("/chat?x=1")).toBe("/chat?x=1");
  });

  it("rejects empty and nullish input", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });

  it("rejects anything that isn't a root-relative path", () => {
    expect(safeNextPath("chat")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("http://evil.com")).toBeNull();
  });

  it("rejects off-origin escapes disguised as paths", () => {
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
  });

  it("rejects control-character tricks the URL parser would strip into an escape", () => {
    // WHATWG URL parsing removes tab/newline/CR before parsing, so each of
    // these would otherwise collapse into a protocol-relative redirect.
    expect(safeNextPath("/\t/evil.com")).toBeNull();
    expect(safeNextPath("/\n//evil.com")).toBeNull();
    expect(safeNextPath("/\r/\\evil.com")).toBeNull();
  });

  it("rejects an otherwise-clean path with an embedded control character outright", () => {
    // Decision: reject, never strip — a "repaired" value could still differ
    // from what was reviewed, and no legitimate path contains these.
    expect(safeNextPath("/tr\tust")).toBeNull();
    expect(safeNextPath("/chat\n")).toBeNull();
  });
});
