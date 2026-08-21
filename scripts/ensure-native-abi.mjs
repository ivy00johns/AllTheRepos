#!/usr/bin/env node
/**
 * ensure-native-abi.mjs — make the native modules match the runtime that is
 * about to consume them (ATR-016).
 *
 * `better-sqlite3` and `find-git-repositories` are compiled against exactly
 * one NODE_MODULE_VERSION. Electron and host Node use different ones, so a
 * tree built for the app cannot run the vitest suite and vice-versa. Before
 * this script, flipping was a manual `pnpm rebuild ...` that everyone forgot,
 * producing ~30 phantom "native module" failures that look like regressions
 * but aren't — and that CI has no way to resolve by hand.
 *
 * Usage:
 *   node scripts/ensure-native-abi.mjs host      # before vitest
 *   node scripts/ensure-native-abi.mjs electron  # before the app / Electron E2E
 *
 * Detection is a real load attempt rather than a marker file, so it stays
 * correct even when someone rebuilds by hand:
 *
 *   - If the module LOADS in this (host Node) process, it is host-ABI.
 *   - If it fails with a NODE_MODULE_VERSION error, it is built for some
 *     other ABI — in this repo that means Electron.
 *
 * A no-op check costs a few milliseconds; only a genuine mismatch pays for a
 * rebuild. Exit code is non-zero if the rebuild itself fails.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const target = process.argv[2];
if (target !== "host" && target !== "electron") {
  console.error("usage: node scripts/ensure-native-abi.mjs <host|electron>");
  process.exit(2);
}

/**
 * Modules rebuilt when the ABI is flipped. Keep in sync with package.json.
 */
const REBUILD_MODULES = ["better-sqlite3", "find-git-repositories"];

/**
 * The ABI probe.
 *
 * Only `better-sqlite3` is authoritative. `find-git-repositories` ships
 * per-ABI builds side by side (`bin/darwin-<arch>-<abi>/` alongside
 * `build/Release/`) and picks the right one at runtime, so it loads under
 * BOTH Electron and host Node and can never indicate which ABI the tree is
 * currently set up for. Including it made every post-rebuild verification
 * report a bogus "mixed" state.
 *
 * The expression must exercise the addon, not merely require it:
 * better-sqlite3 defers `bindings()` until the first `new Database(...)`, so
 * a bare require succeeds even against a foreign ABI — reporting a false
 * "host" whose mismatch only surfaces later as ~30 confusing test failures.
 */
const ABI_PROBE = 'const D = require("better-sqlite3"); new D(":memory:").close();';

function currentAbi() {
  const result = spawnSync(process.execPath, ["-e", ABI_PROBE], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status === 0) return "host";
  const message = `${result.stderr ?? ""}${result.stdout ?? ""}`;
  // A foreign NODE_MODULE_VERSION here means Electron — the only other ABI
  // this repo builds for.
  if (message.includes("NODE_MODULE_VERSION")) return "electron";
  console.error(message.trim());
  return "broken";
}

function run(cmd, args) {
  console.log(`[ensure-native-abi] > ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`[ensure-native-abi] ${cmd} failed`);
    process.exit(result.status ?? 1);
  }
}

const abi = currentAbi();

if (abi === target) {
  console.log(
    `[ensure-native-abi] natives already built for ${target} — skipping`,
  );
  process.exit(0);
}

console.log(
  `[ensure-native-abi] natives are "${abi}", need "${target}" — rebuilding`,
);

if (target === "host") {
  // `pnpm rebuild` recompiles against the Node running pnpm, i.e. the host.
  run("pnpm", ["rebuild", ...REBUILD_MODULES]);
} else {
  // rebuild-natives.mjs wraps electron-rebuild (with an install-app-deps
  // fallback) and targets the installed Electron's ABI.
  run("node", ["scripts/rebuild-natives.mjs"]);
}

const after = currentAbi();
if (after !== target) {
  console.error(
    `[ensure-native-abi] rebuild finished but ABI is "${after}", expected "${target}"`,
  );
  process.exit(1);
}

console.log(`[ensure-native-abi] natives now built for ${target}`);
