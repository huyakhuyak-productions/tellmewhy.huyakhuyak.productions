import { describe, expect, it, vi } from "vitest";
import { EnvKeyProvider } from "./key-provider";
import { generateDek } from "./envelope";

describe("EnvKeyProvider", () => {
  const kek = Buffer.alloc(32, 7).toString("base64");

  it("wraps and unwraps a DEK", async () => {
    const provider = new EnvKeyProvider(kek);
    const dek = generateDek();
    const wrapped = await provider.wrapDek(dek);
    expect(wrapped).not.toContain(dek.toString("base64"));
    expect((await provider.unwrapDek(wrapped)).equals(dek)).toBe(true);
  });

  it("fails to unwrap with a different KEK", async () => {
    const wrapped = await new EnvKeyProvider(kek).wrapDek(generateDek());
    const other = new EnvKeyProvider(Buffer.alloc(32, 9).toString("base64"));
    await expect(other.unwrapDek(wrapped)).rejects.toThrow();
  });

  it("rejects a missing or malformed KEK", () => {
    vi.stubEnv("MASTER_KEK", "");
    try {
      expect(() => new EnvKeyProvider()).toThrow(/MASTER_KEK/);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(() => new EnvKeyProvider("dG9vLXNob3J0")).toThrow(/32 bytes/);
  });
});
