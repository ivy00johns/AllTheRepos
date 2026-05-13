/**
 * Phase 0 Playwright config — Electron E2E only.
 *
 * Dedicated config so the Next.js dev-server config in `playwright.config.ts`
 * (port 3939, /e2e dir) is untouched. We point the test runner at
 * `tests/e2e/electron-launch.spec.ts` which uses `_electron.launch` and
 * does NOT need a webServer block.
 *
 * Owner: qe-agent (Phase 0).
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /electron-launch\.spec\.ts$/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // No `projects` and no `webServer` — Electron is launched per-test via
  // `_electron.launch`. CI / humans should run `pnpm electron:build` (or
  // the convenience wrapper at `scripts/run-electron-e2e.mjs`) first so
  // `out/main/index.js` exists.
});
