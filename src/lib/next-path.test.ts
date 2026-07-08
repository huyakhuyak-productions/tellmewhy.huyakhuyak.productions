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
});
