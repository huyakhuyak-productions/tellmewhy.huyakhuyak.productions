import { describe, expect, it } from "vitest";

// Setup files (src/test/setup.ts) run before this test, so by the time these
// assertions execute DATABASE_URL has already been pinned. We can't stub the
// env from inside the test to precede setup — instead we assert the value that
// survived setup. The honest "red" is running the suite with a bogus
// DATABASE_URL exported in the command environment: the old `??=` let that
// export win, so this assertion failed. The hard override makes it pass.

const COMPOSE_URL = "postgres://tellmewhy:tellmewhy@localhost:5432/tellmewhy";

describe("test DB isolation", () => {
  it("always targets the compose DB (or TEST_DATABASE_URL), never a leaked export", () => {
    const expected = process.env.TEST_DATABASE_URL ?? COMPOSE_URL;
    expect(process.env.DATABASE_URL).toBe(expected);
  });
});
