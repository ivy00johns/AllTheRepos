/**
 * Playwright Electron E2E global setup.
 *
 * Two concerns the Electron specs share at boot:
 *
 *  1. The native `.node` binaries (better-sqlite3, find-git-repositories)
 *     must match Electron's ABI (NODE_MODULE_VERSION 135 for Electron 36;
 *     `pnpm test` rebuilds them for host Node instead — 127 on Node 22, and
 *     Electron reports the mismatch as ERR_DLOPEN_FAILED), which leaves the
 *     tree in the wrong state for an Electron launch.
 *  2. `out/main/index.js` (and friends) must exist.
 *
 * This setup runs `pnpm electron:rebuild` (force `electron-rebuild -f`)
 * and `pnpm electron:build` once per suite, so the user can run
 * `pnpm exec playwright test --config playwright.electron.config.ts`
 * directly without remembering the dance.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

function run(cmd: string, args: string[]): void {
  // eslint-disable-next-line no-console
  console.log(`[e2e setup] > ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: REPO_ROOT,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `[e2e setup] ${cmd} ${args.join(" ")} exited ${result.status ?? "null"}`,
    );
  }
}

export default async function globalSetup(): Promise<void> {
  run("pnpm", ["electron:rebuild"]);
  if (!existsSync(MAIN_ENTRY)) {
    run("pnpm", ["electron:build"]);
  } else {
    // Build is fast; always run to pick up source edits since last run.
    run("pnpm", ["electron:build"]);
  }
}
