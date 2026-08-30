import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = 4173;
const baseURL = `http://${host}:${port}`;
const externallyManagedServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "../..",
  // Skill suites live with their installed skills; host-wide flows remain under apps/host/e2e.
  testMatch: ["**/apps/host/e2e/**/*.e2e.ts", "**/apps/ingest/skills/*/e2e/**/*.e2e.ts"],
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
  webServer: externallyManagedServer
    ? undefined
    : {
        command: `node node_modules/vite/bin/vite.js --host ${host} --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "pipe",
        // Keep Store requests on the page origin. The mocked lane intercepts them before Vite.
        env: { VITE_RHIZOME_API_URL: baseURL },
      },
});
