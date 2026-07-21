import type { NextConfig } from "next";

// Route trees that only ever render a signed-in person's private data. Each
// gets an X-Robots-Tag: noindex response header (below) as a belt over the
// per-page robots metadata: the header holds even on responses that never emit
// that metadata — redirects to sign-in, error pages, and streamed API bodies
// under the same prefix. `/chat/:path*` matches the prefix itself and every
// path beneath it.
const PRIVATE_ROUTE_PREFIXES = ["/chat", "/notes", "/exercises", "/trust", "/account", "/therapist", "/link"];

const nextConfig: NextConfig = {
  // Traced minimal server for the Docker image (.next/standalone/server.js).
  output: "standalone",
  async headers() {
    return [
      {
        // Chat replies stream token-by-token; without this header nginx (the
        // Dokku proxy) buffers the whole response and the stream arrives at once.
        source: "/:path*{/}?",
        headers: [{ key: "X-Accel-Buffering", value: "no" }],
      },
      ...PRIVATE_ROUTE_PREFIXES.map((prefix) => ({
        source: `${prefix}/:path*`,
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      })),
    ];
  },
};

export default nextConfig;
