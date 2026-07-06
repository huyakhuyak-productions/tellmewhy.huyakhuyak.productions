import { describe, expect, it } from "vitest";
import { scopedMemo, withRequestScope } from "./request-scope";

describe("request-scope", () => {
  it("memoizes repeat calls with the same key inside one scope", async () => {
    let calls = 0;
    await withRequestScope(async () => {
      const a = await scopedMemo("k", async () => ++calls);
      const b = await scopedMemo("k", async () => ++calls);
      expect(a).toBe(1);
      expect(b).toBe(1);
    });
    expect(calls).toBe(1);
  });

  it("dedupes concurrent in-flight calls for the same key", async () => {
    let calls = 0;
    await withRequestScope(async () => {
      const compute = async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return "value";
      };
      const [a, b] = await Promise.all([scopedMemo("k", compute), scopedMemo("k", compute)]);
      expect(a).toBe("value");
      expect(b).toBe("value");
    });
    expect(calls).toBe(1);
  });

  // The security property: two separate scopes (two separate requests) must
  // never share a cached value, even for the identical key.
  it("does not share cached values across two different scopes", async () => {
    let calls = 0;
    const compute = async () => ++calls;

    const first = await withRequestScope(() => scopedMemo("k", compute));
    const second = await withRequestScope(() => scopedMemo("k", compute));

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });

  it("does not cache at all when called outside any scope", async () => {
    let calls = 0;
    const compute = async () => ++calls;

    expect(await scopedMemo("k", compute)).toBe(1);
    expect(await scopedMemo("k", compute)).toBe(2);
    expect(calls).toBe(2);
  });

  it("retries fresh after a rejected compute instead of caching the failure", async () => {
    let calls = 0;
    await withRequestScope(async () => {
      await expect(
        scopedMemo("k", async () => {
          calls++;
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      const result = await scopedMemo("k", async () => {
        calls++;
        return "recovered";
      });
      expect(result).toBe("recovered");
    });
    expect(calls).toBe(2);
  });
});
