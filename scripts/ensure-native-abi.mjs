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
 * Detection is a real load attempt, in BOTH runtimes:
 *
 *   - loads under this (host Node) process  -> host
 *   - loads under the Electron binary       -> electron
 *   - loads under neither                   -> broken, reported as itself
 *
 * The second attempt is what keeps this honest. A probe that only asks "does
 * it load here?" can answer two ways, so every failure that is not the host's
 * own ABI gets labelled "electron" — including a module built for some *third*
 * Node ABI. On 2026-10-08 that mislabel skipped the rebuild this machine
 * needed: the tree held `better-sqlite3` at node 22's ABI 127 while the app
 * demands 135, `ensure-native-abi electron` reported "already built for
 * electron — skipping", and the app then died on launch with the
 * NODE_MODULE_VERSION error the flip had just called fine. Asking Electron
 * itself costs one extra spawn, and cannot be fooled that way.
 *
 * A matching ABI does not mean the tree is complete. `node-gyp` cannot link on
 * this machine (ATR-057), so a module whose `main` is a build output —
 * `find-git-repositories` — goes missing while the binary its publisher built
 * for exactly this ABI sits unused beside it. Whenever such a module cannot be
 * loaded, the flip installs the shipped prebuild
 * (scripts/install-native-prebuilds.mjs) and says so. One that stays missing is
 * reported loudly and does not by itself fail the flip: `better-sqlite3` is
 * what "the ABI" means here, and the scanner is exercised by the Electron suite
 * (`semantic-search.spec.ts` scans through it), which is where a genuinely
 * missing scanner belongs rather than in the way of every other gate.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PREBUILD_MODULES,
  install as installPrebuilds,
} from "./install-native-prebuilds.mjs";

const requireCjs = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Modules rebuilt when the ABI is flipped. Keep in sync with package.json.
 */
const REBUILD_MODULES = ["better-sqlite3", "find-git-repositories"];

/**
 * The ABI probe.
 *
 * Only `better-sqlite3` is authoritative. `find-git-repositories` ships
 * per-ABI builds side by side (`bin/<platform>-<arch>-<abi>/` alongside
 * `build/Release/`) and never reported the tree's ABI reliably, so including
 * it made every post-rebuild verification report a bogus "mixed" state.
 *
 * The expression must exercise the addon, not merely require it:
 * better-sqlite3 defers `bindings()` until the first `new Database(...)`, so
 * a bare require succeeds even against a foreign ABI — reporting a false
 * "host" whose mismatch only surfaces later as ~30 confusing test failures.
 */
const ABI_PROBE = 'const D = require("better-sqlite3"); new D(":memory:").close();';

/**
 * Whether a runtime can load a probe.
 *
 * `abiMismatch` separates "built for a different runtime" from "not built at
 * all" — different repairs, and conflating them is the bug this file had.
 */
