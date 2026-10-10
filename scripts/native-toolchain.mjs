/**
 * native-toolchain.mjs — the two things a broken machine needs before a native
 * rebuild can work: the artifacts a failed link has already deleted, and a
 * macOS SDK the compiler in use will actually accept.
 *
 * Both come from ATR-057, which is the afternoon a Command Line Tools update
 * left `MacOSX.sdk` pointing at SDK 27.0 and every `node-gyp` link died with
 * `tapi error: malformed file`. Two consequences of that failure are worth a
 * module rather than a paragraph in the ticket:
 *
 *   - A failed link is not harmless. `node-gyp` deletes the artifact it was
 *     about to write, so `find-git-repositories` loses
 *     `build/Release/findGitRepos.node` — the file its entry point loads — and
 *     the app then dies on every scan with `Cannot find module`. The ABI probe
 *     cannot see this: it asks `better-sqlite3`, which is still there and still
 *     loads, so the tree looks healthy right up until a scan runs. The copy
 *     that was deleted is the one the same install keeps ABI-tagged under
 *     `bin/`, so `restoreEntryPoints` puts it back rather than making somebody
 *     compile their way out of a problem that has nothing to do with the code.
 *   - The mismatch looks like arithmetic, and arithmetic is not proof — which
 *     is `linkProbe`. `xcrun` resolves an SDK from whichever developer directory
 *     is selected, and the compiler resolves from the same place; when those
 *     disagree (Xcode's clang, the Command Line Tools' SDK) the link fails in a
 *     way that reads like a broken repository. But they can also *agree* and the
 *     link still fail, because the linker reads stub files through its own
 *     search path — so `linkProbe` compiles three lines into a dynamic library
 *     and lets the linker answer, one second instead of one session.
 *
 *   - `resolveSdk` is what uses that answer. It asks the linker first, with the
 *     environment as a rebuild would find it, and only then goes looking for an
 *     SDK to point the build at — handing each candidate to the linker before it
 *     believes it. So the rebuild `ensure-native-abi.mjs` runs gets the
 *     `SDKROOT` it needs without the person at the keyboard exporting one.
 *
 * Everything here takes its world as arguments — paths, a runner, a directory
 * listing — so the spec can drive every branch without a compiler, an SDK or a
 * filesystem. Nothing prints except through an injected `log`, and nothing in
 * this module exits: the scripts that use it own their exit status.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Each native module whose entry point a failed link deletes, with the name of
 * the ABI-tagged copy the same install keeps beside it.
 *
 * `find-git-repositories` is the one that bites. `better-sqlite3` is rebuilt
 * from source on every flip and keeps no side-by-side copies, so there is
 * nothing to restore it from — which is also why it, and not this module, is
 * what the ABI probe asks.
 */
export const ENTRY_POINTS = [
  {
    module: "find-git-repositories",
    entry: "build/Release/findGitRepos.node",
    prebuildName: "find-git-repositories.node",
  },
];

const defaultExists = (target) => fs.existsSync(target);

/** A directory listing, or none at all — a missing directory is not an error. */
const defaultListDir = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

const defaultCopy = (from, to) => fs.copyFileSync(from, to);
const defaultMkdir = (dir) => fs.mkdirSync(dir, { recursive: true });

/** A file's text, or `null` when there is no such file to read. */
const defaultReadFile = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const defaultWriteFile = (file, text) => fs.writeFileSync(file, text, "utf8");

/**
 * Run a command and hand back what it said, without inheriting this process's
 * exit code or writing anything to the terminal. Every question in this module
 * is a question about the machine, not work whose output a person needs to see.
 */
