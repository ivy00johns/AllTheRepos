#!/usr/bin/env node
/**
 * doctor.mjs — name a broken machine once, before thirty tests fail.
 *
 * Everything this app's suites need outside the repository is a thing that
 * fails *loudly* somewhere else: the native modules are compiled for exactly
 * one runtime, the C++ they are built from needs a macOS SDK that agrees with
 * the compiler, the catalog is a SQLite file in the user's own Library, and the
 * test runner is a Node this repository has an opinion about. When any of those
 * is wrong the symptom is not a sentence about the machine — it is thirty
 * failures that read like regressions in code nobody touched, or a linker tail
 * naming a `.tbd` file. Both cost a session before they cost a minute.
 *
 * This is the minute. It runs the same probes the suites do and says, in plain
 * language, which of them is unhappy and what to do about it.
 *
 * The distinction it draws, and the reason it is not simply a list of
 * complaints: **a failure is something that makes a suite fail as the tree
 * stands; a warning is something a person should know that does not.** An ABI
 * the probe calls `broken` with nothing pointing at the other runtime is a
 * failure. Natives built for Electron while the unit suite wants host is a
 * warning — `pnpm test` flips them for you. A catalog database that does not
 * exist yet is a warning, because the app creates it on first boot; one that
 * exists and does not open is not. Node outside `engines.node` is a warning:
 * the range in `package.json` is the version this project supports, and a suite
 * has been seen to pass outside it, so saying so is honest and refusing to run
 * would not be.
 *
 * Usage:
 *   pnpm run doctor
 *
 * Spelled `pnpm run`, not `pnpm doctor`, and that is not a typo: pnpm has its own
 * `doctor` subcommand, which checks its configuration and exits 0 without saying
 * anything about this machine. Bare `pnpm doctor` therefore looks like a passing
 * preflight while running none of it, so every caller — `test:full` included —
 * goes through `pnpm run`, and a unit test in `tests/unit/scripts/doctor.spec.ts`
 * holds that in place.
 *
 * Exit codes: 0 — nothing will fail a run (warnings may be printed) · 1 — a
 * check failed, and each failure is named with what to do about it.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  currentAbi,
  linkProbe,
  missingEntryPoints,
  resolveSdk,
} from "./native-toolchain.mjs";

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The runtime `pnpm test` runs under, which is what the doctor is asked next. */
const HOST_RUNTIME = "host";

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

/** A version as three numbers, ignoring any pre-release or build suffix. */
function parseVersion(version) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(version).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

/**
 * Whether one comparator — `>=22`, `<21`, `20.19.0` — holds.
 *
 * A comparator that names only a major is padded, so `>=22` accepts `22.10.3`:
 * reading it as `22.0.0` would be the same answer, but writing it down is what
 * keeps the padding from being discovered later as a bug.
 */
function holds(version, comparator) {
  const match = /^(>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,2})$/.exec(comparator.trim());
  if (!match) return false;
  const bound = parseVersion(match[2]);
  if (bound === null) return false;
  const order = compare(version, bound);

  switch (match[1] ?? "=") {
    case ">=":
      return order >= 0;
    case "<=":
      return order <= 0;
    case ">":
      return order > 0;
    case "<":
      return order < 0;
    default:
      return order === 0;
  }
}

/**
 * Whether a range — `>=20.19.0 <21 || >=22` — accepts this version.
 *
 * The `||` matters here rather than in the abstract: this repository's own
 * range is two disjoint branches with a gap between them, so a Node 21 is
 * genuinely outside it and a check that only looked at one branch, or that
 * settled for `range.includes(version)`, would call it supported.
 */
function satisfies(version, range) {
  return range
    .split("||")
    .some((branch) => branch
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((comparator) => holds(version, comparator)));
}

/**
 * The Node this is running under, against the range `package.json` declares.
 *
 * Out of range is a warning rather than a failure, deliberately: the range says
 * which Node this project supports, and a suite that passes on something else is
 * a fact worth stating, not a reason to refuse to look. It says both numbers, so
 * the reader does not have to go and find the range.
 */
export function checkNodeVersion({ version = process.version, engines = "" } = {}) {
  const range = String(engines).trim();
  if (range === "") {
    return {
      ok: true,
      detail: `node ${version} — package.json declares no engines.node to hold it to`,
    };
  }

  const parsed = parseVersion(version);
  if (parsed === null) {
    return {
      ok: false,
      warning: true,
      detail: `node ${version} is not a version this check can read; package.json wants ${range}`,
    };
  }

  if (satisfies(parsed, range)) {
    return { ok: true, detail: `node ${version} satisfies engines.node (${range})` };
  }

  return {
    ok: false,
    warning: true,
    detail: `node ${version} is outside engines.node (${range}) — install one the range names before trusting a failure to be about the code`,
  };
}

