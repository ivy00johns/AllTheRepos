/**
 * Unit test for `scripts/check-platforms.mjs`.
 *
 * The script exists because "macOS on Apple silicon" lives in
 * `electron-builder.yml` while the reason it is true lives in the dependency
 * tree, and nothing connected the two. Most of what is asserted here is the
 * shape of that mistake:
 *
 *   - a package that ships **prebuilt** binaries is only as good as its platform
 *     matrix — the shape a vector store used to cost this app on Intel, back when
 *     `@lancedb/lancedb` had no `darwin-x64` package at all;
 *   - a package that ships **C++ sources and a `binding.gyp`** covers anything
 *     the toolchain does, which is why `find-git-repositories` — whose only
 *     published prebuild is for darwin-arm64 — is not the thing blocking Intel;
 *   - a platform-shaped *name* is not a platform, so `@radix-ui/react-tooltip`
 *     and `left-pad-win32-x64-helper` have to be ignored by the same rule that
 *     recognises `@lancedb/lancedb-win32-x64-msvc`.
 *
 * The `@lancedb/lancedb` manifests below are kept as **fixtures**. They are the
 * tarballs that produced the finding, which makes them the honest way to test a
 * classifier whose whole job is reading a platform matrix — and they still pin
 * the rule, because the rule is about matrices rather than about that package.
 *
 * The app no longer depends on it: vectors are stored by `sqlite-vec`, which
 * publishes a binary for every platform this app could ship, so the last block
 * — the one that runs the check against *this* repository — now expects the
 * opposite answer for Intel. That is the intent. The finding was written down,
 * the finding was fixed, and the assertion flipped instead of quietly
 * disappearing with the dependency.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations) and driven
 * through its entry point with the root injected, which is how the other script
 * specs here run theirs — no child process, and the messages a person would read
 * come back as strings.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-platforms.mjs");

interface Module {
  name: string;
  version: string;
  kind: "prebuilt" | "source" | "pure";
  platforms: Set<string> | null;
  declared: string[];
  evidence: string;
}

interface CheckPlatformsModule {
  MANIFEST: string;
  BUILDER_CONFIG: string;
  TARGET_BLOCKS: Record<string, string>;
  CANDIDATES: string[];
  ACCEPTED_DEGRADATIONS: Array<{ target: string; cost: string }>;
  classify(options?: { manifest?: Record<string, unknown>; dir?: string | null }): Module;
  nativeModules(options?: { root?: string; dependencies?: string[] }): Module[] | null;
  declaredTargets(
    yaml: string,
    options?: { blocks?: Record<string, string> },
  ): { targets: string[]; missingArch: string[] };
  assess(options?: {
    targets?: string[];
    missingArch?: string[];
    modules?: Module[];
    candidates?: string[];
    degradations?: Array<{ target: string; cost: string }>;
  }): { failures: string[]; notes: string[]; expansion: string[] };
  run(options?: {
    root?: string;
    candidates?: string[];
    degradations?: Array<{ target: string; cost: string }>;
    log?: (message: string) => void;
    error?: (message: string) => void;
  }): number;
}

let script: CheckPlatformsModule;

beforeAll(async () => {
  script = (await import(pathToFileURL(SCRIPT).href)) as unknown as CheckPlatformsModule;
});

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) cleanupTmp(dirs.pop());
});

/** A throwaway checkout holding the files named, at the paths given. */
function fixture(files: Record<string, string>): string {
  const dir = makeTmpDir("atr-platforms");
  dirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return dir;
}

/** Run the check for its verdict, keeping its output out of the test log. */
function verdict(root: string, options: Partial<Parameters<CheckPlatformsModule["run"]>[0]> = {}) {
  const said: string[] = [];
  const code = script.run({
    root,
    ...options,
    log: (message) => said.push(message),
    error: (message) => said.push(message),
  });
  return { code, said: said.join("\n") };
}

