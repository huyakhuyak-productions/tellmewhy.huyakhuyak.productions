import { defineConfig, devices } from "@playwright/test";

// E2E_PORT lets the suite run beside a developer's real dev server on :3000
// (that server has AI_MOCK=0, so reusing it breaks every mock assertion):
//   E2E_PORT=3101 bun run test:e2e
const PORT = process.env.E2E_PORT ?? "3000";
const BASE_URL = `http://localhost:${PORT}`;

// Test-only secrets — deterministic values so the e2e webServer can boot
// without a .env file. Never used outside this local/CI test run.
const TEST_ENV = {
  DATABASE_URL: "postgres://tellmewhy:tellmewhy@localhost:5432/tellmewhy",
  BETTER_AUTH_SECRET: "e2e-only-secret-never-production",
  BETTER_AUTH_URL: BASE_URL,
  // 32 zero-bytes base64 — same test-only KEK as src/test/setup.ts.
  MASTER_KEK: Buffer.alloc(32, 0).toString("base64"),
  AI_MOCK: "1",
  PORT,
};

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: BASE_URL },
  // devices["iPhone 14"] defaults to the webkit engine; only chromium is
  // installed/pre-approved here, so pin the engine while keeping the device's
  // viewport/touch/UA emulation. Each project owns its own spec file so the
  // mobile-only and desktop-only scenarios never run under the wrong viewport.
  projects: [
    {
      name: "mobile",
      use: { ...devices["iPhone 14"], browserName: "chromium" },
      testMatch: /chat\.spec\.ts/,
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], browserName: "chromium", viewport: { width: 1440, height: 900 } },
      testMatch: /desktop\.spec\.ts/,
    },
  ],
  webServer: {
    command: "bun run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    env: TEST_ENV,
  },
});
