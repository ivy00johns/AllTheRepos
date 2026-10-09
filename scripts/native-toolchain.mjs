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
 *   - The mismatch itself is arithmetic, not guesswork. `xcrun` resolves an SDK
 *     from whichever developer directory is selected, and the compiler resolves
 *     from the same place — when those disagree (Xcode's clang, the Command
 *     Line Tools' SDK) the link fails in a way that reads like a broken
 *     repository. `resolveSdk` says which SDK the pair will use and, when they
 *     disagree, hands back the `SDKROOT` that fixes it.
 *
 *   - Arithmetic is not proof, though, and that is `linkProbe`. `xcrun` named an
 *     SDK on the afternoon in question and the linker then refused to read it, so
 *     a check that stops at what `xcrun` says will call the machine ready and a
 *     rebuild will still die. The probe compiles three lines into a dynamic
 *     library against the SDK in hand and lets the linker answer — the same step
 *     the rebuild fails at, a second long instead of a session.
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
 *   3. When the SDK sits inside that developer directory, the two agree and
 *      there is nothing to fix.
 *   4. When it does not, they are from two different installs, which is
 *      ATR-057 exactly. The SDK beside the compiler is the one it can read, so
 *      that is the `SDKROOT` this returns, newest version first.
 *   5. With no SDK there to point at, `ok: false` and the paths that were
 *      tried — never a made-up path, and never `ok` on a guess.
 *
 * `env` carries only what the caller has to add. Empty means "build as you
 * were".
 */
export function resolveSdk({ env = process.env, run = quietRun, listDir = defaultListDir } = {}) {
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

  if (resolved.startsWith(developer)) {
    return {
      ok: true,
      sdkPath: resolved,
      reason: `the compiler and the SDK both come from ${developer}`,
      env: {},
    };
  }

  const sdkDir = path.join(developer, SDKS_SUFFIX);
  const best = listDir(sdkDir)
    .map((name) => ({ name, version: sdkVersion(name) }))
    .filter((candidate) => candidate.version !== null)
    .sort((a, b) => compareVersions(b.version, a.version))[0];

  if (best === undefined) {
    return {
      ok: false,
      sdkPath: resolved,
      reason: `the SDK in use (${resolved}) does not come from the compiler's own install (${developer}), and that install has no MacOSX*.sdk to build against instead`,
      env: {},
    };
  }

  const sdkPath = path.join(sdkDir, best.name);
  return {
    ok: true,
    sdkPath,
    reason: `the SDK in use (${resolved}) is not from the compiler's install (${developer}); building against ${sdkPath} instead`,
    env: { SDKROOT: sdkPath },
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
