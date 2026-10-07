/**
 * Phase 0 / Phase 1 Playwright config — Electron E2E only.
 *
 * Dedicated config so the Next.js dev-server config in `playwright.config.ts`
 * (port 3939, /e2e dir) is untouched. We point the test runner at the
 * Electron specs under `tests/e2e/*.spec.ts` which use `_electron.launch`
 * and do NOT need a webServer block.
 *
 * Phase 1 adds `catalog-flow.spec.ts`; the specs run sequentially in a single
 * worker. Every launch goes through `tests/e2e/_launch-app.ts`, which hands it
 * a private `--user-data-dir` — without that, the app's single-instance lock
 * collides with a copy the developer already has open and the launch quits
 * with exit 0 before any window exists.
 *
 * Owner: qe-agent (Phase 0 / Phase 1).
 */

import { defineConfig } from "@playwright/test";

// Mark the whole run as E2E. Every spec spreads `...process.env` into its
// `_electron.launch({ env })`, so setting it here reaches all of them without
// touching a single spec. The main process uses it to show the window
// inactive and to hide the dock icon, so a run no longer steals focus.
process.env.ATR_E2E = "1";

export default defineConfig({
  testDir: "./tests/e2e",
  // Phase 0: electron-launch.spec.ts; Phase 1: catalog-flow.spec.ts;
  // Phase 2: palette-flow.spec.ts (in-app Cmd+K command palette);
  // Phase 3a: process-flow.spec.ts + launcher-flow.spec.ts;
  // Phase 3b: claude-flow.spec.ts (Claude tab on repo detail);
  // curated links: curate-link-flow.spec.ts — builds its own profile and
  // seeds its own git repos, because it needs to drive git-backed reads.
  // Everything else shares the seeded template profile built in global setup
  // (see tests/e2e/_global-setup.ts).
  // packaged-update-check.spec.ts also matches, but skips itself unless
  // ATR_PACKAGED_UPDATE_E2E is set and a packaged app exists (`pnpm
  // test:packaged-update`): it launches the real bundle and needs the network.
  // The release rehearsal runs that same script with
  // ATR_PACKAGED_UPDATE_BEHIND_BUNDLE set to its own scratch build, whose
  // version is below the feed by construction.
  testMatch:
    /(electron-launch|catalog-flow|palette-flow|process-flow|launcher-flow|claude-flow|curate-link-flow|packaged-update-check)\.spec\.ts$/,
  // Rebuild native modules for Electron's ABI + rebuild the bundle
  // BEFORE any spec runs. Without this, switching between
  // `pnpm test` (host Node ABI) and Electron E2E breaks the .node loader.
  globalSetup: "./tests/e2e/_global-setup.ts",
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
