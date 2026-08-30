import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = 4173;
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // Bun discovers *.spec.ts itself. A distinct suffix keeps the browser suite in its own lane.
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "../../.rhizome/playwright",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Run the test server through Vite's Node entry point. Fresh Linux runners intermittently
    // left the Bun-hosted process alive without accepting Playwright's readiness probe.
    command: `node node_modules/vite/bin/vite.js --host ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    // Keep Store requests on the page origin. The mocked lane intercepts them before Vite.
    env: { VITE_RHIZOME_API_URL: baseURL },
  },
});
