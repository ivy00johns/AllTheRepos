/**
 * Real-data walkthrough config.
 *
 * No `globalSetup`: unlike the suite, this run does not want a seeded template
 * profile — it drives the developer's own catalog (copied to a temp dir by the
 * spec) and `out/` + the Electron-ABI natives are already built.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /real-data-walkthrough\.spec\.ts$/,
  timeout: 900_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
