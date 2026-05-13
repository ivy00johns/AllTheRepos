#!/usr/bin/env node
/**
 * rebuild-natives.mjs
 *
 * Rebuilds native node modules (notably better-sqlite3) against the
 * Electron ABI in use. Run after `pnpm install` if better-sqlite3
 * complains about NODE_MODULE_VERSION mismatch when launching Electron.
 *
 * Phase 0: this is a thin wrapper — the canonical invocation is documented
 * here so we don't have to remember the flag soup. `electron-builder`
 * already runs `install-app-deps` in our postinstall, which handles the
 * common case. Reach for this script when you've manually swapped Electron
 * versions or when CI needs an explicit rebuild step.
 *
 * Phase 1+: we'll likely want to extend this to also rebuild fsevents and
 * any other native deps we add (e.g. node-keytar) and to detect the
 * current Electron version automatically.
 *
 * Usage:
 *   node scripts/rebuild-natives.mjs
 *   pnpm exec node scripts/rebuild-natives.mjs
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function getElectronVersion() {
  try {
    // electron package exports its version string from its main entry.
    return require("electron/package.json").version;
  } catch {
    return null;
  }
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const electronVersion = getElectronVersion();
if (!electronVersion) {
  console.error("electron is not installed. Run `pnpm install` first.");
  process.exit(1);
}

console.log(`Rebuilding native modules against Electron ${electronVersion}`);

// Canonical invocation per the plan (§7 "Packaging the native modules"):
//   electron-rebuild -f -w better-sqlite3
//
// We use `pnpm exec` so we pick up the locally installed binary without
// requiring a global install. If `@electron/rebuild` isn't installed yet
// (Phase 0 ships it transitively via electron-builder), fall back to
// `electron-builder install-app-deps`, which is the supported alternative.
// @electron/rebuild's package.json uses an `exports` map that blocks
// sub-path access, so we can't `require.resolve('@electron/rebuild/package.json')`.
// Resolve the main entry instead. The CLI bin `electron-rebuild` is only
// in node_modules/.bin/ if the package is a DIRECT dependency.
const useRebuild = (() => {
  try {
    require.resolve("@electron/rebuild");
    return true;
  } catch {
    return false;
  }
})();

if (useRebuild) {
  run("pnpm", [
    "exec",
    "electron-rebuild",
    "-f",
    "-w",
    "better-sqlite3",
    "-w",
    "find-git-repositories",
  ]);
} else {
  console.log(
    "@electron/rebuild not found — falling back to electron-builder install-app-deps",
  );
  run("pnpm", ["exec", "electron-builder", "install-app-deps"]);
}

console.log("Native modules rebuilt successfully.");
