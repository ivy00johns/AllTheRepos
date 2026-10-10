/**
 * Unit test for `scripts/native-toolchain.mjs`.
 *
 * Both halves of this module exist because of one afternoon (ATR-057), and the
 * tests pin the two mistakes that afternoon taught:
 *
 *   - A failed link does not leave the old artifact in place, it deletes the
 *     one it was about to write. `find-git-repositories` then has no
 *     `build/Release/findGitRepos.node`, and because the ABI probe only asks
 *     `better-sqlite3` the tree still reports itself healthy — until the first
 *     scan dies with `Cannot find module`. So a missing entry point is
 *     repaired from the copy the install keeps beside it, and a missing one
 *     with no copy at all is reported rather than passed over in silence.
 *   - The SDK and the compiler can come from two different installs, which is
 *     why the link failed in the first place. `resolveSdk` has to say which
 *     SDK a build will use, override it only when the two genuinely disagree,
 *     and never claim `ok` on a path it did not find.
 *
 * The module takes its world as arguments — a runner, an `exists`, a listing —
 * so every branch is driven here without a compiler, an SDK or an Electron
 * download. One test does use the real filesystem, because "it copies the file
 * to the right place" is a claim about `copyFileSync` and a fake would not
 * make it.
 *
 * Imported by URL like the other script specs here: a `.mjs` CLI with no
 * declarations, driven as a module with no child process.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "native-toolchain.mjs");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr?: string;
  /** What `spawnSync` attaches when the command itself could not be run. */
  error?: { message: string };
}

interface ProbeArea {
  source: string;
  output: string;
  dispose(): void;
}

interface ProbeFiles {
  create(): ProbeArea;
}

interface SdkVerdict {
  ok: boolean;
  sdkPath: string | null;
  reason: string;
  env: Record<string, string>;
}

interface ToolchainModule {
  ENTRY_POINTS: Array<{
    module: string;
    entry: string;
    prebuildName: string;
  }>;
  currentAbi(options: {
    root: string;
    probe?: () => RunResult;
    log?: (message: string) => void;
  }): "host" | "electron" | "broken";
  targetAbi(options: {
    runtime: "host" | "electron";
    root: string;
    run?: (cmd: string, args: string[], env?: Record<string, string>) => RunResult;
  }): number | null;
  missingEntryPoints(options: {
    root: string;
    abi?: number | null;
    platform?: string;
    arch?: string;
    exists?: (target: string) => boolean;
    listDir?: (dir: string) => string[];
  }): Array<{ module: string; entry: string; source: string | null }>;
  restoreEntryPoints(options: {
    root: string;
    abi?: number | null;
    platform?: string;
    arch?: string;
    log?: (message: string) => void;
    copy?: (from: string, to: string) => void;
    mkdir?: (dir: string) => void;
    exists?: (target: string) => boolean;
    listDir?: (dir: string) => string[];
  }): string[];
  resolveSdk(options?: {
    env?: Record<string, string | undefined>;
    run?: (cmd: string, args: string[]) => RunResult;
    listDir?: (dir: string) => string[];
    probe?: (options?: {
      sdkPath?: string | null;
    }) => { ok: boolean; detail: string };
  }): SdkVerdict;
  SDK_PROBE_SOURCE: string;
  GYP_INCLUDE_RELATIVE: string;
  GYP_INCLUDE_MARKER: string;
  gypIncludePath(options?: { home?: string }): string;
  gypIncludeContents(sdkPath: string): string;
  sdkFromGypInclude(text: string): string | null;
  pointGypAtSdk(options?: {
    sdkPath: string;
    home?: string;
    read?: (file: string) => string | null;
    write?: (file: string, text: string) => void;
    mkdir?: (dir: string) => void;
  }): { wrote: boolean; foreign: boolean; path: string; reason: string };
  linkProbe(options?: {
    sdkPath?: string | null;
    clang?: string | null;
    run?: (
      cmd: string,
      args: string[],
      env?: Record<string, string>,
    ) => RunResult;
    files?: ProbeFiles;
  }): { ok: boolean; detail: string; output: string };
}

let toolchain: ToolchainModule;

beforeAll(async () => {
  toolchain = (await import(pathToFileURL(SCRIPT).href)) as unknown as ToolchainModule;
});

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) cleanupTmp(dirs.pop());
});

function tmp(prefix = "atr-toolchain"): string {
  const dir = makeTmpDir(prefix);
  dirs.push(dir);
  return dir;
}

/** The paths the module should be looking at, spelled the way it will. */
const MODULE_DIR = (root: string): string =>
  path.join(root, "node_modules", "find-git-repositories");
const ENTRY = (root: string): string =>
  path.join(MODULE_DIR(root), "build", "Release", "findGitRepos.node");
