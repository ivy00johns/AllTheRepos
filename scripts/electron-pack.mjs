#!/usr/bin/env node
/**
 * electron-pack.mjs — run electron-builder, and once more if the first attempt
 * dies the way a download dies.
 *
 * Why this exists. `pnpm electron:pack` failed on a macOS runner inside
 * electron-builder's `createMacApp`:
 *
 *   ENOENT: no such file or directory, rename
 *   '…/release/mac-arm64/Electron.app/Contents/MacOS/Electron'
 *   -> '…/release/mac-arm64/Electron.app/Contents/MacOS/AllTheRepos'
 *
 * immediately after `downloading … parts=6`, `retrying attempt=1`,
 * `downloaded`. That rename is electron-builder branding the Electron binary it
 * has just unpacked, so the source file was missing: the unpack had not produced
 * a complete `Electron.app`, and the download feeding it had retried a part
 * moments earlier. Re-running the same command on the same commit passed, so the
 * failure is a race in the download and unpack, not a fact about this repository
 * — and it failed the refusal job, which has nothing to do with the Electron
 * download, and red-lit `main` for a network artifact.
 *
 * So the packaging command tries, and if it fails, tries once more with
 * `-c.electronDownload.cache` pointed at an empty directory. That is the part a
 * plain re-run would not do: a cache entry the first attempt left half-written
 * would be reused by the second, and the same failure would repeat for the same
 * reason. A genuine packaging failure fails both times, exits with that status,
 * and says which attempt it was — the retry is printed, never silent.
 *
 * What this is not: a way to make a red build green. Nothing is skipped, the
 * arguments are forwarded unchanged, and the exit status is always the last
 * attempt's.
 *
 * Usage:
 *   node scripts/electron-pack.mjs --mac --dir
 *   node scripts/electron-pack.mjs --mac --dir -c.directories.output=release/older
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** How many times the command may run. Two: the failure is a race, not a loop. */
export const ATTEMPTS = 2;

/** The one argument the retry adds. Named once so the spec can hold it. */
export const CACHE_OVERRIDE = "-c.electronDownload.cache";

/** The arguments for an attempt that must not reuse the Electron download cache. */
export function withFreshCache(args, cacheDir) {
  return [...args, `${CACHE_OVERRIDE}=${cacheDir}`];
}

/**
 * Run the attempts, and stop at the first success.
 *
 * `run` and `makeCacheDir` are injected so a unit test can drive this without
 * packaging anything or downloading Electron: what belongs to the decision is
 * how many attempts happen, what the retry is given, and which status wins.
 */
export function packWithRetry({
  args,
  attempts = ATTEMPTS,
  run,
  makeCacheDir,
  log = console.log,
}) {
  let status = 1;
  let attempt = 0;

  for (attempt = 1; attempt <= attempts; attempt += 1) {
    let attemptArgs = args;
    if (attempt > 1) {
      const cacheDir = makeCacheDir();
      attemptArgs = withFreshCache(args, cacheDir);
      log(
        `[electron-pack] attempt ${attempt} of ${attempts}, with an empty ` +
          `Electron download cache: ${cacheDir}`,
      );
    }

    status = run(attemptArgs);
    if (status === 0) {
      if (attempt > 1) {
        log(`[electron-pack] attempt ${attempt} succeeded`);
      }
      return { status: 0, attempt };
    }

    log(`[electron-pack] attempt ${attempt} failed with exit code ${status}`);
  }

  return { status, attempt: attempts };
}

function main() {
  const cli = createRequire(import.meta.url).resolve("electron-builder/cli.js");
  const result = packWithRetry({
    args: process.argv.slice(2),
    run: (args) => {
      const child = spawnSync(process.execPath, [cli, ...args], {
        cwd: ROOT,
        stdio: "inherit",
        env: process.env,
      });
      return child.status ?? 1;
    },
    makeCacheDir: () => mkdtempSync(path.join(tmpdir(), "atr-electron-cache-")),
  });
  process.exit(result.status);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
