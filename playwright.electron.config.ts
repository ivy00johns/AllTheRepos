/**
 * Phase 0 / Phase 1 Playwright config — Electron E2E only.
 *
 * Dedicated config so the Next.js dev-server config in `playwright.config.ts`
 * (port 3939, /e2e dir) is untouched. We point the test runner at the
 * Electron specs under `tests/e2e/*.spec.ts` which use `_electron.launch`
 * and do NOT need a webServer block.
 *
 * Phase 1 adds `catalog-flow.spec.ts`; both specs run sequentially in a
 * single worker so the same out/main/index.js binary isn't launched
 * twice in parallel (Electron's single-instance lock + the same userData
 * dir would cause flakes).
 *
 * Owner: qe-agent (Phase 0 / Phase 1).
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Phase 0: electron-launch.spec.ts; Phase 1: catalog-flow.spec.ts.
  testMatch: /(electron-launch|catalog-flow)\.spec\.ts$/,
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
