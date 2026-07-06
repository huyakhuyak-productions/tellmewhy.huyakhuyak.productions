import { describe, expect, it } from "vitest";
import { CryptoError, decryptText, encryptText, generateDek } from "./envelope";

describe("envelope encryption", () => {
  it("round-trips text", () => {
    const dek = generateDek();
    const payload = encryptText(dek, "I feel anxious today 🌧️");
    expect(payload).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]*$/);
    expect(decryptText(dek, payload)).toBe("I feel anxious today 🌧️");
  });

  it("produces different ciphertext for the same plaintext (fresh IV)", () => {
    const dek = generateDek();
    expect(encryptText(dek, "same")).not.toBe(encryptText(dek, "same"));
  });

  it("rejects a tampered payload", () => {
    const dek = generateDek();
    const payload = encryptText(dek, "secret");
    const parts = payload.split(".");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64");
    expect(() => decryptText(dek, parts.join("."))).toThrow(CryptoError);
  });

  it("rejects the wrong key", () => {
    const payload = encryptText(generateDek(), "secret");
    expect(() => decryptText(generateDek(), payload)).toThrow(CryptoError);
  });

  it("rejects an unknown format version", () => {
    const dek = generateDek();
    expect(() => decryptText(dek, "v9.a.b.c")).toThrow(CryptoError);
  });
});
