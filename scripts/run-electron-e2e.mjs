#!/usr/bin/env node
/**
 * Phase 0 Electron E2E runner.
 *
 * Runs `electron-vite build` to produce `out/main/index.js` (the entry
 * point the Playwright `_electron.launch` test consumes), then runs the
 * Playwright suite with the dedicated `playwright.electron.config.ts`.
 *
 * Why a wrapper script:
 *   - Playwright `_electron.launch` doesn't know how to build the app —
 *     unlike the Next.js webServer block, there's no first-class hook for
 *     it. Wrapping the two-step here means CI / humans can run a single
 *     command:  `node scripts/run-electron-e2e.mjs`
 *   - Once the infra agent adds a `test:electron-e2e` script entry to
 *     package.json (see qa-report.json findings), that script should
 *     invoke this file so the contract surface (one command) is preserved.
 *
 * Exit codes:
 *   0  — build OK, all tests passed
 *   non-zero — whatever the underlying step returned
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const skipBuild = process.argv.includes("--skip-build");

function run(cmd, args, label) {
  console.log(`\n[run-electron-e2e] ${label}: ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`[run-electron-e2e] ${label} failed with exit code ${result.status ?? "null"}`);
    process.exit(result.status ?? 1);
  }
}

// Step 1 — build (unless --skip-build).
if (!skipBuild) {
  run("pnpm", ["electron:build"], "build");
} else {
  console.log("[run-electron-e2e] --skip-build passed; reusing existing out/main/index.js");
}

// Sanity check — bail out with a clean error if the build artefact is missing.
const mainEntry = resolve(repoRoot, "out", "main", "index.js");
if (!existsSync(mainEntry)) {
  console.error(
    `[run-electron-e2e] FATAL: ${mainEntry} not found after build. Did electron-vite finish successfully?`,
  );
  process.exit(2);
}
const stat = statSync(mainEntry);
if (stat.size === 0) {
  console.error(`[run-electron-e2e] FATAL: ${mainEntry} is empty.`);
  process.exit(2);
}

// Step 2 — Playwright.
run(
  "pnpm",
  ["exec", "playwright", "test", "--config", "playwright.electron.config.ts"],
  "playwright",
);
