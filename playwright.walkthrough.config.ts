/**
 * Alpha walkthrough — a dedicated Playwright config.
 *
 * It exists only so `pnpm exec playwright test --config playwright.walkthrough.config.ts`
 * runs the one exploratory spec (`tests/e2e/alpha-walkthrough.spec.ts`) and nothing
 * else, while still reusing the real Electron global setup (`_global-setup.ts`):
 * that is what rebuilds the natives for Electron's ABI, rebuilds `out/`, and
 * seeds the private template profile every launch copies its catalog out of.
 *
 * The main Electron config keeps its own curated `testMatch`; this file does not
 * touch it, so the committed suite is unaffected.
 */

import { defineConfig } from "@playwright/test";

// Same switch the main config sets: an accessory app, no focus stealing.
process.env.ATR_E2E = "1";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /alpha-walkthrough\.spec\.ts$/,
  globalSetup: "./tests/e2e/_global-setup.ts",
  // One long, deliberate pass. The app's own cold start is ~22s (ATR-055), the
  // walkthrough adds dozens of interactions with settle waits between them.
  timeout: 900_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
