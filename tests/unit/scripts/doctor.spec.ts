/**
 * Unit test for `scripts/doctor.mjs`.
 *
 * The doctor exists so a broken machine is named once, in words, instead of
 * thirty times as failures that read like regressions. What is asserted here is
 * therefore not "the checks run" but **which verdict each state gets** — because
 * the verdict is the deliverable, and getting it wrong is worse than not asking:
 * a doctor that cries failure over a Node minor version gets ignored on the day
 * it is right, and one that stays quiet about a deleted native entry point sends
 * somebody looking through `src/` for a bug that is a missing file.
 *
 * Every check is driven through its injected seams, so this suite never looks at
 * the machine it runs on: no real `node_modules` probe, no macOS SDK, and above
 * all no reading the developer's own catalog database. That last one is the
 * reason `open` and `path` exist as parameters at all — a test that opened
 * `~/Library/Application Support/alltherepos/alltherepos.db` would be both
 * non-hermetic and, on a machine mid-scan, flaky in a way nobody would believe.
 *
 * The failures each block prevents:
 *
 *   - a Node outside `engines.node` read as inside it, because a range with two
 *     branches and a gap between them is not a substring test;
 *   - an ABI left on the wrong runtime reported as a failure, when the suite's
 *     own first step fixes it — the ATR-016 mistake, in the other direction;
 *   - a deleted `findGitRepos.node` reported as a warning when there is nothing
 *     left to copy it from (ATR-057's second consequence);
 *   - an SDK mismatch (ATR-057) reported as ready because a workaround exists,
 *     without saying which SDK the workaround uses;
 *   - an SDK that `xcrun` names reported as ready when the linker would refuse
 *     to read it — which is the same failure, one layer further along, and the
 *     reason the check now compiles something instead of trusting a path;
 *   - a machine with no Xcode at all reported as broken *on Linux*, where there
 *     is no macOS SDK to pair and CI runs this same script;
 *   - a catalog that does not exist yet treated as a fault, when the app creates
 *     it on first boot;
 *   - a native driver built for the other runtime reported as a corrupt
 *     database, which names the wrong culprit on the machine this script is for.
 *
 * Imported by URL (a `.mjs` CLI with no declarations) and driven as a module,
 * which is how the other script specs here run theirs — no child process, and
 * the sentences a person would read come back as values.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "doctor.mjs");

/** This repository's own range, with the gap between its branches intact. */
const ENGINES = ">=20.19.0 <21 || >=22";

interface Check {
  ok: boolean;
  detail: string;
  warning?: boolean;
}

interface EntryPoint {
  module: string;
  entry: string;
  source?: string | null;
}

interface Sdk {
  ok: boolean;
  sdkPath: string | null;
  reason: string;
  env?: Record<string, string>;
}

interface DoctorModule {
  checkNodeVersion(options?: { version?: string; engines?: string }): Check;
  checkNativeAbi(options?: {
    abi?: string;
    missing?: EntryPoint[];
    needed?: string;
  }): Check;
  checkSdk(options?: {
    sdk?: Sdk;
    platform?: string;
    link?: { ok: boolean; detail: string } | null;
    sdkLink?: { ok: boolean; detail: string } | null;
  }): Check;
  checkDatabase(options?: {
    path?: string;
    open?: (dbPath: string) => { integrity: string; close?: () => void };
  }): Check;
  assess(checks: Record<string, Check | null>): {
    failures: string[];
    warnings: string[];
    ok: string[];
  };
  defaultDatabasePath(options?: {
    platform?: string;
    home?: string;
    appData?: string;
  }): string;
  run(options?: {
    root?: string;
    log?: (message: string) => void;
    error?: (message: string) => void;
    version?: string;
    engines?: string;
    platform?: string;
    abi?: string;
    entryPoints?: EntryPoint[];
    sdk?: Sdk | null;
    link?: { ok: boolean; detail: string } | null;
    sdkLink?: { ok: boolean; detail: string } | null;
    resolve?: (options?: unknown) => Sdk;
    database?: string;
    open?: (dbPath: string) => { integrity: string; close?: () => void };
  }): number;
}

let doctor: DoctorModule;

beforeAll(async () => {
  doctor = (await import(pathToFileURL(SCRIPT).href)) as unknown as DoctorModule;
});

