import type { NextConfig } from "next";

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
    ];
  },
};

export default nextConfig;
