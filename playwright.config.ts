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
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