describe("the Node this is running under", () => {
  test("a version inside either branch of the range passes", () => {
    // `>=20.19.0 <21 || >=22` is two branches with a gap: 20.20.0 is in the
    // first, 22.10.0 and this machine's 25.8.1 are in the second.
    for (const version of ["20.19.0", "20.20.0", "22.10.0", "25.8.1"]) {
      expect(doctor.checkNodeVersion({ version, engines: ENGINES }).ok, version).toBe(true);
    }
  });

  test("a version in the gap between the branches does not", () => {
    // The one a substring check cannot answer: "21.5.0" appears nowhere in the
    // range string, and a check that looked at one branch would pass it.
    const verdict = doctor.checkNodeVersion({ version: "21.5.0", engines: ENGINES });

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("21.5.0");
  });

  test("a version below the floor does not, and both numbers are named", () => {
    // The finding the reader needs is the pair, not the complaint: which Node
    // they have and which the project wants. Otherwise they go looking.
    for (const version of ["20.18.0", "18.20.0"]) {
      const verdict = doctor.checkNodeVersion({ version, engines: ENGINES });
      expect(verdict.ok, version).toBe(false);
      expect(verdict.detail).toContain(version);
      expect(verdict.detail).toContain(ENGINES);
    }
  });

  test("a pre-release suffix does not change the answer", () => {
    // Nightly and rc builds are what people run while debugging, and the suffix
    // is not part of the version range's arithmetic.
    expect(
      doctor.checkNodeVersion({ version: "22.10.0-nightly.20240101", engines: ENGINES }).ok,
    ).toBe(true);
  });

  test("out of range is a warning, not a failure", () => {
    // The range is what this project supports, not a gate: a suite has been seen
    // to pass outside it, so refusing to run would be a lie about what it knows.
    const verdict = doctor.checkNodeVersion({ version: "18.20.0", engines: ENGINES });

    expect(verdict.warning).toBe(true);
  });

  test("no declared range is not a complaint", () => {
    expect(doctor.checkNodeVersion({ version: "18.20.0", engines: "" }).ok).toBe(true);
  });
});

