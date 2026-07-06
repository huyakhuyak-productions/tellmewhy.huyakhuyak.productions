import { defineConfig, devices } from "@playwright/test";

// Test-only secrets — deterministic values so the e2e webServer can boot
// without a .env file. Never used outside this local/CI test run.
const TEST_ENV = {
  DATABASE_URL: "postgres://tellmewhy:tellmewhy@localhost:5432/tellmewhy",
  BETTER_AUTH_SECRET: "e2e-only-secret-never-production",
  BETTER_AUTH_URL: "http://localhost:3000",
  // 32 zero-bytes base64 — same test-only KEK as src/test/setup.ts.
  MASTER_KEK: Buffer.alloc(32, 0).toString("base64"),
  AI_MOCK: "1",
};

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  // devices["iPhone 14"] defaults to the webkit engine; only chromium is
  // installed/pre-approved here, so pin the engine while keeping the device's
  // viewport/touch/UA emulation.
  projects: [{ name: "mobile", use: { ...devices["iPhone 14"], browserName: "chromium" } }],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    env: TEST_ENV,
  },
});