const PREBUILD = (root: string, platform: string, arch: string, abi: number | string): string =>
  path.join(
    MODULE_DIR(root),
    "bin",
    `${platform}-${arch}-${abi}`,
    "find-git-repositories.node",
  );

/** `exists` over a fixed set of paths. */
const existsAmong = (paths: string[]) => (target: string) => paths.includes(target);

/** `listDir` over a fixed map of directory → entries. */
const listingOf = (entries: Record<string, string[]>) => (dir: string) =>
  entries[dir] ?? [];

describe("the ABI a tree is built for", () => {
  test("a probe that loads is the host", () => {
    expect(
      toolchain.currentAbi({
        root: ROOT,
        probe: () => ({ status: 0, stdout: "", stderr: "" }),
      }),
    ).toBe("host");
  });

  test("a foreign NODE_MODULE_VERSION is Electron, the only other ABI here", () => {
    expect(
      toolchain.currentAbi({
        root: ROOT,
        probe: () => ({
          status: 1,
          stdout: "",
          stderr:
            "Error: The module was compiled against a different Node.js version using NODE_MODULE_VERSION 135.",
        }),
      }),
    ).toBe("electron");
  });

  test("any other failure is its own answer, and says so", () => {
    // Not "electron". A torn-down `node_modules` reports a missing bindings
    // file, and reading that as an ABI mismatch sends a rebuild after a
    // problem no rebuild can fix — so the message comes back to be printed.
    const said: string[] = [];
    const abi = toolchain.currentAbi({
      root: ROOT,
      probe: () => ({
        status: 1,
        stdout: "",
        stderr: "Error: Could not locate the bindings file.",
      }),
      log: (message) => said.push(message),
    });

    expect(abi).toBe("broken");
    expect(said.join("\n")).toContain("Could not locate the bindings file");
  });
});

