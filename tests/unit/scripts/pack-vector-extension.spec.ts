/**
 * The `afterPack` hook that puts `vec0.<ext>` into a packaged app.
 *
 * This is the guard for a bug that no other test in the repository can see: the
 * extension's shared library lives in a per-platform package that is an
 * `optionalDependency`, and electron-builder's dependency collector walks
 * `dependencies` only. So a build contains the wrapper, contains no library, and
 * the app comes up with semantic search quietly reduced to keywords — every unit
 * test green (they run against `node_modules`), every Electron E2E spec green
 * (dev mode loads from `node_modules` too). The only test that can catch it is
 * one that inspects what a *packaging step* produced, which is why the hook is
 * written as functions over a directory tree rather than as a few lines inline
 * in the config.
 *
 * The three facts pinned here:
 *
 *   1. the library is found where pnpm actually keeps it — the `.pnpm` store,
 *      not `node_modules/<package>` — and the version is read from the
 *      directory name rather than hard-coded;
 *   2. it lands where the app looks for it, `Contents/Resources` on macOS;
 *   3. a build with no library for its platform **fails** instead of shipping.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "pack-vector-extension.mjs");

interface PackModule {
  EXTENSION_FILES: Record<string, string>;
  ARCH_NAMES: Record<number, string>;
  platformPackageName(options: { platform: string; arch: string }): string;
  findExtensionSource(options: {
    root?: string;
    platform: string;
    arch: string;
  }): string | null;
  resourcesDir(options: {
    appOutDir: string;
    appName?: string;
    platform: string;
  }): string;
  archName(value: unknown): string | null;
  copyVectorExtension(options: {
    root?: string;
    appOutDir: string;
    platform: string;
    arch: string;
    appName?: string;
    log?: (line: string) => void;
  }): { source: string; destination: string; bytes: number };
  default(
    context: Record<string, unknown>,
    deps?: Record<string, unknown>,
  ): Promise<void>;
}

let script: PackModule;
let tmp: string | null = null;

beforeAll(async () => {
  // Imported through a URL, the way `check-platforms.spec.ts` loads its script:
  // a `.mjs` beside the source has no declaration file, and this is how the
  // suite reaches one without inventing a `.d.ts` for a file that is not a
  // module it compiles.
  script = (await import(pathToFileURL(SCRIPT).href)) as unknown as PackModule;
});

afterEach(() => {
  cleanupTmp(tmp);
  tmp = null;
});

/**
 * A fake pnpm install holding one platform package, plus an empty app output
 * directory. Returns the paths the hook would be handed.
 */
function fixture({
  platform = "darwin",
  arch = "arm64",
  version = "0.1.9",
  contents = "MACH-O-ISH-BYTES",
}: {
  platform?: string;
  arch?: string;
  version?: string;
  contents?: string;
} = {}): { root: string; appOutDir: string; library: string } {
  tmp = makeTmpDir("atr-pack-vector");
  const name = script.platformPackageName({ platform, arch });
  const library = path.join(
    tmp,
    "node_modules",
    ".pnpm",
    `${name}@${version}`,
    "node_modules",
    name,
    script.EXTENSION_FILES[platform],
  );
  fs.mkdirSync(path.dirname(library), { recursive: true });
  fs.writeFileSync(library, contents);
  const appOutDir = path.join(tmp, "release", `mac-${arch}`);
  fs.mkdirSync(appOutDir, { recursive: true });
  return { root: tmp, appOutDir, library };
}