export function loadAttempt({
  execPath,
  env = process.env,
  probe = ABI_PROBE,
}) {
  const result = spawnSync(execPath, ["-e", probe], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  if (result.error) {
    return { loads: false, abiMismatch: false, message: result.error.message };
  }
  const message = `${result.stderr ?? ""}${result.stdout ?? ""}`;
  return {
    loads: result.status === 0,
    abiMismatch: message.includes("NODE_MODULE_VERSION"),
    message,
  };
}

/**
 * The verdict, as data, so the truth table is testable without spawning a
 * runtime. This is the whole fix: three inputs can no longer collapse into two
 * answers.
 */
export function decideAbi({ host, electron }) {
  if (host.loads) return "host";
  if (electron.loads) return "electron";
  return "broken";
}

/** The Electron binary's path, or null when Electron is not installed. */
export function electronBinary() {
  try {
    const resolved = requireCjs("electron");
    return typeof resolved === "string" ? resolved : null;
  } catch {
    return null;
  }
}

function probeElectron() {
  const binary = electronBinary();
  if (!binary) {
    return {
      loads: false,
      abiMismatch: false,
      message: "electron is not installed",
    };
  }
  return loadAttempt({
    execPath: binary,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
}

/**
 * Which ABI the tree currently holds. Injected attempts are for tests; the
 * host probe runs first so a healthy tree never pays for the Electron spawn.
 */
export function currentAbi({ host, electron } = {}) {
  const hostAttempt = host ?? loadAttempt({ execPath: process.execPath });
  if (hostAttempt.loads) return "host";
  const electronAttempt = electron ?? probeElectron();
  return decideAbi({ host: hostAttempt, electron: electronAttempt });
}

/**
 * Where the addon `better-sqlite3`'s loader resolves to.
 *
 * This is the module "the ABI" means here, and the one `node-gyp rebuild`
 * deletes before it tries to build it.
 */
export const ADDON_PATH =
  "node_modules/better-sqlite3/build/Release/better_sqlite3.node";

/**
 * Keep the addon that is in the tree before a rebuild touches it.
 *
 * `node-gyp rebuild` is clean-then-build, and every source build fails to link
 * on this machine (ATR-057), so a failed flip does not leave the addon it
 * found — it leaves none, and a tree that worked under one runtime stops
 * loading under both. That is not hypothetical: running the flip under a Node
 * this machine keeps on `PATH` but the project does not pin (26, for which
 * `better-sqlite3` publishes no prebuild) destroyed the host addon and left
 * both suites unable to start, and only a hand repair brought it back.
 *
 * The copy goes to a temporary directory rather than beside the addon, because
 * what removes it is the clean that a failing build runs: a stash inside
 * `build/Release` is deleted with everything else there, which is how the
 * first version of this kept nothing at all.
 *
 * @returns the stash path, or null when there was nothing to keep.
 */
export function stashAddon({
  root = repoRoot,
  exists = fs.existsSync,
  copy = fs.copyFileSync,
  makeDir = fs.mkdtempSync,
  tmpDir = os.tmpdir(),
} = {}) {
  const from = resolve(root, ADDON_PATH);
  if (!exists(from)) return null;
  const to = join(makeDir(join(tmpDir, "atr-native-abi-")), basename(ADDON_PATH));
  copy(from, to);
  return to;
}

/** Put a stashed addon back, and say so. Returns whether it was restored. */
export function restoreAddon(stash, {
  root = repoRoot,
  exists = fs.existsSync,
  copy = fs.copyFileSync,
  remove = fs.rmSync,
  log = console.log,
} = {}) {
  if (!stash || !exists(stash)) return false;
  copy(stash, resolve(root, ADDON_PATH));
  remove(dirname(stash), { recursive: true, force: true });
  log(
    `[ensure-native-abi] the rebuild left no usable addon — restored the one that was here before (${ADDON_PATH})`,
  );
  return true;
}

/**
 * Why a failed flip probably failed here, as a sentence, or null when the
 * runtime in use is the one the project pins.
 *
 * The failure it names is the one that costs the most time to work out: the
 * addon has to be compiled for whichever Node is running, `better-sqlite3`
 * publishes prebuilds for a finite set of ABIs, and this machine's Command
 * Line Tools cannot link the one it would have to fall back to. That reads as
 * "the ABI is broken" rather than "you are on the wrong Node".
 */
export function pinnedRuntimeNote({ nvmrc, nodeVersion } = {}) {
  const pin = String(nvmrc ?? "").trim().replace(/^v/, "");
  const running = String(nodeVersion ?? process.version).trim().replace(/^v/, "");
  if (!pin || !running) return null;
  if (running === pin || running.startsWith(`${pin}.`)) return null;
  return (
    `this run is Node ${running}, while the project pins Node ${pin} (.nvmrc): ` +
    "the addon has to be compiled for the running runtime, and this machine's " +
    "Command Line Tools cannot link one from source (ATR-057). Re-run with the pinned Node."
  );
}

/** The version in `.nvmrc`, or null when it cannot be read. */
export function pinnedNodeVersion({ root = repoRoot, read = fs.readFileSync } = {}) {
  try {
    return String(read(resolve(root, ".nvmrc"), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

/** The NODE_MODULE_VERSION a target runtime wants, for naming prebuilds. */
export function abiNumberFor(target) {
  if (target === "host") return Number(process.versions.modules);
  const binary = electronBinary();
  if (!binary) return null;
  const result = spawnSync(
    binary,
    ["-e", "process.stdout.write(process.versions.modules)"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  if (result.status !== 0) return null;
  return Number(String(result.stdout).trim());
}

/** Run a command, reporting its status rather than exiting on it. */
function run(cmd, args) {
  console.log(`[ensure-native-abi] > ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(
      `[ensure-native-abi] ${cmd} ${args[0]} exited ${result.status ?? "null"}`,
    );
  }
  return result.status ?? 1;
}

/** Can the runtime about to consume the tree load this module at all? */
export function moduleLoads(name, target) {
  const probe = `require(${JSON.stringify(name)})`;
  if (target === "host") {
    return loadAttempt({ execPath: process.execPath, probe }).loads;
  }
  const binary = electronBinary();
  if (!binary) return false;
  return loadAttempt({
    execPath: binary,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    probe,
  }).loads;
}

/**
 * Put every prebuilt module that is missing back into the tree.
 *
 * The ABI matching is not the same question as the tree being complete, and
 * treating them as one is why `ensure-native-abi electron` could report success
 * while the scanner worker was unable to load its addon. So this runs on both
 * exits from the flip — including the one that had nothing to rebuild.
 *
 * @returns the modules that still cannot be loaded, having said so.
 */
export function ensurePrebuiltModulesLoad(
  target,
  { log = console.log, installPrebuildsFor = installPrebuilds } = {},
) {
  const unresolved = PREBUILD_MODULES.filter(
    (module) => !moduleLoads(module.name, target),
  );
  if (unresolved.length === 0) return [];

  const abiNumber = abiNumberFor(target);
  log(
    `[ensure-native-abi] ${unresolved.map((module) => module.name).join(", ")} cannot be loaded under ${target} — ` +
      `installing the shipped prebuild(s) for abi ${abiNumber ?? "unknown"}`,
  );
  installPrebuildsFor({ root: repoRoot, abi: abiNumber });

  const stillMissing = [];
  for (const module of unresolved) {
    if (moduleLoads(module.name, target)) continue;
    stillMissing.push(module.name);
    console.error(
      `[ensure-native-abi] ${module.name} STILL will not load under ${target}. The scanner ` +
        "worker requires it, so the Electron scan spec (semantic-search) is the gate that " +
        "catches this and nothing else does. On this machine the cause is the broken " +
        "CommandLineTools SDK (ATR-057); install a working SDK to rebuild it from source.",
    );
  }
  return stillMissing;
}

export function main() {
  const target = process.argv[2];
  if (target !== "host" && target !== "electron") {
    console.error("usage: node scripts/ensure-native-abi.mjs <host|electron>");
    return 2;
  }

  const abi = currentAbi();

  if (abi === target) {
    console.log(
      `[ensure-native-abi] natives already built for ${target} — skipping`,
    );
    ensurePrebuiltModulesLoad(target);
    return 0;
  }

  console.log(
    `[ensure-native-abi] natives are "${abi}", need "${target}" — rebuilding`,
  );

  // Taken before the rebuild, because `node-gyp rebuild` cleans first and a
  // link failure then leaves no addon at all rather than the one this found.
  const stash = stashAddon();

  const status =
    target === "host"
      ? run("pnpm", ["rebuild", ...REBUILD_MODULES])
      : run("node", ["scripts/rebuild-natives.mjs"]);

  let after = currentAbi();

  if (after !== target) {
    const abiNumber = abiNumberFor(target);
    console.log(
      `[ensure-native-abi] rebuild ${status === 0 ? "ran" : `exited ${status}`} but the ABI is still "${after}" — ` +
        `installing shipped prebuilds for abi ${abiNumber ?? "unknown"}`,
    );
    const { installed } = installPrebuilds({ root: repoRoot, abi: abiNumber });
    if (installed.length === 0) {
      console.error(
        "[ensure-native-abi] no shipped prebuild covers better-sqlite3, so nothing was repaired",
      );
    }
    after = currentAbi();
  }

  if (after !== target) {
    // A flip that could not be completed leaves the tree where it started,
    // and says why, rather than leaving it unable to load anything.
    const restored = after === "broken" ? restoreAddon(stash) : false;
    if (stash) fs.rmSync(dirname(stash), { recursive: true, force: true });

    console.error(
      restored
        ? `[ensure-native-abi] the flip to "${target}" did not complete, so the tree is the one you started with`
        : `[ensure-native-abi] rebuild finished but ABI is "${after}", expected "${target}"`,
    );
    const note = pinnedRuntimeNote({ nvmrc: pinnedNodeVersion() });
    if (note) console.error(`[ensure-native-abi] ${note}`);
    return 1;
  }

  if (stash) fs.rmSync(dirname(stash), { recursive: true, force: true });

  console.log(`[ensure-native-abi] natives now built for ${target}`);
  ensurePrebuiltModulesLoad(target);
  return 0;
}

/** True when this file is the program Node was asked to run. */
function isMainModule() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return (
      fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(process.argv[1])
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exit(main());
}
