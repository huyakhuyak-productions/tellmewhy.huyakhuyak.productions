import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUmamiConfig, UMAMI_BEFORE_SEND_NAME, UMAMI_BEFORE_SEND_SNIPPET } from "./umami";

describe("getUmamiConfig", () => {
  beforeEach(() => {
    vi.stubEnv("UMAMI_SCRIPT_URL", undefined);
    vi.stubEnv("UMAMI_WEBSITE_ID", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the script source and website id when both vars are set", () => {
    vi.stubEnv("UMAMI_SCRIPT_URL", "https://umami.example.com/script.js");
    vi.stubEnv("UMAMI_WEBSITE_ID", "2fd3f342-f002-4cc8-b131-5ae048eb71da");
    expect(getUmamiConfig()).toEqual({
      src: "https://umami.example.com/script.js",
      websiteId: "2fd3f342-f002-4cc8-b131-5ae048eb71da",
    });
  });

  it("returns null when the script URL is missing", () => {
    vi.stubEnv("UMAMI_WEBSITE_ID", "2fd3f342-f002-4cc8-b131-5ae048eb71da");
    expect(getUmamiConfig()).toBeNull();
  });

  it("returns null when the website id is missing", () => {
    vi.stubEnv("UMAMI_SCRIPT_URL", "https://umami.example.com/script.js");
    expect(getUmamiConfig()).toBeNull();
  });

  it("returns null when both are unset (dev, test, CI)", () => {
    expect(getUmamiConfig()).toBeNull();
  });
});

// The snippet ships to the browser as an inline script; evaluating it against
// a fake window lets vitest pin the exact scrubbing the page will do.
describe("before-send scrubber", () => {
  type Payload = { url?: unknown; referrer?: unknown; title?: string };
  function loadHandler(): (type: string, payload: Payload | null) => Payload | null {
    const win: Record<string, unknown> = {};
    new Function("window", UMAMI_BEFORE_SEND_SNIPPET)(win);
    return win[UMAMI_BEFORE_SEND_NAME] as ReturnType<typeof loadHandler>;
  }

  it("redacts the invite token path segment from the url", () => {
    const out = loadHandler()("event", { url: "/link/tok_live_credential" });
    expect(out?.url).toBe("/link/redacted");
  });

  it("drops query strings and redacts tokens in the referrer", () => {
    const out = loadHandler()("event", {
      url: "/sign-in",
      referrer: "https://example.com/sign-in?next=%2Flink%2Ftok_live_credential",
    });
    expect(out?.referrer).toBe("https://example.com/sign-in");
  });

  it("leaves ordinary paths untouched", () => {
    const out = loadHandler()("event", { url: "/chat/3f2a0b1c", referrer: "" });
    expect(out?.url).toBe("/chat/3f2a0b1c");
    expect(out?.referrer).toBe("");
  });

  it("passes through non-string fields and null payloads", () => {
    expect(loadHandler()("event", null)).toBeNull();
    const out = loadHandler()("event", { url: 42, title: "t" });
    expect(out?.url).toBe(42);
    expect(out?.title).toBe("t");
  });
});
