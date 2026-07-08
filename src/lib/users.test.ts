import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { user } from "@/db/schema";
import { getUserDisplayNames } from "./users";

async function insertUser(name: string): Promise<string> {
  const id = `test-${randomUUID()}`;
  await db.insert(user).values({
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: "therapist",
  });
  return id;
}

describe("getUserDisplayNames", () => {
  it("resolves ids to names and dedupes the query input", async () => {
    const a = await insertUser("Marta");
    const b = await insertUser("Dr. Okafor");

    const names = await getUserDisplayNames([a, b, a]);
    expect(names.get(a)).toBe("Marta");
    expect(names.get(b)).toBe("Dr. Okafor");
  });

  it("returns an empty map for no ids without touching the db", async () => {
    expect(await getUserDisplayNames([])).toEqual(new Map());
    expect(await getUserDisplayNames([""])).toEqual(new Map());
  });

  it("omits ids with no matching user rather than inventing a name", async () => {
    const names = await getUserDisplayNames(["test-does-not-exist"]);
    expect(names.has("test-does-not-exist")).toBe(false);
  });
});
