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
 *
 * A rebuild that fails prints its own output and then this script's reading of
 * it, because that output names the cause only to somebody who already knows
 * which of the ways a C++ addon can fail this is — see ATR-057 in
 * `docs/REMAINING-WORK.md` for the one that cost a session. The captured text
 * is handed to `native-rebuild-doctor.mjs`; the child's status is what this
 * process exits with either way, verdict or no verdict.
 *
 * Two steps ahead of that, both from ATR-057 and both in
 * `native-toolchain.mjs`:
 *
 *   - The entry points are repaired before the probe. A failed link deletes
 *     `find-git-repositories`'s artifact rather than leaving the old one, and
 *     the probe only asks `better-sqlite3` — so without this the tree reports
 *     itself healthy and every scan then dies with `Cannot find module`.
 *   - The SDK is resolved before a rebuild and passed into the child. This
 *     machine's compiler and its SDK come from two different installs, which
 *     is the whole of ATR-057; the script now hands the build the SDK that
 *     matches the compiler rather than failing the link and explaining it
 *     afterwards.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { diagnoseNativeBuild } from "./native-rebuild-doctor.mjs";
import {
  currentAbi,
  resolveSdk,
  restoreEntryPoints,
  targetAbi,
} from "./native-toolchain.mjs";

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
 * Ask the machine a question: no output to show, no status to inherit.
 *
 * `process.env` is spread rather than replaced, so a runner can add to the
 * environment (`SDKROOT`, `ELECTRON_RUN_AS_NODE`) without taking PATH away
 * from the command it is about to run.
 */
function ask(cmd, args, env = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Run a rebuild step, showing everything it prints and keeping a copy.
 *
 * Capturing must not cost the real output: a person debugging a compile needs
 * the lines the compiler wrote, so they are written straight back out — the
 * child's stdout and stderr go to this process's own, unchanged, once it has
 * exited. The copy exists only so a failure can be read as a whole rather than
 * as whatever is still on screen.
 *
 * The buffer is generous on purpose. `spawnSync` kills a child whose output
 * outgrows it, which would turn a *successful* rebuild into a mysterious
 * failure — the one outcome this helper must never produce.
 *
 * The exit status is always the child's — `pnpm test` and CI read it, and a
 * diagnosis is no reason to turn a failure into a success.
 */
function run(cmd, args, env = process.env) {
  console.log(`[ensure-native-abi] > ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: ["inherit", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
  const stdout = result.stdout?.toString() ?? "";
  const stderr = result.stderr?.toString() ?? "";
  if (stdout !== "") process.stdout.write(stdout);
  if (stderr !== "") process.stderr.write(stderr);
  if (result.status !== 0) {
    console.error(`[ensure-native-abi] ${cmd} failed`);
    const diagnosis = diagnoseNativeBuild(`${stdout}\n${stderr}`);
    if (diagnosis) {
      console.error(`[ensure-native-abi] ${diagnosis.headline}`);
      console.error(`[ensure-native-abi] ${diagnosis.detail}`);
      console.error(`[ensure-native-abi] ${diagnosis.remedy}`);
    }
    process.exit(result.status ?? 1);
  }
}

/**
 * Put back anything a previous failed link deleted, before asking the tree
 * which ABI it is. The question the probe answers cannot see this: it loads
 * `better-sqlite3`, which a failed `find-git-repositories` link leaves alone.
 */
const repaired = restoreEntryPoints({
  root: repoRoot,
  abi: targetAbi({ runtime: target, root: repoRoot, run: ask }),
  log: (message) => {
    console.log(`[ensure-native-abi] ${message}`);
  },
});
if (repaired.length > 0) {
  console.log(
    `[ensure-native-abi] repaired ${repaired.join(", ")} — no rebuild needed for that`,
  );
}

const abi = currentAbi({
  root: repoRoot,
  log: (message) => {
    console.error(message);
  },
});

if (abi === target) {
  console.log(
    `[ensure-native-abi] natives already built for ${target} — skipping`,
  );
  process.exit(0);
}

console.log(
  `[ensure-native-abi] natives are "${abi}", need "${target}" — rebuilding`,
);

/**
 * The SDK to build against. This is the half of ATR-057 that a rebuild can
 * survive: with the SDK the compiler can read, the link that used to fail on
 * `tapi error: malformed file` succeeds. A machine where it resolves to
 * nothing is still worth telling about, but it is not a reason to refuse to
 * try — the rebuild may not need the SDK at all, and the doctor reads the
 * failure if it does.
 */
const sdk = resolveSdk({ run: ask });
console.log(`[ensure-native-abi] ${sdk.reason}`);
if (!sdk.ok) {
  console.error(
    "[ensure-native-abi] no usable macOS SDK found — a link may fail; see ATR-057 in docs/REMAINING-WORK.md",
  );
}
const rebuildEnv = { ...process.env, ...sdk.env };

if (target === "host") {
  // `pnpm rebuild` recompiles against the Node running pnpm, i.e. the host.
  run("pnpm", ["rebuild", ...REBUILD_MODULES], rebuildEnv);
} else {
  // rebuild-natives.mjs wraps electron-rebuild (with an install-app-deps
  // fallback) and targets the installed Electron's ABI.
  run("node", ["scripts/rebuild-natives.mjs"], rebuildEnv);
}

const after = currentAbi({ root: repoRoot });
if (after !== target) {
  console.error(
    `[ensure-native-abi] rebuild finished but ABI is "${after}", expected "${target}"`,
  );
  process.exit(1);
}

console.log(`[ensure-native-abi] natives now built for ${target}`);
