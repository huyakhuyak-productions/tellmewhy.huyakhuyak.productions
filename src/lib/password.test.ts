import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes with Argon2id and hardened parameters", async () => {
    const hash = await hashPassword("correct horse battery staple");
    // PHC string encodes algorithm and params — assert them explicitly.
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).toContain("m=65536,t=3,p=1");
  });

  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword({ hash, password: "s3cret-passphrase" })).toBe(true);
    expect(await verifyPassword({ hash, password: "wrong" })).toBe(false);
  });
});
