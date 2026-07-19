import { beforeEach, describe, expect, it } from "vitest";
import { getUmamiConfig } from "./umami";

describe("getUmamiConfig", () => {
  beforeEach(() => {
    delete process.env.UMAMI_SCRIPT_URL;
    delete process.env.UMAMI_WEBSITE_ID;
  });

  it("returns the script source and website id when both vars are set", () => {
    process.env.UMAMI_SCRIPT_URL = "https://umami.example.com/script.js";
    process.env.UMAMI_WEBSITE_ID = "2fd3f342-f002-4cc8-b131-5ae048eb71da";
    expect(getUmamiConfig()).toEqual({
      src: "https://umami.example.com/script.js",
      websiteId: "2fd3f342-f002-4cc8-b131-5ae048eb71da",
    });
  });

  it("returns null when the script URL is missing", () => {
    process.env.UMAMI_WEBSITE_ID = "2fd3f342-f002-4cc8-b131-5ae048eb71da";
    expect(getUmamiConfig()).toBeNull();
  });

  it("returns null when the website id is missing", () => {
    process.env.UMAMI_SCRIPT_URL = "https://umami.example.com/script.js";
    expect(getUmamiConfig()).toBeNull();
  });

  it("returns null when both are unset (dev, test, CI)", () => {
    expect(getUmamiConfig()).toBeNull();
  });
});