// ---------------------------------------------------------------------------
// Native modules
// ---------------------------------------------------------------------------

/**
 * Whether the native modules are usable by the runtime about to run a suite.
 *
 * Three different states are easy to confuse and cost different amounts, so they
 * are separate answers: a probe that cannot identify the ABI at all, an entry
 * point that has been deleted (a failed `node-gyp` attempt removes it before it
 * links — ATR-057), and a tree simply built for the other runtime, which the
 * suite's own first step fixes.
 *
 * An entry point that is missing *with* a source is a warning because the repair
 * is a copy of an artifact already on disk; missing with nothing to copy from is
 * a failure, because a scan then dies with `Cannot find module` the first time
 * the app is asked to read anything.
 */
export function checkNativeAbi({ abi, missing = [], needed = HOST_RUNTIME } = {}) {
  if (abi === "broken") {
    return {
      ok: false,
      detail:
        "the ABI probe cannot load better-sqlite3 and cannot tell which runtime the tree was built for — run `node scripts/ensure-native-abi.mjs host` and read what it says",
    };
  }

  const withoutSource = missing.filter((entry) => !entry.source);
  if (withoutSource.length > 0) {
    const named = withoutSource
      .map((entry) => `${entry.module} (${entry.entry})`)
      .join(", ");
    return {
      ok: false,
      detail: `no ${named} can be loaded and there is no ABI-tagged prebuild to restore it from — the app dies with "Cannot find module" the first time it scans; rebuild it with \`node scripts/ensure-native-abi.mjs ${needed}\``,
    };
  }

  const restorable = missing.filter((entry) => entry.source);
  if (restorable.length > 0) {
    const named = restorable
      .map((entry) => `${entry.module} (from ${entry.source})`)
      .join(", ");
    return {
      ok: false,
      warning: true,
      detail: `${named} is missing — a failed link deletes it before it compiles; the copy beside it is the identical artifact, and \`node scripts/ensure-native-abi.mjs ${needed}\` puts it back`,
    };
  }

  if (abi !== needed) {
    return {
      ok: false,
      warning: true,
      detail: `the native modules are built for ${abi}, and this run wants ${needed} — the suite flips them itself, or run \`node scripts/ensure-native-abi.mjs ${needed}\` first`,
    };
  }

  return { ok: true, detail: `the native modules are built for ${needed} (better-sqlite3 loads)` };
}

// ---------------------------------------------------------------------------
// macOS SDK
// ---------------------------------------------------------------------------

/**
 * Whether a native rebuild would have an SDK its compiler can read — asked of
 * the linker, not of `xcrun`.
 *
 * This is the check ATR-057 is about, and the reason it compiles something
 * rather than trusting a path: on the afternoon in question `xcrun` named an SDK
 * perfectly happily and the linker then refused to read its stubs, so a verdict
 * built on `xcrun` alone said the machine was ready and the rebuild still died.
 * `link` is that probe's answer, and a probe that fails is a *failure*: a
 * rebuild will not link, which is the most concrete thing this script can tell
 * somebody.
 *
 * The other two verdicts are unchanged. A resolver that had to *change*
 * something is a warning — the rebuild works, pointed somewhere else — and it
 * names the SDK it uses, because a warning nobody can act on is noise. A
 * resolver that found nothing usable is a failure.
 *
 * Off macOS there is nothing to pair and nothing to prove, and that is an `ok`
 * rather than a pass nobody looked at: this doctor runs as a step on CI's fast
 * job, which is `ubuntu-latest`, and reporting the absence of Xcode as a broken
 * machine would turn every Linux run red over a check that does not apply
 * there. It says which platform it is on rather than staying quiet, so a green
 * line is still a statement about this machine.
 */