/** What the real LanceDB 0.27.2 publishes, as its own tarball spells it. */
const LANCEDB_0272 = {
  name: "@lancedb/lancedb",
  version: "0.27.2",
  napi: {
    targets: [
      "aarch64-apple-darwin",
      "x86_64-unknown-linux-gnu",
      "aarch64-unknown-linux-gnu",
      "x86_64-unknown-linux-musl",
      "aarch64-unknown-linux-musl",
      "x86_64-pc-windows-msvc",
      "aarch64-pc-windows-msvc",
    ],
  },
  optionalDependencies: {
    "@lancedb/lancedb-darwin-arm64": "0.27.2",
    "@lancedb/lancedb-linux-x64-gnu": "0.27.2",
    "@lancedb/lancedb-linux-arm64-gnu": "0.27.2",
    "@lancedb/lancedb-linux-x64-musl": "0.27.2",
    "@lancedb/lancedb-linux-arm64-musl": "0.27.2",
    "@lancedb/lancedb-win32-x64-msvc": "0.27.2",
    "@lancedb/lancedb-win32-arm64-msvc": "0.27.2",
  },
};

describe("what a package says about the platforms it has", () => {
  test("a prebuilt package is only as good as its own matrix", () => {
    const lancedb = script.classify({ manifest: LANCEDB_0272 });

    expect(lancedb.kind).toBe("prebuilt");
    expect([...(lancedb.platforms ?? [])].sort()).toEqual([
      "darwin-arm64",
      "linux-arm64",
      "linux-x64",
      "win32-arm64",
      "win32-x64",
    ]);
    // Not in this matrix, and never was — which is why the fixture is worth
    // keeping: it is the matrix that made an Intel Mac a silent loss.
    expect(lancedb.platforms?.has("darwin-x64")).toBe(false);
  });

  test("and the libc spelling is not a second architecture", () => {
    // `-gnu` and `-musl` are the same architecture twice; counting them as two
    // would print a matrix nobody can read.
    const lancedb = script.classify({ manifest: LANCEDB_0272 });
    expect(lancedb.declared).toEqual([
      "darwin-arm64",
      "linux-arm64",
      "linux-x64",
      "win32-arm64",
      "win32-x64",
    ]);
  });

  test("a version that lists darwin-x64 says so, which is what a fix would look like", () => {
    // The Intel-Mac floor is 0.22.3, whose tarball does carry the triple.
    const older = script.classify({
      manifest: {
        ...LANCEDB_0272,
        version: "0.22.3",
        napi: { targets: [...LANCEDB_0272.napi.targets, "x86_64-apple-darwin"] },
        optionalDependencies: {
          ...LANCEDB_0272.optionalDependencies,
          "@lancedb/lancedb-darwin-x64": "0.22.3",
        },
      },
    });

    expect(older.platforms?.has("darwin-x64")).toBe(true);
  });

  test("a platform-shaped name that is not a platform is ignored", () => {
    const radix = script.classify({
      manifest: {
        name: "@radix-ui/react-tooltip",
        version: "1.2.7",
        optionalDependencies: { "left-pad-win32-x64-helper": "1.0.0" },
      },
    });

    expect(radix.kind).toBe("pure");
    expect(radix.platforms).toBeNull();
  });

  test("prebuildify's directory layout counts too", () => {
    const dir = fixture({ "prebuilds/darwin-x64+arm64/thing.node": "", "prebuilds/linux-x64/t.node": "" });
    const prebuildify = script.classify({ manifest: { name: "thing", version: "1.0.0" }, dir });

    expect(prebuildify.kind).toBe("prebuilt");
    // `darwin-x64+arm64` is a fat binary: both architectures, one directory.
    expect([...(prebuildify.platforms ?? [])].sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
    ]);
  });

  test("sources plus a binding.gyp cover every architecture, whatever prebuild ships beside them", () => {
    // `find-git-repositories` publishes exactly one prebuild, for darwin-arm64,
    // and this project rebuilds it from source anyway. Reading only the bundled
    // prebuild would have blamed it for blocking Intel, which would be wrong.
    const dir = fixture({
      "binding.gyp": "{ \"targets\": [] }",
      "bin/darwin-arm64-135/find-git-repositories.node": "",
    });
    const findGitRepositories = script.classify({
      manifest: { name: "find-git-repositories", version: "0.2.2" },
      dir,
    });

    expect(findGitRepositories.kind).toBe("source");
    expect(findGitRepositories.platforms).toBeNull();
    expect(findGitRepositories.evidence).toContain("binding.gyp");
  });

  test("and a package with no native code needs no binary at all", () => {
    expect(script.classify({ manifest: { name: "zod", version: "3.25.67" } }).kind).toBe("pure");
  });
});

