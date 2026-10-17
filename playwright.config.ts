import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/web",
  outputDir: ".cache/test-results",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:1420",
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    // Evidence runs must bind to this checkout. Reuse requires an explicit opt-in.
    reuseExistingServer: process.env.PLUMS_E2E_REUSE_SERVER === "1",
  },
  reporter: "list",
});
