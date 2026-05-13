import { defineConfig, devices } from "@playwright/test";

/** Layout-only E2E for the playground's Engine page.
 *
 * Tests are written against the PageShell + SidePanel + SidePanelItem
 * primitives, NOT against backend-driven data — they assume the live
 * `/api/agents` may or may not respond. Backend-dependent assertions
 * are out of scope (the "No agents registered" empty state still
 * exercises the rail chrome).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Splitter tests mutate localStorage; serialize for safety.
  retries: 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Headless by default; pass --headed via CLI to debug.
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } },
    },
  ],

  // Reuses the dev server when it's already up (yarn dev in another
  // terminal); spawns one if not. tsc -b runs before vite picks up
  // any source changes so the SDK dist is fresh.
  webServer: {
    command: "yarn dev",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