describe("what electron-builder.yml is asked to build", () => {
  const CONFIG = [
    "appId: com.alltherepos.desktop",
    "publish:",
    "  provider: github",
    "mac:",
    "  category: public.app-category.developer-tools",
    "  target:",
    "    - target: dmg",
    "      arch: [arm64]",
    "    - target: zip",
    "      arch: [arm64]",
    "  protocols:",
    "    - name: alltherepos",
    "      schemes: [alltherepos]",
    "dmg:",
    "  writeUpdateInfo: false",
    "",
  ].join("\n");

  test("every arch under every platform block, deduplicated", () => {
    expect(script.declaredTargets(CONFIG).targets).toEqual(["darwin-arm64"]);
  });

  test("a second architecture, and a second platform, are read as written", () => {
    const { targets } = script.declaredTargets(
      [
        "mac:",
        "  target:",
        "    - target: dmg",
        "      arch: [arm64, x64]",
        "win:",
        "  target:",
        "    - target: nsis",
        "      arch:",
        "        - x64",
        "",
      ].join("\n"),
    );

    expect(targets).toEqual(["darwin-arm64", "darwin-x64", "win32-x64"]);
  });

  test("`dmg:` and `publish:` are not platform blocks", () => {
    // Both sit at the top level and both mention mac; neither declares a build.
    // Mistaking one for a section would be a check that reads the wrong tree.
    const { targets, missingArch } = script.declaredTargets(
      ["publish:", "  provider: github", "dmg:", "  writeUpdateInfo: false", ""].join("\n"),
    );

    expect(targets).toEqual([]);
    expect(missingArch).toEqual([]);
  });

  test("a target with no arch is reported, because it is then the machine's choice", () => {
    const { missingArch } = script.declaredTargets(["mac:", "  target:", "    - target: dmg", ""].join("\n"));
    expect(missingArch).toEqual(["mac"]);
  });

  test("and this repository declares its own architectures where this looks", () => {
    // The hand-rolled read has one job it must not fail: an edit that moves the
    // architectures somewhere it does not look has to be a failure, not a pass.
    const { targets } = script.declaredTargets(
      fs.readFileSync(path.join(ROOT, script.BUILDER_CONFIG), "utf8"),
    );
    expect(targets).toContain("darwin-arm64");
  });
});