export function checkSdk({ sdk, platform = process.platform, link = null } = {}) {
  if (platform !== "darwin") {
    return {
      ok: true,
      detail: `no macOS SDK to pair on ${platform} — native rebuilds here use this platform's own toolchain`,
    };
  }

  if (!sdk) {
    return {
      ok: false,
      warning: true,
      detail: "no macOS SDK was resolved for a native rebuild",
    };
  }

  const reason = sdk.reason ? ` (${sdk.reason})` : "";

  if (sdk.ok === false) {
    return {
      ok: false,
      detail: `no usable macOS SDK for a native rebuild${reason} — an ABI flip will fail to link`,
    };
  }

  if (link !== null && link.ok === false) {
    return {
      ok: false,
      detail: `a native rebuild would fail to link: ${link.detail}${reason}`,
    };
  }

  const adjusted = sdk.env !== undefined && Object.keys(sdk.env).length > 0;
  if (adjusted) {
    return {
      ok: false,
      warning: true,
      detail: `the compiler and the SDK it would link against come from different installs${reason}; a rebuild is pointed at ${sdk.sdkPath} so it can link`,
    };
  }

  if (link !== null && link.ok) {
    return {
      ok: true,
      detail: `${link.detail}${reason}`,
    };
  }

  return { ok: true, detail: `native rebuilds link against ${sdk.sdkPath}${reason}` };
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

/** Where the catalog database lives when no Electron app is around to ask. */
export function defaultDatabasePath({
  platform = process.platform,
  home = os.homedir(),
  appData = process.env.APPDATA,
} = {}) {
  // Electron's own `app.getPath("userData")`, which `src/main/index.ts` pins to
  // the name `alltherepos` — so this is the same file the app opens. Spelled out
  // rather than asked for because the doctor must run without Electron.
  //
  // Joined with the separator of the platform being described rather than the
  // one this is running on: a Windows path assembled with `/` is not the path
  // the app would open, and a check that reads `C:\\Users\\…\alltherepos.db`
  // would then be reporting on a file that never exists.
  const impl = platform === "win32" ? path.win32 : path.posix;
  const dir =
    platform === "darwin"
      ? impl.join(home, "Library", "Application Support", "alltherepos")
      : platform === "win32" && appData
        ? impl.join(appData, "alltherepos")
        : impl.join(home, ".config", "alltherepos");
  return impl.join(dir, "alltherepos.db");
}

/**
 * Open the catalog read-only and ask SQLite whether it is intact.
 *
 * Read-only, and lazily required: `better-sqlite3` is a native module, and on a
 * tree whose natives are built for the other runtime a top-level import would
 * take the whole doctor down — which is the machine this script exists for.
 * Nothing here writes, and nothing creates the file: a database that is not
 * there yet is the app's first boot, not a fault.
 */
function openCatalog(dbPath) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("pragma integrity_check").get();
    return {
      integrity: String(row?.integrity_check ?? ""),
      close: () => db.close(),
    };
  } catch (thrown) {
    db.close();
    throw thrown;
  }
}

/** True when the failure means "this file is not there yet". */
function isAbsent(error) {
  const code = error?.code ?? "";
  const message = String(error?.message ?? error);
  return (
    code === "ENOENT" ||
    code === "SQLITE_CANTOPEN" ||
    /unable to open database file|no such file|cannot open|does not exist/i.test(message)
  );
}

/** True when the failure is the native driver rather than the database. */
function isDriverMissing(error) {
  const message = String(error?.message ?? error);
  return /NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|compiled against a different Node|invalid ELF header|mach-o/i.test(
    message,
  );
}

/**
 * The catalog database: absent, opening, corrupt, or unreadable because the
 * driver itself is the wrong ABI.
 *
 * The four are worth separating. An absent file is a warning — the app creates
 * it on first boot and the suites seed their own — while a file that exists and
 * will not open is something the user needs to know about before the app tells
 * them instead. A driver that cannot be loaded is reported as the ABI problem it
 * is rather than as a corrupt catalog, because otherwise the same machine gets
 * two messages and only one of them is true.
 */
export function checkDatabase({ path: dbPath = defaultDatabasePath(), open = openCatalog } = {}) {
  let handle;
  try {
    handle = open(dbPath);
  } catch (thrown) {
    const message = String(thrown?.message ?? thrown);
    if (isDriverMissing(thrown)) {
      return {
        ok: false,
        warning: true,
        detail: `the catalog at ${dbPath} was not checked — better-sqlite3 does not load for this runtime, which is the ABI above rather than a problem with the database`,
      };
    }
    if (isAbsent(thrown)) {
      return {
        ok: false,
        warning: true,
        detail: `no catalog at ${dbPath} yet — the app creates it on first boot, so this is not a failure`,
      };
    }
    return {
      ok: false,
      detail: `the catalog at ${dbPath} exists but could not be read — ${message}`,
    };
  }

  try {
    if (handle.integrity === "ok") {
      return { ok: true, detail: `the catalog at ${dbPath} opens and reports integrity ok` };
    }
    return {
      ok: false,
      detail: `the catalog at ${dbPath} fails SQLite's own integrity check ("${handle.integrity}") — back it up before anything else touches it`,
    };
  } finally {
    handle.close?.();
  }
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/**
 * The checks sorted into the three lists the exit code is built from.
 *
 * `ok` — nothing to do. `warnings` — worth knowing, does not fail a run.
 * `failures` — a suite will fail as the tree stands. The split is the whole
 * point of the script: a wall of equally-red lines is the thing it replaces.
 */
export function assess(checks = {}) {
  const failures = [];
  const warnings = [];
  const ok = [];

  for (const result of Object.values(checks)) {
    if (!result) continue;
    if (result.ok) ok.push(result.detail);
    else if (result.warning) warnings.push(result.detail);
    else failures.push(result.detail);
  }

  return { failures, warnings, ok };
}

/** `engines.node` as written, for the version check to hold this Node to. */
function readEngines(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return manifest.engines?.node ?? "";
  } catch {
    return "";
  }
}

