import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// The Docker image and the streaming chat both depend on build output shape —
// pin the two deployment-load-bearing settings so a config cleanup can't
// silently drop them.
describe("next.config deployment contract", () => {
  it("builds the standalone server the Docker image runs", () => {
    expect(nextConfig.output).toBe("standalone");
  });

  it("disables proxy buffering everywhere so chat replies stream through nginx", async () => {
    const headers = await nextConfig.headers!();
    const all = headers.find((rule) => rule.source === "/:path*{/}?");
    expect(all?.headers).toContainEqual({ key: "X-Accel-Buffering", value: "no" });
  });

  it("sends X-Robots-Tag: noindex over every private route tree", async () => {
    // Belt over the per-page robots metadata: these trees only ever render a
    // signed-in person's private data, so a crawler must never index them —
    // even a redirect or error response under the prefix that skips the page.
    const headers = await nextConfig.headers!();
    for (const prefix of ["/chat", "/notes", "/exercises", "/trust", "/account", "/therapist", "/link"]) {
      const rule = headers.find((r) => r.source === `${prefix}/:path*`);
      expect(rule?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex" });
    }
  });
});