function quietRun(cmd, args, env = {}) {
  const result = spawnSync(cmd, args, {
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
 * The probe.
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

/**
 * Which runtime the tree in `root` is built for: `"host"`, `"electron"`, or
 * `"broken"` when the probe fails for some other reason entirely — a missing
 * bindings file, a torn-down `node_modules`. `log` receives that message when
 * there is one, because "broken" on its own sends people looking for the
 * wrong thing.
 */
export function currentAbi({ root, probe, log = () => {} }) {
  const attempt =
    probe ??
    (() =>
      spawnSync(process.execPath, ["-e", ABI_PROBE], {
        cwd: root,
        encoding: "utf8",
      }));
  const result = attempt();
  if (result.status === 0) return "host";
  const message = `${result.stderr ?? ""}${result.stdout ?? ""}`;
  // A foreign NODE_MODULE_VERSION here means Electron — the only other ABI
  // this repo builds for.
  if (message.includes("NODE_MODULE_VERSION")) return "electron";
  log(message.trim());
  return "broken";
}

/**
 * The Electron binary this tree installed.
 *
 * Read from the package's own `path.txt` rather than by asking the electron
 * module, because that module is not importable from a plain Node process and
 * the answer is a file path either way. `null` when the install is not there.
 */
function electronBinary(root) {
  const manifest = path.join(root, "node_modules", "electron", "path.txt");
  try {
    const relative = fs.readFileSync(manifest, "utf8").trim();
    if (relative === "") return null;
    return path.join(root, "node_modules", "electron", "dist", relative);
  } catch {
    return null;
  }
}

/**
 * The NODE_MODULE_VERSION a runtime wants: this Node's own for `"host"`, or
 * Electron's, asked of the Electron binary itself with `ELECTRON_RUN_AS_NODE`
 * so it answers as Node rather than opening a window. `null` when it cannot be
 * established — which is a real answer here, not a failure to paper over: the
 * repair below then falls back to the only copy on offer instead of guessing
 * between several.
 */
export function targetAbi({ runtime, root, run = quietRun }) {
  if (runtime === "host") {
    const modules = Number(process.versions.modules);
    return Number.isInteger(modules) ? modules : null;
  }
  const binary = electronBinary(root);
  if (binary === null) return null;
  const result = run(
    binary,
    ["-e", "process.stdout.write(process.versions.modules)"],
    { ELECTRON_RUN_AS_NODE: "1" },
  );
  if (result.status !== 0) return null;
  const modules = Number((result.stdout ?? "").trim());
  return Number.isInteger(modules) ? modules : null;
}

/** The ABI number encoded in a `bin/<platform>-<arch>-<abi>` directory name. */
function abiOf(dirName, prefix) {
  const suffix = dirName.slice(prefix.length);
  const abi = Number(suffix);
  return Number.isInteger(abi) ? abi : -1;
}

/**
 * The copy of an addon to restore, or `null` when this install keeps none.
 *
 * The ABI-tagged directory whose number matches `abi` wins, because it is the
 * one built for the runtime being set up. Any other is still the same addon
 * and, for `find-git-repositories`, the same N-API artifact: when a failed
 * link deleted this tree's entry point on 2026-10-09, the copy tagged for
 * Electron was copied into `build/Release` by hand and host Node loaded it
 * happily through the whole unit suite. So a differently-tagged copy is used
 * rather than refused — newest build first — and only having none at all is
 * a dead end.
 */
function prebuildFor({ binDir, platform, arch, abi, name, exists, listDir }) {
  const prefix = `${platform}-${arch}-`;
  const tagged = listDir(binDir).filter((entry) => entry.startsWith(prefix));
  const newestFirst = [...tagged].sort(
    (a, b) => abiOf(b, prefix) - abiOf(a, prefix),
  );
  const preferred =
    abi === null
      ? []
      : tagged.filter((entry) => abiOf(entry, prefix) === abi);
  for (const dir of [...preferred, ...newestFirst]) {
    const candidate = path.join(binDir, dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Entry points that are gone, with the copy that can put each back.
 *
 * `source` is `null` when this install keeps no copy at all — a distinction
 * worth carrying rather than flattening into an empty string, because
 * restoring a *wrong* binary is worse than reporting none: it fails later,
 * somewhere unrelated, looking like a code defect.
 */
export function missingEntryPoints({
  root,
  abi = null,
  platform = process.platform,
  arch = process.arch,
  exists = defaultExists,
  listDir = defaultListDir,
}) {
  const missing = [];
  for (const point of ENTRY_POINTS) {
    const moduleDir = path.join(root, "node_modules", point.module);
    const entry = path.join(moduleDir, point.entry);
    if (exists(entry)) continue;
    missing.push({
      module: point.module,
      entry,
      source: prebuildFor({
        binDir: path.join(moduleDir, "bin"),
        platform,
        arch,
        abi,
        name: point.prebuildName,
        exists,
        listDir,
      }),
    });
  }
  return missing;
}

/**
 * Put the missing entry points back. Returns the modules repaired, so a caller
 * can say what changed; empty when there was nothing to do.
 *
 * A module with no copy to restore from is logged rather than skipped in
 * silence: the tree is only repairable by a rebuild at that point, and a scan
 * will fail in the meantime, which is worth knowing before it does.
 */
export function restoreEntryPoints({
  root,
  abi = null,
  platform = process.platform,
  arch = process.arch,
  log = () => {},
  copy = defaultCopy,
  mkdir = defaultMkdir,
  exists = defaultExists,
  listDir = defaultListDir,
}) {
  const repaired = [];
  const missing = missingEntryPoints({
    root,
    abi,
    platform,
    arch,
    exists,
    listDir,
  });
  for (const point of missing) {
    if (point.source === null) {
      log(
        `${path.relative(root, point.entry)} is gone and this install keeps no ` +
          `${platform}-${arch} copy to restore it from — only a rebuild brings ` +
          `it back, and the app cannot scan until then`,
      );
      continue;
    }
    mkdir(path.dirname(point.entry));
    copy(point.source, point.entry);
    log(
      `restored ${path.relative(root, point.entry)} from ` +
        `${path.relative(root, point.source)}`,
    );
    repaired.push(point.module);
  }
  return repaired;
}

/** Where a developer directory keeps its macOS SDKs. */
const SDKS_SUFFIX = path.join(
  "Platforms",
  "MacOSX.platform",
  "Developer",
  "SDKs",
);

/** `MacOSX26.5.sdk` → `[26, 5]`, and anything else → `null`. */
function sdkVersion(name) {
  const match = /^MacOSX(\d+(?:\.\d+)*)\.sdk$/.exec(name);
  if (match === null) return null;
  return match[1].split(".").map(Number);
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Which SDK this machine's compiler is actually paired with, and the
 * environment to build with.
 *
 * The order matters, and it is the order the failure was diagnosed in:
 *
 *   1. An `SDKROOT` already in the environment is taken at its word. Somebody
 *      who has set it has decided; overriding them would be this script
 *      arguing with the person holding the workaround.
 *   2. `xcode-select -p` names the developer directory — the one the compiler
 *      comes from — and `xcrun --sdk macosx --show-sdk-path` names the SDK a
 *      build gets by default.
 *   3. **The question those two paths cannot answer: does a link actually
 *      succeed?** The SDK a path names and the one the linker reads are not
 *      always the same document — `xcrun` names one and `ld` may then read
 *      another install's `.tbd` stubs through its own search path — so the
 *      linker is asked, with no `SDKROOT` of this file's making, exactly as a
 *      rebuild would find it. If that links, there is nothing to fix and `env`
 *      stays empty.
 *   4. When it does not, the candidates are tried in turn and each is
 *      *linked against* before it is believed: the SDK `xcrun` named first,
 *      then the ones beside the compiler, newest version first. The first that
 *      links becomes the `SDKROOT` this returns.
 *   5. When none of them links, `ok: false` with the linker's own line and the
 *      paths that were tried — never a made-up path, and never `ok` on a
 *      guess.
 *
 * Step 3 is why this is a probe and not arithmetic, and the day it was added
 * is the proof: `xcode-select` and `xcrun` agreed on Xcode, the paths were from
 * one install, and the linker still read the Command Line Tools SDK and died on
 * `tapi error: malformed file`. Trusting the paths called that machine ready and
 * a rebuild failed anyway.
 *
 * `env` carries only what the caller has to add. Empty means "build as you
 * were".
 *
 * `probe` is injectable so the question can be answered by a stub, and it is
 * handed this function's `run` so an injected runner never reaches a compiler.
 */
export function resolveSdk({
  env = process.env,
  run = quietRun,
  listDir = defaultListDir,
  probe = ({ sdkPath = null } = {}) => linkProbe({ sdkPath, run }),
} = {}) {
  const already = env.SDKROOT;
  if (typeof already === "string" && already.trim() !== "") {
    return {
      ok: true,
      sdkPath: already,
      reason: `SDKROOT is already set — building against ${already}`,
      env: {},
    };
  }

  const developer = (run("xcode-select", ["-p"]).stdout ?? "").trim();
  if (developer === "") {
    return {
      ok: false,
      sdkPath: null,
      reason:
        "xcode-select names no developer directory, so there is no SDK to build against",
      env: {},
    };
  }

  const resolved = (
    run("xcrun", ["--sdk", "macosx", "--show-sdk-path"]).stdout ?? ""
  ).trim();
  if (resolved === "") {
    return {
      ok: false,
      sdkPath: null,
      reason: `${developer} is selected but xcrun names no macOS SDK — the Command Line Tools may not be installed`,
      env: {},
    };
  }

  // The link a build actually performs, before any advice about paths.
  const asItStands = probe({});

  if (asItStands.ok) {
    return {
      ok: true,
      sdkPath: resolved,
      reason: resolved.startsWith(developer)
        ? `the compiler and the SDK both come from ${developer}, and a build links`
        : `the SDK in use (${resolved}) is not from the compiler's install (${developer}), but a build links against it as things stand`,
      env: {},
    };
  }

  const sdkDir = path.join(developer, SDKS_SUFFIX);
  const beside = listDir(sdkDir)
    .map((name) => ({ name, version: sdkVersion(name) }))
    .filter((candidate) => candidate.version !== null)
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((candidate) => path.join(sdkDir, candidate.name));

  // The SDK `xcrun` names is tried first, because it is the one a build gets by
  // default when nothing is overridden; the compiler's own install is the
  // fallback ATR-057 needed, and newest wins among those.
  const tried = [resolved, ...beside.filter((candidate) => candidate !== resolved)];
  for (const candidate of tried) {
    if (!probe({ sdkPath: candidate }).ok) continue;
    return {
      ok: true,
      sdkPath: candidate,
      reason: `a build as this machine stands would fail to link (${asItStands.detail}); pointed at ${candidate} it links, and that is the SDKROOT the rebuild is given`,
      env: { SDKROOT: candidate },
    };
  }

  return {
    ok: false,
    sdkPath: resolved,
    reason: `a build as this machine stands would fail to link (${asItStands.detail}), and pointing it at ${tried.join(", ")} does not fix it`,
    env: {},
  };
}

/** The first line of `output` mentioning any of `needles`, trimmed. */
function firstLineMentioning(output, needles) {
  for (const line of output.split(/\r?\n/)) {
    if (needles.some((needle) => line.includes(needle))) return line.trim();
  }
  return null;
}

/**
 * What to say when the output named no error at all.
 *
 * A command that could not be run reports that on the result rather than in its
 * output — `spawnSync clang++ ENOENT` — and saying "it said nothing" about a
 * compiler that is not installed would send somebody looking for a broken SDK.
 */
function firstLineOrNothing(output, result, compiler) {
  const trimmed = output.trim();
  if (trimmed !== "") return trimmed.split("\n")[0];
  if (result.error?.message) return result.error.message;
  return `${compiler} exited with status ${result.status ?? "unknown"} and said nothing`;
}

/**
 * A translation unit with nothing in it but a symbol.
 *
 * It has to be *linked*, not merely compiled, because the link is the step that
 * failed: compiling to an object file only reads headers, while a dynamic
 * library has to be linked against the SDK's `.tbd` stubs — which is where the
 * Command Line Tools SDK named architectures (`arm64e.x1-macos`) that Xcode's
 * `ld` did not know. An empty library links against libSystem, so this asks the
 * SDK the same question a native rebuild asks it.
 */
export const SDK_PROBE_SOURCE = "int atr_sdk_probe(void) { return 0; }\n";

/**
 * Where the probe's two files live, and how they are cleaned up.
 *
 * A fresh directory under the system temp dir rather than a fixed path, so two
 * probes — two doctors, or a doctor and a test — cannot overwrite each other's
 * source while the compiler is reading it.
 */
const defaultProbeFiles = {
  create() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-sdk-probe-"));
    const source = path.join(dir, "atr-sdk-probe.cc");
    const output = path.join(dir, "atr-sdk-probe.dylib");
    fs.writeFileSync(source, SDK_PROBE_SOURCE, "utf8");
    return {
      source,
      output,
      dispose() {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // A probe that cannot tidy up has still answered its question, and
          // throwing here would turn a leak into a failed check.
        }
      },
    };
  },
};

/**
 * Compile the three lines, and let the linker be the judge.
 *
 * `sdkPath` is the SDK the caller is *asking about* — `-isysroot` is passed for
 * it. Leave it out and the probe links exactly as the environment stands, which
 * is a different question and the one that matters: a rebuild links with the
 * `SDKROOT` it inherits and nothing else, so an SDK passed on this probe's
 * command line can prove a machine ready while the rebuild it stands for dies.
 * That happened here. `-isysroot <Xcode SDK>` links on a machine where
 * `node-gyp`'s own link reads the Command Line Tools SDK through the linker's
 * default search path and fails on its stub files, and the probe has to be able
 * to see both, which is why the two questions are asked separately and the
 * answers are compared by the caller (`checkSdk` in `doctor.mjs`).
 *
 * The compiler is asked of `xcrun --find clang++` rather than named, because the
 * pairing under test is exactly this: the clang `xcode-select` selects, against
 * the SDK the build would use. Naming a path here would test a compiler nobody
 * builds with.
 *
 * Never throws and never claims a verdict it did not reach: a compiler that is
 * not installed comes back as `ok: false` with the attempt in `detail`, because
 * "no toolchain" and "a toolchain that cannot read this SDK" are the same
 * answer to the question being asked — will a rebuild link?
 */
export function linkProbe({
  sdkPath = null,
  clang = null,
  run = quietRun,
  files = defaultProbeFiles,
} = {}) {
  const asked =
    clang === null
      ? (run("xcrun", ["--find", "clang++"]).stdout ?? "").trim()
      : clang;
  const compiler = asked === "" ? "clang++" : asked;
  const against =
    typeof sdkPath === "string" && sdkPath !== ""
      ? { flags: ["-isysroot", sdkPath], what: `against ${sdkPath}` }
      : {
          flags: [],
          // Deliberately not "no SDKROOT": there may be one, inherited, and this
          // probe is asking about whatever a rebuild would get from the
          // environment. The check's own sentence has the detail.
          what: "with the environment as a rebuild finds it",
        };

  const area = files.create();
  try {
    const result = run(compiler, [
      "-dynamiclib",
      ...against.flags,
      "-o",
      area.output,
      area.source,
    ]);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (result.status === 0) {
      return {
        ok: true,
        detail: `a three-line addon compiles and links ${against.what}`,
        output,
      };
    }

    // The line that named the failure when it was diagnosed by hand, so the
    // reader can judge the reading instead of trusting it.
    const reason =
      firstLineMentioning(output, ["error", "Error", "ld:"]) ??
      firstLineOrNothing(output, result, compiler);

    return {
      ok: false,
      detail: `${compiler} cannot link ${against.what} — ${reason}`,
      output,
    };
  } finally {
    area.dispose();
  }
}

// ---------------------------------------------------------------------------
// The SDK a *dependency's* build hook gets
// ---------------------------------------------------------------------------

/**
 * Where gyp looks for a file it includes into every `.gyp` it reads.
 *
 * `~/.gyp/include.gypi` is gyp's own extension point — not this repository's
 * invention — and it is the only lever that reaches a build nobody here starts:
 * a bare `pnpm rebuild <native module>` runs the *dependency's* install script
 * with the environment it inherits and nothing else, so passing `SDKROOT` to a
 * child of ours (`ensure-native-abi.mjs`, which is how `pnpm test` and
 * `test:electron-e2e` work) does nothing for the command a person types.
 */
export const GYP_INCLUDE_RELATIVE = path.join(".gyp", "include.gypi");

/**
 * The line that marks the file as this repository's to manage.
 *
 * The distinction is the whole reason this is safe to write on somebody's
 * machine: a file carrying this line was written here and can be refreshed or
 * replaced, and a file without it is theirs — an SDK they chose, or settings
 * for other projects — so it is reported rather than overwritten.
 */
export const GYP_INCLUDE_MARKER = "# Written by AllTheRepos";

/** `~/.gyp/include.gypi`, spelled for whatever home this is asked about. */
export function gypIncludePath({ home = os.homedir() } = {}) {
  return path.join(home, GYP_INCLUDE_RELATIVE);
}

/**
 * The SDK a previously-written include names, read back out of it.
 *
 * A regex over the one line this repository writes rather than a gyp parser: the
 * two callers both ask whether the SDK that file names is still the right one,
 * and the answer is the string it put between quotes. `null` covers the file
 * having no `SDKROOT` line at all, which is not an error — it is a file with
 * nothing to say about SDKs.
 */
export function sdkFromGypInclude(text) {
  const match = /'SDKROOT':\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (match === null) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return null;
  }
}

/**
 * What the include says: the SDK, and enough prose to be understood.
 *
 * The path is JSON-encoded rather than interpolated, because a string in a gyp
 * file is a Python string literal and a home directory with a quote in it would
 * otherwise end the string early and leave gyp reading a file that is not the
 * one this wrote.
 */
export function gypIncludeContents(sdkPath) {
  return [
    "# -*- mode: python; coding: utf-8 -*-",
    `${GYP_INCLUDE_MARKER} — \`pnpm install\` runs \`scripts/point-sdkroot.mjs\`,`,
    "# which put the macOS SDK it resolved here. gyp includes this file into every",
    "# `.gyp` it reads, which is how a bare `pnpm rebuild` finds an SDK its linker",
    "# can read: that build belongs to the dependency, runs its own node-gyp hook,",
    "# and sees nothing this repository passes to children of its own.",
    "#",
    "# The SDK was accepted by a real link, not chosen by a path comparison. Delete",
    "# this file (or this directory) to opt out; a native rebuild then needs",
    "# `SDKROOT` exported by hand. Run `node scripts/point-sdkroot.mjs` to refresh",
    "# it if this path ever goes away.",
    "{",
    "  'target_defaults': {",
    "    'xcode_settings': {",
    `      'SDKROOT': ${JSON.stringify(sdkPath)},`,
    "    },",
    "  },",
    "}",
    "",
  ].join("\n");
}

/**
 * Point every node-gyp build on this machine at `sdkPath`.
 *
 * Four answers, and the caller words them: it was written, it already said this,
 * somebody else's file is in the way, or the write failed. It never throws and
 * never deletes anything — a convenience that removes a file it did not create,
 * on a machine somebody else is working on, is not a convenience.
 */
export function pointGypAtSdk({
  sdkPath,
  home = os.homedir(),
  read = defaultReadFile,
  write = defaultWriteFile,
  mkdir = defaultMkdir,
} = {}) {
  const include = gypIncludePath({ home });
  const wanted = gypIncludeContents(sdkPath);
  const existing = read(include);

  if (existing !== null && !existing.includes(GYP_INCLUDE_MARKER)) {
    return {
      wrote: false,
      foreign: true,
      path: include,
      reason: `${include} exists and was not written by this repository, so it was left alone`,
    };
  }

  if (existing === wanted) {
    return {
      wrote: false,
      foreign: false,
      path: include,
      reason: `${include} already points at ${sdkPath}`,
    };
  }

  try {
    mkdir(path.dirname(include));
    write(include, wanted);
  } catch (thrown) {
    return {
      wrote: false,
      foreign: false,
      path: include,
      reason: `could not write ${include} — ${thrown?.message ?? thrown}`,
    };
  }

  return {
    wrote: true,
    foreign: false,
    path: include,
    reason:
      existing === null
        ? `wrote ${include}, which points every node-gyp build on this machine at ${sdkPath}`
        : `rewrote ${include} to point at ${sdkPath}`,
  };
}