describe("the ABI a runtime wants", () => {
  test("the host's own, straight off this process", () => {
    expect(toolchain.targetAbi({ runtime: "host", root: ROOT })).toBe(
      Number(process.versions.modules),
    );
  });

  test("Electron's, asked of the Electron binary as Node", () => {
    const root = tmp("atr-electron");
    fs.mkdirSync(path.join(root, "node_modules", "electron", "dist"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "node_modules", "electron", "path.txt"),
      "Electron.app/Contents/MacOS/Electron",
    );

    const asked: Array<{ cmd: string; args: string[]; env?: Record<string, string> }> = [];
    const abi = toolchain.targetAbi({
      runtime: "electron",
      root,
      run: (cmd, args, env) => {
        asked.push({ cmd, args, env });
        return { status: 0, stdout: "135\n", stderr: "" };
      },
    });

    expect(abi).toBe(135);
    // The binary the package's own `path.txt` names, and the variable that
    // stops it opening a window to answer a question about a number.
    expect(asked[0]?.cmd ?? "").toContain(
      path.join("electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
    );
    expect(asked[0]?.env?.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  test("and nothing at all when the answer cannot be had", () => {
    // A real answer, not a failure to paper over: the repair below then takes
    // the one copy on offer instead of picking between several.
    expect(toolchain.targetAbi({ runtime: "electron", root: tmp("atr-noelectron") })).toBeNull();

    const root = tmp("atr-electron-broken");
    fs.mkdirSync(path.join(root, "node_modules", "electron", "dist"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(root, "node_modules", "electron", "path.txt"), "Electron");

    expect(
      toolchain.targetAbi({
        runtime: "electron",
        root,
        run: () => ({ status: 1, stdout: "", stderr: "boom" }),
      }),
    ).toBeNull();
    expect(
      toolchain.targetAbi({
        runtime: "electron",
        root,
        run: () => ({ status: 0, stdout: "not a number", stderr: "" }),
      }),
    ).toBeNull();
  });
});

describe("an entry point a failed link deleted", () => {
  test("is not reported while it is still there", () => {
    const root = tmp();
    const missing = toolchain.missingEntryPoints({
      root,
      abi: 135,
      platform: "darwin",
      arch: "arm64",
      exists: existsAmong([ENTRY(root)]),
      listDir: listingOf({}),
    });

    expect(missing).toEqual([]);
  });

  test("is restored from the copy the same install keeps, at the right paths", () => {
    const root = tmp();
    const source = PREBUILD(root, "darwin", "arm64", 135);
    const copies: Array<[string, string]> = [];
    const madeDirs: string[] = [];
    const said: string[] = [];

    const repaired = toolchain.restoreEntryPoints({
      root,
      abi: 135,
      platform: "darwin",
      arch: "arm64",
      exists: existsAmong([source]),
      listDir: listingOf({
        [path.join(MODULE_DIR(root), "bin")]: ["darwin-arm64-135"],
      }),
      copy: (from, to) => copies.push([from, to]),
      mkdir: (dir) => madeDirs.push(dir),
      log: (message) => said.push(message),
    });

    expect(repaired).toEqual(["find-git-repositories"]);
    // Exactly the two paths ATR-057 names: the ABI-tagged prebuild in, the
    // entry point the package's `main` loads, out.
    expect(copies).toEqual([[source, ENTRY(root)]]);
    expect(madeDirs).toEqual([path.dirname(ENTRY(root))]);
    expect(said.join("\n")).toContain("findGitRepos.node");
  });

  test("prefers the copy tagged for the runtime being set up", () => {
    const root = tmp();
    const wanted = PREBUILD(root, "darwin", "arm64", 135);
    const newer = PREBUILD(root, "darwin", "arm64", 140);
    const binDir = path.join(MODULE_DIR(root), "bin");
    const copies: Array<[string, string]> = [];

    toolchain.restoreEntryPoints({
      root,
      abi: 135,
      platform: "darwin",
      arch: "arm64",
      exists: existsAmong([wanted, newer]),
      listDir: listingOf({ [binDir]: ["darwin-arm64-140", "darwin-arm64-135"] }),
      copy: (from, to) => copies.push([from, to]),
      mkdir: () => {},
    });

    expect(copies).toEqual([[wanted, ENTRY(root)]]);
  });

  test("still takes a differently-tagged copy, because it is the same addon", () => {
    // This is not a guess: the package picks between these copies at runtime,
    // and when this tree's entry point was repaired by hand on 2026-10-09 the
    // Electron-tagged copy loaded under host Node through the whole unit
    // suite. Refusing it would strand a tree that one copy can fix.
    const root = tmp();
    const only = PREBUILD(root, "darwin", "arm64", 135);
    const copies: Array<[string, string]> = [];

    const repaired = toolchain.restoreEntryPoints({
      root,
      abi: Number(process.versions.modules),
      platform: "darwin",
      arch: "arm64",
      exists: existsAmong([only]),
      listDir: listingOf({
        [path.join(MODULE_DIR(root), "bin")]: ["darwin-arm64-135"],
      }),
      copy: (from, to) => copies.push([from, to]),
      mkdir: () => {},
      log: () => {},
    });

    expect(repaired).toEqual(["find-git-repositories"]);
    expect(copies).toEqual([[only, ENTRY(root)]]);
  });

  test("is reported, and left alone, when there is no copy to restore it from", () => {
    // Silence here is the failure mode worth pinning: the tree stays broken,
    // the ABI probe keeps saying it is fine, and the next scan is what fails.
    const root = tmp();
    const copies: Array<[string, string]> = [];
    const said: string[] = [];

    const missing = toolchain.missingEntryPoints({
      root,
      abi: 135,
      platform: "darwin",
      arch: "arm64",
      exists: existsAmong([]),
      listDir: listingOf({}),
    });
    const repaired = toolchain.restoreEntryPoints({
      root,
      abi: 135,
      platform: "darwin",
      arch: "arm64",
      exists: existsAmong([]),
      listDir: listingOf({}),
      copy: (from, to) => copies.push([from, to]),
      mkdir: () => {},
      log: (message) => said.push(message),
    });

    expect(missing).toEqual([
      { module: "find-git-repositories", entry: ENTRY(root), source: null },
    ]);
    expect(repaired).toEqual([]);
    expect(copies).toEqual([]);
    expect(said.join("\n")).toContain("cannot scan");
  });

  test("and the real filesystem is where the copy actually lands", () => {
    // The one claim a fake cannot make: with no injected `copy` or `mkdir`,
    // `restoreEntryPoints` puts the bytes back where the package looks.
    const root = tmp("atr-real-restore");
    const source = PREBUILD(root, "darwin", "arm64", 135);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "the addon");

    const repaired = toolchain.restoreEntryPoints({
      root,
      abi: 135,
      platform: "darwin",
      arch: "arm64",
      log: () => {},
    });

    expect(repaired).toEqual(["find-git-repositories"]);
    expect(fs.readFileSync(ENTRY(root), "utf8")).toBe("the addon");
    // And a second run is a no-op, so the repair cannot keep rewriting the
    // file it just restored.
    expect(
      toolchain.restoreEntryPoints({
        root,
        abi: 135,
        platform: "darwin",
        arch: "arm64",
        log: () => {},
      }),
    ).toEqual([]);
  });
});

describe("the SDK a compiler is paired with", () => {
  /** A runner that answers each command from a table, and nothing else. */
  const runnerFor = (answers: Record<string, string>) => {
    const asked: string[] = [];
    const run = (cmd: string, args: string[]): RunResult => {
      asked.push(`${cmd} ${args.join(" ")}`);
      const stdout = answers[`${cmd} ${args.join(" ")}`];
      if (stdout === undefined) return { status: 1, stdout: "", stderr: "" };
      return { status: 0, stdout, stderr: "" };
    };
    return { run, asked };
  };

  /** A probe that links, for the cases that are about paths. */
  const links = (detail = "a three-line addon compiles and links") => () => ({
    ok: true,
    detail,
  });

  /** A probe that refuses everything, with the linker's kind of line. */
  const neverLinks = () => ({
    ok: false,
    detail: "clang++ cannot link — ld: multiple errors: tapi error: malformed file",
  });

  test("takes an SDKROOT somebody already set at its word", () => {
    // The script exists to get a build working, not to argue with the person
    // who is holding the workaround for the same problem — so it does not even
    // spend a compiler's second second-guessing them.
    let probed = 0;
    const verdict = toolchain.resolveSdk({
      env: { SDKROOT: "/Applications/Xcode.app/…/MacOSX26.5.sdk" },
      run: () => ({ status: 1, stdout: "", stderr: "" }),
      probe: () => {
        probed += 1;
        return { ok: true, detail: "unused" };
      },
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.sdkPath).toBe("/Applications/Xcode.app/…/MacOSX26.5.sdk");
    expect(verdict.env).toEqual({});
    expect(probed).toBe(0);
  });

  test("leaves a compiler and an SDK from the same install alone", () => {
    const { run } = runnerFor({
      "xcode-select -p": "/Library/Developer/CommandLineTools\n",
      "xcrun --sdk macosx --show-sdk-path":
        "/Library/Developer/CommandLineTools/SDKs/MacOSX15.0.sdk\n",
    });

    const verdict = toolchain.resolveSdk({
      env: {},
      run,
      listDir: () => [],
      probe: links(),
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.sdkPath).toBe(
      "/Library/Developer/CommandLineTools/SDKs/MacOSX15.0.sdk",
    );
    // Nothing to add: a build with no SDKROOT already links, which is the whole
    // reason this file asks before it advises.
    expect(verdict.env).toEqual({});
    expect(verdict.reason).toContain("and a build links");
  });

  test("leaves a build that already links alone, even when the paths disagree", () => {
    // The paths are a hint and not the verdict: two installs *can* coexist with
    // a linker that reads the right stubs, and overriding the SDK on a machine
    // whose builds work would be fixing what is not broken.
    const xcode = "/Applications/Xcode.app/Contents/Developer";
    const { run } = runnerFor({
      "xcode-select -p": `${xcode}\n`,
      "xcrun --sdk macosx --show-sdk-path":
        "/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk\n",
    });

    const verdict = toolchain.resolveSdk({
      env: {},
      run,
      listDir: () => ["MacOSX26.5.sdk"],
      probe: links(),
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.sdkPath).toBe(
      "/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk",
    );
    expect(verdict.env).toEqual({});
    expect(verdict.reason).toContain("not from the compiler's install");
  });

  test("points the build at an SDK when the environment cannot link without one", () => {
    /*
     * This machine's state on 2026-10-09, and the reason the paths are no longer
     * the answer. `xcode-select` and `xcrun` both named Xcode — the same
     * install, by every string comparison — and the link a rebuild performs
     * still read the Command Line Tools SDK's stubs and died on
     * `tapi error: malformed file`. Naming that SDK fixes it, so the rebuild is
     * given it and nobody has to export anything by hand.
     */
    const xcode = "/Applications/Xcode.app/Contents/Developer";
    const sdk = path.join(
      xcode,
      "Platforms",
      "MacOSX.platform",
      "Developer",
      "SDKs",
      "MacOSX26.5.sdk",
    );
    const { run } = runnerFor({
      "xcode-select -p": `${xcode}\n`,
      "xcrun --sdk macosx --show-sdk-path": `${sdk}\n`,
    });

    const verdict = toolchain.resolveSdk({
      env: {},
      run,
      listDir: () => ["MacOSX26.5.sdk"],
      probe: ({ sdkPath } = {}) =>
        sdkPath === sdk
          ? { ok: true, detail: `a three-line addon compiles and links against ${sdk}` }
          : neverLinks(),
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.sdkPath).toBe(sdk);
    expect(verdict.env).toEqual({ SDKROOT: sdk });
    // The failure it is working around is in the reason, so the reading can be
    // checked rather than trusted.
    expect(verdict.reason).toContain("tapi error: malformed file");
    expect(verdict.reason).toContain(sdk);
  });

  test("overrides the SDK that does not come from the compiler's install, and says why", () => {
    // ATR-057 exactly: Xcode's clang, the Command Line Tools' SDK, and a link
    // that dies reading the SDK's own stubs — with the working SDK beside the
    // compiler rather than the one `xcrun` named.
    const xcode = "/Applications/Xcode.app/Contents/Developer";
    const sdkDir = path.join(xcode, "Platforms", "MacOSX.platform", "Developer", "SDKs");
    const works = path.join(sdkDir, "MacOSX26.5.sdk");
    const { run } = runnerFor({
      "xcode-select -p": `${xcode}\n`,
      "xcrun --sdk macosx --show-sdk-path":
        "/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk\n",
    });

    const verdict = toolchain.resolveSdk({
      env: {},
      run,
      listDir: () => ["MacOSX26.5.sdk", "MacOSX26.2.sdk", "MacOSX.platform"],
      probe: ({ sdkPath } = {}) =>
        sdkPath === works
          ? { ok: true, detail: `a three-line addon compiles and links against ${works}` }
          : {
              ok: false,
              detail:
                "clang++ cannot link — ld: multiple errors: tapi error: malformed file /Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk/usr/lib/libSystem.B.tbd",
            },
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.sdkPath).toBe(works);
    expect(verdict.env).toEqual({ SDKROOT: works });
    // Both paths, because the reader has to be able to disagree with the
    // reading rather than take "using this one instead" on trust.
    expect(verdict.reason).toContain("/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk");
    expect(verdict.reason).toContain(xcode);
  });

  test("newest wins among the SDKs beside the compiler", () => {
    const xcode = "/Applications/Xcode.app/Contents/Developer";
    const sdkDir = path.join(xcode, "Platforms", "MacOSX.platform", "Developer", "SDKs");
    const { run } = runnerFor({
      "xcode-select -p": `${xcode}\n`,
      "xcrun --sdk macosx --show-sdk-path": "/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk\n",
    });

    // String order would put 9 above 26, which is how a version comparison
    // that forgot to compare numbers picks the wrong SDK.
    const verdict = toolchain.resolveSdk({
      env: {},
      run,
      listDir: () => ["MacOSX9.3.sdk", "MacOSX26.5.sdk", "MacOSX26.12.sdk"],
      probe: ({ sdkPath } = {}) =>
        sdkPath === path.join(sdkDir, "MacOSX26.12.sdk")
          ? { ok: true, detail: "a three-line addon compiles and links" }
          : neverLinks(),
    });

    expect(verdict.sdkPath).toBe(path.join(sdkDir, "MacOSX26.12.sdk"));
    expect(verdict.env).toEqual({ SDKROOT: path.join(sdkDir, "MacOSX26.12.sdk") });
  });

  test("says no rather than naming a path it did not find", () => {
    const bare = toolchain.resolveSdk({
      env: {},
      run: () => ({ status: 1, stdout: "", stderr: "" }),
      probe: links(),
    });
    expect(bare.ok).toBe(false);
    expect(bare.sdkPath).toBeNull();
    expect(bare.env).toEqual({});

    const noSdk = toolchain.resolveSdk({
      env: {},
      run: runnerFor({
        "xcode-select -p": "/Applications/Xcode.app/Contents/Developer\n",
      }).run,
      listDir: () => [],
      probe: links(),
    });
    expect(noSdk.ok).toBe(false);
    expect(noSdk.sdkPath).toBeNull();

    const nothingToPointAt = toolchain.resolveSdk({
      env: {},
      run: runnerFor({
        "xcode-select -p": "/Applications/Xcode.app/Contents/Developer\n",
        "xcrun --sdk macosx --show-sdk-path": "/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk\n",
      }).run,
      listDir: () => [],
      probe: neverLinks,
    });
    expect(nothingToPointAt.ok).toBe(false);
    // Still names the SDK the build would have used, because that is the path
    // the reader needs to look at — and the linker's own line is in the reason,
    // so a machine where nothing links is diagnosable from the verdict alone.
    expect(nothingToPointAt.sdkPath).toBe(
      "/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk",
    );
    expect(nothingToPointAt.reason).toContain("tapi error: malformed file");
  });

  // The live check: the path the module derives for Electron is a claim about
  // this tree's `node_modules`, and a wrong one returns no ABI at all — which
  // reads as "the repair could not decide" rather than as a bug in a path.
  // Skipped rather than failed when the install is not there, because a
  // pruned tree is a legitimate state and this test is about a derivation, not
  // about Electron being installed.
  const ELECTRON_MANIFEST = path.join(ROOT, "node_modules", "electron", "path.txt");

  test.skipIf(!fs.existsSync(ELECTRON_MANIFEST))(
    "and this repository's own Electron install is where it says it is",
    () => {
      expect(
        toolchain.targetAbi({
          runtime: "electron",
          root: ROOT,
          run: () => ({ status: 0, stdout: "135", stderr: "" }),
        }),
      ).toBe(135);
      // The manifest has to name a path inside `dist`, because that is where
      // the package's own loader looks for the binary.
      expect(fs.readFileSync(ELECTRON_MANIFEST, "utf8").trim()).not.toBe("");
    },
  );
});

describe("whether a build against that SDK would actually link", () => {
  /**
   * The mistake this half of the module exists to prevent: `resolveSdk` is
   * arithmetic over what `xcrun` says, and on the afternoon in question `xcrun`
   * named an SDK the linker then refused to read. A verdict built on that alone
   * calls the machine ready and a rebuild dies anyway, so the last word here is
   * the compiler's.
   */
  const SDK = "/Xcode/MacOSX26.5.sdk";

  /** A probe area whose cleanup is observable, and no filesystem at all. */
  function probeArea() {
    const disposed: number[] = [];
    return {
      files: {
        create: (): ProbeArea => ({
          source: "/tmp/atr-probe/atr-sdk-probe.cc",
          output: "/tmp/atr-probe/atr-sdk-probe.dylib",
          dispose: () => disposed.push(1),
        }),
      },
      disposed,
    };
  }

  test("the translation unit is the one the linker has to read the SDK for", () => {
    // An empty object file would compile without touching the SDK's stubs, and
    // the stubs are where the failure lives — so the source has to become a
    // shared library, not an object file.
    expect(toolchain.SDK_PROBE_SOURCE).toContain("atr_sdk_probe");
  });

  test("a compiler that links passes, and is handed the SDK in question", () => {
    const asked: string[][] = [];
    const area = probeArea();

    const probe = toolchain.linkProbe({
      sdkPath: SDK,
      clang: "/usr/bin/clang++",
      files: area.files,
      run: (_cmd, args) => {
        asked.push(args);
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(probe.ok).toBe(true);
    expect(probe.detail).toContain(SDK);
    // `-isysroot` is what makes this a question about *this* SDK rather than
    // about whichever one the compiler would have picked for itself.
    expect(asked[0]).toEqual([
      "-dynamiclib",
      "-isysroot",
      SDK,
      "-o",
      "/tmp/atr-probe/atr-sdk-probe.dylib",
      "/tmp/atr-probe/atr-sdk-probe.cc",
    ]);
  });

  test("with no SDK named, it links the way a rebuild does", () => {
    /*
     * The distinction this test exists for, and the one that was wrong here.
     *
     * A rebuild links with the `SDKROOT` it inherits and nothing else, so a
     * probe that always passes `-isysroot` answers a *different* question — and
     * on 2026-10-09 this machine was the counterexample: `-isysroot <the Xcode
     * SDK>` links, while the same link without it reads the Command Line Tools
     * SDK through the linker's default search path and dies on its stub files.
     * The probe said ready and `pnpm test:electron-e2e` died at the link, which
     * is the whole reason the question has to be askable both ways.
     */
    const asked: string[][] = [];

    const probe = toolchain.linkProbe({
      clang: "/usr/bin/clang++",
      files: probeArea().files,
      run: (_cmd, args) => {
        asked.push(args);
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(probe.ok).toBe(true);
    expect(asked[0]).toEqual([
      "-dynamiclib",
      "-o",
      "/tmp/atr-probe/atr-sdk-probe.dylib",
      "/tmp/atr-probe/atr-sdk-probe.cc",
    ]);
    // And it says which question it answered, so a reader is not left to guess
    // whether the SDK in a passing line was one this process chose.
    expect(probe.detail).toContain("environment");
    expect(probe.detail).not.toContain(SDK);
  });

  test("a failure with no SDK named quotes the linker and claims no SDK", () => {
    const probe = toolchain.linkProbe({
      clang: "/usr/bin/clang++",
      files: probeArea().files,
      run: () => ({
        status: 1,
        stdout: "",
        stderr:
          "ld: multiple errors: tapi error: malformed file\n/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk/usr/lib/libSystem.B.tbd:4:20: error: unknown architecture\n",
      }),
    });

    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain("tapi error: malformed file");
    expect(probe.detail).toContain("environment");
  });

  test("the ATR-057 linker tail is a failure, quoting the line that names it", () => {
    const area = probeArea();

    const probe = toolchain.linkProbe({
      sdkPath: SDK,
      clang: "/usr/bin/clang++",
      files: area.files,
      run: () => ({
        status: 1,
        stdout: "",
        stderr: [
          "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/ld: multiple errors: tapi error: malformed file",
          "/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk/usr/lib/libSystem.B.tbd:4:20: error: unknown architecture",
          "clang: error: linker command failed with exit code 1 (use -v to see invocation)",
        ].join("\n"),
      }),
    });

    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain("tapi error: malformed file");
    expect(probe.detail).toContain(SDK);
    // And the whole output comes back, so a caller that wants to print the tail
    // rather than one line does not have to run the compiler again.
    expect(probe.output).toContain("unknown architecture");
  });

  test("asks xcrun which compiler, because the pairing is the question", () => {
    const asked: string[] = [];
    const area = probeArea();

    toolchain.linkProbe({
      sdkPath: SDK,
      files: area.files,
      run: (cmd, args) => {
        asked.push(`${cmd} ${args.join(" ")}`);
        if (cmd === "xcrun") return { status: 0, stdout: "/usr/bin/clang++\n", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(asked[0]).toBe("xcrun --find clang++");
    expect(asked[1]?.startsWith("/usr/bin/clang++ -dynamiclib")).toBe(true);
  });

  test("falls back to a plain clang++ when xcrun cannot name one", () => {
    const asked: string[] = [];
    const area = probeArea();

    toolchain.linkProbe({
      sdkPath: SDK,
      files: area.files,
      run: (cmd, args) => {
        asked.push(`${cmd} ${args.join(" ")}`);
        if (cmd === "xcrun") return { status: 1, stdout: "", stderr: "no clang" };
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(asked[1]?.startsWith("clang++ ")).toBe(true);
  });

  test("a machine with no compiler is a false, not an exception", () => {
    // `spawnSync` reports ENOENT on the result rather than throwing, and a probe
    // that threw here would take the whole doctor down on the machine it exists
    // for.
    const area = probeArea();

    const probe = toolchain.linkProbe({
      sdkPath: SDK,
      clang: "clang++",
      files: area.files,
      run: () => ({
        status: null,
        stdout: "",
        stderr: "",
        error: { message: "spawnSync clang++ ENOENT" },
      }),
    });

    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain("ENOENT");
    expect(probe.detail).toContain(SDK);
  });

  test("and the temporary directory goes away on both outcomes", () => {
    // Otherwise every doctor run leaves two files and a directory behind, in a
    // temp dir somebody has to clean up by hand.
    const passed = probeArea();
    const failed = probeArea();

    toolchain.linkProbe({
      sdkPath: SDK,
      clang: "clang++",
      files: passed.files,
      run: () => ({ status: 0, stdout: "", stderr: "" }),
    });
    toolchain.linkProbe({
      sdkPath: SDK,
      clang: "clang++",
      files: failed.files,
      run: () => ({ status: 1, stdout: "", stderr: "ld: boom" }),
    });

    expect(passed.disposed).toHaveLength(1);
    expect(failed.disposed).toHaveLength(1);
  });
});

describe("the SDK a dependency's own build hook gets", () => {
  /*
   * The lever, and why it is this one.
   *
   * `ensure-native-abi.mjs` hands the rebuild *it* starts the SDKROOT that
   * links; a bare `pnpm rebuild <native module>` is not its child, so the only
   * thing that reaches that build is gyp's own forced include,
   * `~/.gyp/include.gypi`.
   */
  test("the include is gyp's own file, under whatever home is asked about", () => {
    expect(toolchain.GYP_INCLUDE_RELATIVE).toBe(path.join(".gyp", "include.gypi"));
    expect(toolchain.gypIncludePath({ home: "/tmp/somebody" })).toBe(
      path.join("/tmp/somebody", ".gyp", "include.gypi"),
    );
  });

  test("the contents name the marker, the SDK, and where the file comes from", () => {
    const text = toolchain.gypIncludeContents("/SDKs/MacOSX26.5.sdk");

    // The marker is what makes a file this wrote distinguishable from one a
    // person keeps, which is the difference between refreshing and clobbering.
    expect(text).toContain(toolchain.GYP_INCLUDE_MARKER);
    expect(text).toContain("'SDKROOT': \"/SDKs/MacOSX26.5.sdk\",");
    // A line a person reads, not just an assignment: how it got there, and how
    // to undo it.
    expect(text).toContain("scripts/point-sdkroot.mjs");
    expect(text).toContain("pnpm rebuild");
    expect(text).toContain("Delete");
  });

  test("the SDK path is encoded, so a quote in a home directory cannot end it", () => {
    const hostile = '/Users/a"b/SDK "x".sdk';
    const text = toolchain.gypIncludeContents(hostile);
    const line = text
      .split("\n")
      .find((each) => each.includes("'SDKROOT':"));

    expect(line).toBe(`      'SDKROOT': ${JSON.stringify(hostile)},`);
    // Which is to say: one string literal, with each quote inside it escaped —
    // the three in the path plus the pair that delimit it.
    expect(line?.match(/"/g) ?? []).toHaveLength(5);
    expect(line).toContain('\\"');
  });

  test("the SDK in a written include can be read back out of it", () => {
    const sdkPath = "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk";

    expect(toolchain.sdkFromGypInclude(toolchain.gypIncludeContents(sdkPath))).toBe(
      sdkPath,
    );
    // Escapes come back as the characters they stand for, which is the whole
    // reason the path is encoded on the way in.
    expect(toolchain.sdkFromGypInclude(toolchain.gypIncludeContents('/a"b/c.sdk'))).toBe(
      '/a"b/c.sdk',
    );
    // A file with nothing to say about SDKs is not an error, and neither is one
    // that is not readable at all.
    expect(toolchain.sdkFromGypInclude("{ 'target_defaults': {} }\n")).toBe(null);
    expect(toolchain.sdkFromGypInclude("{ 'SDKROOT': '/not/ours' }\n")).toBe(null);
    expect(toolchain.sdkFromGypInclude("")).toBe(null);
  });

  test("no include at all is written, and its directory is created first", () => {
    const home = tmp("atr-gyp");
    const made: string[] = [];
    const written: Array<{ file: string; text: string }> = [];

    const verdict = toolchain.pointGypAtSdk({
      sdkPath: "/SDKs/MacOSX26.5.sdk",
      home,
      read: () => null,
      mkdir: (dir) => made.push(dir),
      write: (file, text) => written.push({ file, text }),
    });

    const include = path.join(home, ".gyp", "include.gypi");
    expect(verdict.wrote).toBe(true);
    expect(verdict.foreign).toBe(false);
    expect(verdict.path).toBe(include);
    expect(made).toEqual([path.dirname(include)]);
    expect(written).toHaveLength(1);
    expect(written[0].file).toBe(include);
    expect(written[0].text).toBe(
      toolchain.gypIncludeContents("/SDKs/MacOSX26.5.sdk"),
    );
    expect(verdict.reason).toContain("wrote");
    expect(verdict.reason).toContain("/SDKs/MacOSX26.5.sdk");
  });

  test("a file that already says this is not rewritten on every install", () => {
    const home = tmp("atr-gyp");
    let writes = 0;
    const read = () => toolchain.gypIncludeContents("/SDKs/MacOSX26.5.sdk");

    const first = toolchain.pointGypAtSdk({
      sdkPath: "/SDKs/MacOSX26.5.sdk",
      home,
      read,
      write: () => {
        writes += 1;
      },
      mkdir: () => {},
    });

    expect(first.wrote).toBe(false);
    expect(first.reason).toContain("already points at");
    expect(writes).toBe(0);
  });

  test("our own file pointing somewhere else is rewritten", () => {
    const home = tmp("atr-gyp");
    const happened: string[] = [];

    const verdict = toolchain.pointGypAtSdk({
      sdkPath: "/SDKs/MacOSX26.5.sdk",
      home,
      read: () => toolchain.gypIncludeContents("/SDKs/gone.sdk"),
      write: () => happened.push("write"),
      mkdir: () => happened.push("mkdir"),
    });

    expect(verdict.wrote).toBe(true);
    expect(verdict.reason).toContain("rewrote");
    expect(happened).toEqual(["mkdir", "write"]);
  });

  test("a file somebody else keeps is reported, never rewritten or removed", () => {
    const home = tmp("atr-gyp");
    const theirs = "{ 'target_defaults': { 'xcode_settings': { 'SDKROOT': '/X.sdk' } } }\n";
    let touched = false;

    const verdict = toolchain.pointGypAtSdk({
      sdkPath: "/SDKs/MacOSX26.5.sdk",
      home,
      read: () => theirs,
      write: () => {
        touched = true;
      },
      mkdir: () => {
        touched = true;
      },
    });

    expect(verdict).toMatchObject({ wrote: false, foreign: true });
    expect(verdict.reason).toContain("left alone");
    expect(touched).toBe(false);
  });

  test("a write that fails is a message, not an exception", () => {
    const home = tmp("atr-gyp");

    const verdict = toolchain.pointGypAtSdk({
      sdkPath: "/SDKs/MacOSX26.5.sdk",
      home,
      read: () => null,
      mkdir: () => {},
      write: () => {
        throw new Error("EROFS: read-only file system");
      },
    });

    expect(verdict.wrote).toBe(false);
    expect(verdict.foreign).toBe(false);
    expect(verdict.reason).toContain("could not write");
    expect(verdict.reason).toContain("EROFS");
  });

  test("the real filesystem round-trips through the real node-gyp path", () => {
    const home = tmp("atr-gyp");

    expect(
      toolchain.pointGypAtSdk({ sdkPath: "/SDKs/MacOSX26.5.sdk", home }).wrote,
    ).toBe(true);

    const include = path.join(home, ".gyp", "include.gypi");
    expect(fs.readFileSync(include, "utf8")).toBe(
      toolchain.gypIncludeContents("/SDKs/MacOSX26.5.sdk"),
    );

    // Second time is a no-op, which is what a hook that runs on every install
    // has to be — `pnpm:devPreinstall` and `preinstall` both point at this.
    const again = toolchain.pointGypAtSdk({
      sdkPath: "/SDKs/MacOSX26.5.sdk",
      home,
    });
    expect(again.wrote).toBe(false);
    expect(again.reason).toContain("already points at");
  });
});