/** Run a probe that is allowed to fail, because the doctor must still finish. */
function safely(produce, fallback) {
  try {
    return produce();
  } catch {
    return fallback;
  }
}

/**
 * Check this machine and say what a person would have to do.
 *
 * Every probe is injectable so the verdict can be tested without the machine it
 * describes — the same shape `check-platforms.mjs` uses, and for the same
 * reason: a check that can only be exercised against one laptop is a check
 * nobody can prove works.
 *
 * @returns {number} the exit code for this process.
 */
export function run({
  root = ROOT,
  log = console.log,
  error = console.error,
  version = process.version,
  engines = null,
  platform = process.platform,
  resolve = null,
  abi = null,
  // The same two facts as a `abi`/`entryPoints` value, for a caller that would
  // rather hand over the probe than its answer. Both are honoured, and neither
  // is preferred: this is a seam, not a second API.
  probe = null,
  entryPoints = null,
  missing = null,
  sdk = null,
  link = null,
  database = null,
  open = openCatalog,
} = {}) {
  const probeAbi = abi ?? safely(() => probe?.({ root }) ?? currentAbi({ root }), "broken");
  const artifacts =
    entryPoints ?? safely(() => missing?.({ root, abi: probeAbi }) ?? missingEntryPoints({ root, abi: probeAbi }), []);
  // Nothing below this line shells out on a platform that has no macOS SDK to
  // ask about: `resolve` is not called at all off darwin, and neither is the
  // probe. A check that spawns `xcode-select` on every runner is a check that
  // eventually fails for a reason that has nothing to do with this project.
  //
  // The probe follows the same rule as every other seam here: an injected `sdk`
  // is an answer, so the caller owns the verdict and nothing is compiled against
  // a path this function was merely handed. A caller that wants the proof asks
  // for it by leaving `sdk` out — which is what the command line does.
  const sdkState =
    sdk ?? (platform === "darwin" ? safely(() => (resolve ?? resolveSdk)({}), null) : null);
  const linkState =
    link ??
    (sdk === null && platform === "darwin" && sdkState?.ok === true
      ? safely(() => linkProbe({ sdkPath: sdkState.sdkPath }), null)
      : null);

  const checks = {
    node: checkNodeVersion({
      version,
      engines: engines ?? readEngines(root),
    }),
    natives: checkNativeAbi({ abi: probeAbi, missing: artifacts, needed: HOST_RUNTIME }),
    sdk: checkSdk({ sdk: sdkState, platform, link: linkState }),
    database: checkDatabase({
      path: database ?? defaultDatabasePath(),
      open,
    }),
  };

  const { failures, warnings, ok } = assess(checks);

  for (const line of ok) log(`[doctor] ok    ${line}`);
  for (const line of warnings) log(`[doctor] warn  ${line}`);
  for (const line of failures) error(`[doctor] FAIL  ${line}`);

  if (failures.length > 0) {
    error(
      `[doctor] this machine is not ready — ${failures.length} check(s) failed${
        warnings.length > 0 ? `, ${warnings.length} warning(s)` : ""
      }`,
    );
    return 1;
  }

  log(
    `[doctor] this machine is ready${warnings.length > 0 ? ` — ${warnings.length} thing(s) worth knowing` : ""}`,
  );
  return 0;
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: on macOS `os.tmpdir()`
 * hands back `/var/folders/...` while the loader resolves it to
 * `/private/var/...`, and a string compare then quietly does nothing at all.
 */
function isMainModule() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    process.exit(run());
  } catch (thrown) {
    console.error(`[doctor] ${thrown?.message ?? thrown}`);
    process.exit(1);
  }
}