describe("the verdict", () => {
  // Classified at call time, not at collect time: the script is imported in
  // `beforeAll`, and a `describe` body runs before that.
  const lancedb = () => script.classify({ manifest: LANCEDB_0272 });
  const fromSource = () =>
    script.classify({ manifest: { name: "better-sqlite3", version: "12.9.0", gypfile: true } });

  test("a declared architecture with no binary for a module fails, naming both", () => {
    const { failures } = script.assess({
      targets: ["darwin-x64"],
      modules: [lancedb(), fromSource()],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("darwin-x64");
    expect(failures[0]).toContain("@lancedb/lancedb@0.27.2");
    // And what the mistake would cost, because "no binary" does not sound fatal
    // in an app that fails soft.
    expect(failures[0]).toContain("silently");
    expect(failures[0]).toContain("ACCEPTED_DEGRADATIONS");
  });

  test("a degradation somebody wrote down is printed, not failed", () => {
    const { failures, notes } = script.assess({
      targets: ["darwin-x64"],
      modules: [lancedb()],
      degradations: [{ target: "darwin-x64", cost: "semantic search falls back to FTS-only" }],
    });

    expect(failures).toEqual([]);
    expect(notes.join("\n")).toContain("DEGRADED");
    expect(notes.join("\n")).toContain("semantic search falls back to FTS-only");
  });

  test("a covered architecture passes, and says how it was covered", () => {
    const { failures, notes } = script.assess({
      targets: ["darwin-arm64"],
      modules: [lancedb(), fromSource()],
    });

    expect(failures).toEqual([]);
    expect(notes.join("\n")).toContain("darwin-arm64 — 2 native module(s), a binary for each");
  });

  test("a block with no arch is a failure, not a silent pass", () => {
    const { failures } = script.assess({ targets: [], missingArch: ["mac"], modules: [lancedb()] });
    expect(failures.join("\n")).toContain("no `arch`");
  });

  test("the expansion matrix answers the question in both directions", () => {
    const { expansion } = script.assess({
      targets: ["darwin-arm64"],
      modules: [lancedb(), fromSource()],
      candidates: ["darwin-x64", "win32-x64"],
    });

    expect(expansion).toHaveLength(2);
    expect(expansion[0]).toContain("darwin-x64 would NOT build today");
    expect(expansion[0]).toContain("@lancedb/lancedb@0.27.2");
    expect(expansion[1]).toContain("win32-x64 would build today");
  });

  test("a candidate already declared is not reported twice", () => {
    const { expansion } = script.assess({
      targets: ["win32-x64"],
      modules: [lancedb()],
      candidates: ["win32-x64", "linux-x64"],
    });

    expect(expansion).toHaveLength(1);
    expect(expansion[0]).toContain("linux-x64");
  });
});

describe("this repository", () => {
  test("the architecture it ships is covered, by the modules it actually ships", () => {
    // The live check, on the real `package.json`, the real `node_modules` and the
    // real `electron-builder.yml` — a guard nobody has seen pass on the real
    // files is a guard with two possible verdicts and no evidence for either.
    const modules = script.nativeModules();
    expect(modules).not.toBeNull();

    const names = (modules ?? []).map((module) => module.name).sort();
    expect(names).toEqual([
      "better-sqlite3",
      "find-git-repositories",
      "sqlite-vec",
    ]);

    const { code, said } = verdict(ROOT);
    expect(said).toContain("darwin-arm64 — 3 native module(s), a binary for each");
    expect(code).toBe(0);
  });

  test("and Intel, which the vector store used to block, builds now", () => {
    // This is the finding, resolved. While the store was LanceDB this asserted
    // the opposite — no `darwin-x64` package existed, so an Intel Mac silently
    // lost semantic search — and the last time it ran green it was saying so.
    // `sqlite-vec` publishes one, so the expansion line flipped, and because
    // nothing is degraded on any architecture any more there is nothing left to
    // record in ACCEPTED_DEGRADATIONS.
    const { code, said } = verdict(ROOT);

    expect(code).toBe(0);
    expect(said).toContain("darwin-x64 would build today");
    expect(script.ACCEPTED_DEGRADATIONS).toEqual([]);
  });

  test("as do the two platforms that never had the problem", () => {
    // Windows and Linux were never blocked — LanceDB's matrix had win32-x64 and
    // linux-x64 — so they keep saying what they always said. All three candidates
    // agreeing is the state this change was for.
    const { said } = verdict(ROOT);

    expect(said).toContain("win32-x64 would build today");
    expect(said).toContain("linux-x64 would build today");
  });
});