describe("the native modules", () => {
  const DELETED: EntryPoint = {
    module: "find-git-repositories",
    entry: "node_modules/find-git-repositories/build/Release/findGitRepos.node",
    source: "node_modules/find-git-repositories/bin/darwin-arm64-135/find-git-repositories.node",
  };

  test("a tree built for the other runtime is a warning naming the flip", () => {
    // ATR-016 in the other direction: `pnpm test` rebuilds for host itself, so
    // calling this a failure would make the doctor wrong on every normal
    // morning after an Electron run.
    const verdict = doctor.checkNativeAbi({ abi: "electron", missing: [], needed: "host" });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBe(true);
    expect(verdict.detail).toContain("electron");
    expect(verdict.detail).toContain("host");
    expect(verdict.detail).toContain("ensure-native-abi");
  });

  test("an entry point that was deleted, with its twin on disk, is a warning", () => {
    // ATR-057's second consequence: a failed link deletes the file the package's
    // `main` points at, and the ABI-tagged prebuild beside it is identical.
    const verdict = doctor.checkNativeAbi({ abi: "host", missing: [DELETED], needed: "host" });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBe(true);
    expect(verdict.detail).toContain("find-git-repositories");
    expect(verdict.detail).toContain("darwin-arm64-135");
  });

  test("an entry point with nothing to restore it from is a failure", () => {
    // This one stops the app rather than slowing a rebuild down: every scan dies
    // with "Cannot find module", in the window, at the top of the screen.
    const verdict = doctor.checkNativeAbi({
      abi: "host",
      missing: [{ ...DELETED, source: null }],
      needed: "host",
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBeUndefined();
    expect(verdict.detail).toContain("findGitRepos.node");
    expect(verdict.detail).toContain("Cannot find module");
  });

  test("an ABI that cannot be identified at all is a failure", () => {
    const verdict = doctor.checkNativeAbi({ abi: "broken", missing: [], needed: "host" });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBeUndefined();
    expect(verdict.detail).toContain("ensure-native-abi");
  });

  test("a tree in the right runtime with every artifact on disk passes", () => {
    expect(doctor.checkNativeAbi({ abi: "host", missing: [], needed: "host" }).ok).toBe(true);
  });
});

describe("the macOS SDK", () => {
  // Every case names `darwin` rather than inheriting this process's platform:
  // the unit suite runs on Linux in CI, and a check that silently means "not
  // applicable" there would let a real macOS regression pass in the one place
  // it is labelled as covered.
  const MAC = "darwin";
  const SHARED: Sdk = {
    ok: true,
    sdkPath: "/Xcode/MacOSX26.5.sdk",
    reason: "the same install as clang",
  };

  test("an SDK shared with the compiler passes", () => {
    const verdict = doctor.checkSdk({ sdk: SHARED, platform: MAC });

    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("/Xcode/MacOSX26.5.sdk");
  });

  test("an SDK the linker can read passes, and says it was compiled rather than assumed", () => {
    // The point of the probe: `xcrun` naming a path and the linker accepting it
    // are two different claims, and this is the second one.
    const verdict = doctor.checkSdk({
      sdk: SHARED,
      platform: MAC,
      link: {
        ok: true,
        detail: "a three-line addon compiles and links against /Xcode/MacOSX26.5.sdk",
      },
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("compiles and links");
    expect(verdict.detail).toContain("/Xcode/MacOSX26.5.sdk");
  });

  test("an SDK `xcrun` named and the linker refuses is a failure, quoted", () => {
    // ATR-057 exactly, one layer further along: the resolver was happy, and the
    // build still could not link. This is the case that used to be reported as
    // ready, which is why the check compiles something.
    const verdict = doctor.checkSdk({
      sdk: SHARED,
      platform: MAC,
      link: {
        ok: false,
        detail:
          "/usr/bin/clang++ cannot link against /Xcode/MacOSX26.5.sdk — ld: multiple errors: tapi error: malformed file",
      },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBeUndefined();
    expect(verdict.detail).toContain("tapi error: malformed file");
    expect(verdict.detail).toContain("/Xcode/MacOSX26.5.sdk");
  });

  test("an environment that cannot link, and an SDK that fixes it, is a warning with the fix in it", () => {
    /*
     * The state this machine was actually in on 2026-10-09, found by running
     * the doctor against it and then rebuilding by hand: the link a rebuild
     * performs reads the Command Line Tools SDK through the linker's default
     * search path and dies on `tapi error: malformed file`, while the same link
     * pointed at the Xcode SDK succeeds. A verdict of "ready" there is worse
     * than no verdict, and a bare failure would be a dead end — so it is a
     * warning that names both the linker's line and the variable that fixes it.
     */
    const verdict = doctor.checkSdk({
      sdk: SHARED,
      platform: MAC,
      link: {
        ok: false,
        detail:
          "/usr/bin/clang++ cannot link with the environment as a rebuild finds it — ld: multiple errors: tapi error: malformed file",
      },
      sdkLink: {
        ok: true,
        detail: "a three-line addon compiles and links against /Xcode/MacOSX26.5.sdk",
      },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBe(true);
    expect(verdict.detail).toContain("tapi error: malformed file");
    expect(verdict.detail).toContain("export SDKROOT=/Xcode/MacOSX26.5.sdk");
  });

  test("and it says when the repository's own rebuilds already point at that SDK", () => {
    // `resolveSdk` hands the rebuild the SDKROOT it needs, so on a machine like
    // this one the command a developer actually runs works — the warning is then
    // about the shell they are standing in, not about their checkout.
    const verdict = doctor.checkSdk({
      sdk: { ...SHARED, env: { SDKROOT: "/Xcode/MacOSX26.5.sdk" } },
      platform: MAC,
      link: {
        ok: false,
        detail: "clang++ cannot link with the environment as a rebuild finds it — ld: boom",
      },
      sdkLink: {
        ok: true,
        detail: "a three-line addon compiles and links against /Xcode/MacOSX26.5.sdk",
      },
    });

    expect(verdict.warning).toBe(true);
    expect(verdict.detail).toContain("the rebuild scripts here do themselves");
    expect(verdict.detail).toContain("export SDKROOT=/Xcode/MacOSX26.5.sdk");
  });

  test("and when naming the SDK does not fix it, it is a failure that says both", () => {
    // Twice-broken is not twice as hard: the second line rules out the fix the
    // first one would send somebody to try.
    const verdict = doctor.checkSdk({
      sdk: SHARED,
      platform: MAC,
      link: { ok: false, detail: "clang++ cannot link with the environment — ld: boom" },
      sdkLink: {
        ok: false,
        detail: "clang++ cannot link against /Xcode/MacOSX26.5.sdk — ld: boom",
      },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBeUndefined();
    expect(verdict.detail).toContain("does not fix it");
    expect(verdict.detail).toContain("/Xcode/MacOSX26.5.sdk");
  });

  test("a mismatch that is worked around is a warning naming the SDK it uses", () => {
    // ATR-057: the Command Line Tools SDK and the Xcode clang disagree, and the
    // rebuild only links because it is pointed elsewhere. Naming that path is
    // what makes the warning actionable rather than atmospheric.
    const verdict = doctor.checkSdk({
      sdk: {
        ...SHARED,
        reason: "the compiler and the SDK come from different installs",
        env: { SDKROOT: "/Xcode/MacOSX26.5.sdk" },
      },
      platform: MAC,
      link: {
        ok: true,
        detail: "a three-line addon compiles and links against /Xcode/MacOSX26.5.sdk",
      },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBe(true);
    expect(verdict.detail).toContain("/Xcode/MacOSX26.5.sdk");
    expect(verdict.detail).toContain("different installs");
  });

  test("no usable SDK at all is a failure, because a flip will not link", () => {
    const verdict = doctor.checkSdk({
      sdk: { ok: false, sdkPath: null, reason: "no Xcode and no Command Line Tools" },
      platform: MAC,
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBeUndefined();
    expect(verdict.detail).toContain("no Xcode and no Command Line Tools");
  });

  test("off macOS there is no SDK to pair, and that is not a broken machine", () => {
    // CI's fast job runs this script on `ubuntu-latest`. Reporting the absence
    // of Xcode as a failure there would turn every Linux run red over a check
    // that does not apply — and a check that is wrong about the runner is worse
    // than no check, because it teaches people to ignore the red.
    const verdict = doctor.checkSdk({ platform: "linux" });

    expect(verdict.ok).toBe(true);
    expect(verdict.warning).toBeUndefined();
    expect(verdict.detail).toContain("no macOS SDK");
    expect(verdict.detail).toContain("linux");
  });
});

describe("the catalog database", () => {
  const PATH_TO_DB = "/tmp/atr-doctor-spec/alltherepos.db";

  /** A thrown error shaped the way the real one arrives. */
  function failure(message: string, code: string): Error {
    return Object.assign(new Error(message), { code });
  }

  test("a database that is not there yet is a warning, not a fault", () => {
    // The app creates it on first boot and the suites seed their own, so a
    // freshly cloned machine is not broken — it is new.
    const verdict = doctor.checkDatabase({
      path: PATH_TO_DB,
      open: () => {
        throw failure("unable to open database file", "SQLITE_CANTOPEN");
      },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBe(true);
    expect(verdict.detail).toContain("first boot");
  });

  test("a database that opens and checks out passes", () => {
    const verdict = doctor.checkDatabase({
      path: PATH_TO_DB,
      open: () => ({ integrity: "ok" }),
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain(PATH_TO_DB);
  });

  test("and the connection it opened is closed again", () => {
    // A read-only handle left open holds a lock the app's own scan then waits
    // on, which would make the doctor the cause of the next mystery.
    let closed = false;
    doctor.checkDatabase({
      path: PATH_TO_DB,
      open: () => ({ integrity: "ok", close: () => { closed = true; } }),
    });

    expect(closed).toBe(true);
  });

  test("a database that fails SQLite's own check is a failure, quoted", () => {
    const verdict = doctor.checkDatabase({
      path: PATH_TO_DB,
      open: () => ({ integrity: "*** in database main *** Page 4 is never used" }),
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBeUndefined();
    expect(verdict.detail).toContain("Page 4 is never used");
  });

  test("a driver built for the other runtime is not reported as a corrupt catalog", () => {
    // Otherwise the same machine gets two messages and only one is true. The
    // ABI check above already owns this fact, and the fix is the same flip.
    const verdict = doctor.checkDatabase({
      path: PATH_TO_DB,
      open: () => {
        throw failure(
          "The module '/x/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 135. This version of Node.js requires NODE_MODULE_VERSION 140.",
          "ERR_DLOPEN_FAILED",
        );
      },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBe(true);
    expect(verdict.detail).toContain("better-sqlite3");
    expect(verdict.detail).not.toContain("corrupt");
  });

  test("a database that exists and will not open is a failure", () => {
    // Permissions, a truncated file, a directory in its place — the user needs
    // this before the app tells them, and it is not the "new machine" case.
    const verdict = doctor.checkDatabase({
      path: PATH_TO_DB,
      open: () => {
        throw failure("EACCES: permission denied", "EACCES");
      },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.warning).toBeUndefined();
    expect(verdict.detail).toContain("EACCES: permission denied");
  });

  test("the default path is Electron's userData, spelled without Electron", () => {
    // The app pins this name (`app.setName("alltherepos")`), so the doctor has to
    // agree with it or it will report on a file nobody ever opens.
    expect(doctor.defaultDatabasePath({ platform: "darwin", home: "/Users/someone" })).toBe(
      "/Users/someone/Library/Application Support/alltherepos/alltherepos.db",
    );
    expect(doctor.defaultDatabasePath({ platform: "linux", home: "/home/someone" })).toBe(
      "/home/someone/.config/alltherepos/alltherepos.db",
    );
    expect(
      doctor.defaultDatabasePath({
        platform: "win32",
        home: "C:\\Users\\someone",
        appData: "C:\\Users\\someone\\AppData\\Roaming",
      }),
    ).toBe("C:\\Users\\someone\\AppData\\Roaming\\alltherepos\\alltherepos.db");
  });
});

describe("the verdict", () => {
  test("keeps the three lists apart, because the exit code is built from them", () => {
    const { failures, warnings, ok } = doctor.assess({
      a: { ok: true, detail: "fine" },
      b: { ok: false, warning: true, detail: "worth knowing" },
      c: { ok: false, detail: "blocking" },
      d: null,
    });

    expect(ok).toEqual(["fine"]);
    expect(warnings).toEqual(["worth knowing"]);
    expect(failures).toEqual(["blocking"]);
  });
});

/**
 * Every probe injected: the doctor is never pointed at the real machine.
 *
 * At module scope rather than inside one `describe` because two of them run the
 * script, and the second is the pair of cases about *which* probes get called on
 * which platform — a verdict about the machine and a verdict about the calls
 * made to it are only comparable if they come from the same harness.
 */
function doctorOn(
  options: Partial<Parameters<DoctorModule["run"]>[0]> = {},
): { code: number; said: string[] } {
  const said: string[] = [];
  const push = (message: string): void => {
    said.push(message);
  };
  const code = doctor.run({
    version: "22.10.0",
    engines: ENGINES,
    abi: "host",
    entryPoints: [],
    sdk: { ok: true, sdkPath: "/Xcode/MacOSX26.5.sdk", reason: "the same install as clang" },
    database: "/tmp/atr-doctor-spec/alltherepos.db",
    open: () => ({ integrity: "ok" }),
    log: push,
    error: push,
    ...options,
  });
  return { code, said };
}

describe("run", () => {
  test("a machine with nothing wrong exits 0 and says so", () => {
    const { code, said } = doctorOn();

    expect(code).toBe(0);
    expect(said.some((line) => line.includes("this machine is ready"))).toBe(true);
  });

  test("warnings do not fail the run, but they are printed", () => {
    // The distinction the whole script rests on: a flipped ABI costs a rebuild,
    // not a session.
    const { code, said } = doctorOn({ abi: "electron" });

    expect(code).toBe(0);
    expect(said.some((line) => line.includes("[doctor] warn"))).toBe(true);
  });

  test("a failure exits 1 and names itself", () => {
    const { code, said } = doctorOn({ abi: "broken" });

    expect(code).toBe(1);
    expect(said.some((line) => line.includes("[doctor] FAIL"))).toBe(true);
    expect(said.some((line) => line.includes("not ready"))).toBe(true);
  });

  test("the catalog it reports on is the one it was given", () => {
    // Guards the tempting shortcut of hard-coding the developer's own path,
    // which would make every verdict here a statement about somebody's laptop.
    const { said } = doctorOn({ database: "/tmp/atr-doctor-spec/only-mine.db" });

    const aboutTheCatalog = said.filter((line) => line.includes("catalog"));
    expect(aboutTheCatalog.join("\n")).toContain("/tmp/atr-doctor-spec/only-mine.db");
    expect(aboutTheCatalog.join("\n")).not.toContain("Application Support");
  });
});

describe("what the run asks the machine, per platform", () => {
  test("on macOS the linker is asked, and a build that would not link exits 1", () => {
    // The verdict the whole probe is for: this machine has an SDK, `xcrun` is
    // happy with it, and a rebuild would still die at the link.
    const { code, said } = doctorOn({
      platform: "darwin",
      link: {
        ok: false,
        detail:
          "/usr/bin/clang++ cannot link against /Xcode/MacOSX26.5.sdk — ld: multiple errors: tapi error: malformed file",
      },
    });

    expect(code).toBe(1);
    const sdkLines = said.filter((line) => line.includes("link"));
    expect(sdkLines.join("\n")).toContain("tapi error: malformed file");
  });

  test("on macOS a build the environment cannot link, but the SDK can, still exits 0", () => {
    // The exit code is the deliverable — a warning is a machine that can build
    // once it is told where to point, and CI reads the status rather than the
    // prose.
    const { code, said } = doctorOn({
      platform: "darwin",
      link: {
        ok: false,
        detail:
          "/usr/bin/clang++ cannot link with the environment as a rebuild finds it — ld: multiple errors: tapi error: malformed file",
      },
      sdkLink: {
        ok: true,
        detail: "a three-line addon compiles and links against /Xcode/MacOSX26.5.sdk",
      },
    });

    expect(code).toBe(0);
    expect(said.some((line) => line.includes("[doctor] warn"))).toBe(true);
    expect(said.some((line) => line.includes("export SDKROOT="))).toBe(true);
    expect(said.some((line) => line.includes("[doctor] FAIL"))).toBe(false);
  });

  test("and off macOS nothing is spawned at all, not even to be told no", () => {
    // A step that shells out to `xcode-select` on every runner is a step that
    // eventually fails for a reason with nothing to do with this project — and
    // on a Linux runner there is no SDK to ask about in the first place.
    const asked: string[] = [];

    const { code, said } = doctorOn({
      platform: "linux",
      sdk: null,
      resolve: () => {
        asked.push("resolveSdk");
        return { ok: false, sdkPath: null, reason: "no developer directory" };
      },
    });

    expect(asked).toEqual([]);
    expect(code).toBe(0);
    expect(said.some((line) => line.includes("no macOS SDK"))).toBe(true);
    expect(said.some((line) => line.includes("[doctor] FAIL"))).toBe(false);
  });
});

describe("how it is invoked", () => {
  /**
   * The reason this is a test rather than a sentence in a comment: pnpm has its
   * own `doctor` subcommand. Bare `pnpm doctor` runs *that* — pnpm's check of
   * its own configuration — print nothing about this machine, and exit 0, so a
   * `test:full` written as `pnpm doctor && …` would look like a passing
   * preflight while running none of it. The shadowing is silent, which is the
   * only thing that makes it dangerous.
   */
  function scripts(): Record<string, string> {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    return manifest.scripts ?? {};
  }

  test("through `pnpm run`, so pnpm's own `doctor` cannot stand in for it", () => {
    expect(scripts().doctor).toBe("node scripts/doctor.mjs");
    expect(scripts()["test:full"]).toContain("pnpm run doctor &&");
    expect(
      scripts()["test:full"],
      "`pnpm doctor` is pnpm's own subcommand and silently runs none of this",
    ).not.toContain("pnpm doctor");
  });

  test("and the doctor is not on the two suite scripts themselves", () => {
    // It is a preflight for a person or for `test:full`, not a tax on every
    // `pnpm test` — and CI runs the suites directly, which must stay the case.
    expect(scripts().test).not.toContain("doctor");
    expect(scripts()["test:electron-e2e"]).not.toContain("doctor");
  });
});