describe("finding the platform package", () => {
  test("reads it out of the pnpm store, whatever version is installed", () => {
    const { root, library } = fixture({ version: "0.4.2" });
    expect(script.findExtensionSource({ root, platform: "darwin", arch: "arm64" })).toBe(
      library,
    );
  });

  test("names the Windows package the way sqlite-vec publishes it", () => {
    // `windows`, not Node's `win32` — the one spelling difference that would
    // make a Windows build look like it has no native package at all.
    expect(script.platformPackageName({ platform: "win32", arch: "x64" })).toBe(
      "sqlite-vec-windows-x64",
    );
    expect(script.platformPackageName({ platform: "darwin", arch: "arm64" })).toBe(
      "sqlite-vec-darwin-arm64",
    );
  });

  test("returns null rather than throwing when the platform has no package", () => {
    const { root } = fixture();
    // An Intel Mac of a build that only installed arm64: absent, not broken.
    expect(script.findExtensionSource({ root, platform: "darwin", arch: "x64" })).toBeNull();
  });

  test("returns null when there is no pnpm store at all", () => {
    tmp = makeTmpDir("atr-pack-vector-empty");
    expect(
      script.findExtensionSource({ root: tmp, platform: "darwin", arch: "arm64" }),
    ).toBeNull();
  });
});

describe("copying it into the bundle", () => {
  test("lands in Contents/Resources on macOS, where the app looks", () => {
    const { root, appOutDir } = fixture();
    const result = script.copyVectorExtension({
      root,
      appOutDir,
      platform: "darwin",
      arch: "arm64",
      appName: "AllTheRepos",
    });

    expect(result.destination).toBe(
      path.join(appOutDir, "AllTheRepos.app", "Contents", "Resources", "vec0.dylib"),
    );
    expect(fs.readFileSync(result.destination, "utf8")).toBe("MACH-O-ISH-BYTES");
    expect(result.bytes).toBeGreaterThan(0);
  });

  test("follows the build's arch rather than the machine's", () => {
    // The point of doing this in a hook: an x64 build gets the x64 library with
    // nothing to edit, which is what makes shipping Intel a packaging decision.
    const { root, appOutDir } = fixture({ arch: "x64" });
    const result = script.copyVectorExtension({
      root,
      appOutDir,
      platform: "darwin",
      arch: "x64",
    });
    expect(result.source).toContain("sqlite-vec-darwin-x64");
  });

  test("fails the build when there is no library to copy", () => {
    tmp = makeTmpDir("atr-pack-vector-empty");
    const appOutDir = path.join(tmp, "release", "mac-arm64");
    fs.mkdirSync(appOutDir, { recursive: true });

    expect(() =>
      script.copyVectorExtension({
        root: tmp!,
        appOutDir,
        platform: "darwin",
        arch: "arm64",
      }),
    ).toThrow(/sqlite-vec-darwin-arm64/);

    // And nothing was written where the app would look but find nothing.
    expect(
      fs.existsSync(path.join(appOutDir, "AllTheRepos.app", "Contents", "Resources")),
    ).toBe(false);
  });

  test("reports what it did, so a build log says whether the store shipped", () => {
    const { root, appOutDir } = fixture();
    const lines: string[] = [];
    script.copyVectorExtension({
      root,
      appOutDir,
      platform: "darwin",
      arch: "arm64",
      log: (line) => lines.push(line),
    });
    expect(lines.join("\n")).toContain("vec0.dylib");
  });
});

describe("the hook electron-builder calls", () => {
  test("takes the platform and arch from the build context", async () => {
    const { root, appOutDir } = fixture();
    await script.default(
      {
        appOutDir,
        electronPlatformName: "darwin",
        arch: 3, // builder-util's Arch.arm64
        packager: { appInfo: { productFilename: "AllTheRepos" } },
      },
      { root, log: () => {} },
    );
    expect(
      fs.existsSync(
        path.join(appOutDir, "AllTheRepos.app", "Contents", "Resources", "vec0.dylib"),
      ),
    ).toBe(true);
  });

  test("maps the numeric arch the context carries, and rejects an unknown one", () => {
    expect(script.archName(1)).toBe("x64");
    expect(script.archName(3)).toBe("arm64");
    // A string is already an arch name (and `process.arch` is one).
    expect(script.archName("x64")).toBe("x64");
    expect(script.archName(99)).toBeNull();
  });
});
