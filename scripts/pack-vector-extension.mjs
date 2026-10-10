#!/usr/bin/env node
/**
 * pack-vector-extension.mjs — the `afterPack` hook: put `vec0.<ext>` into the
 * app bundle, where the packaging step would otherwise leave it behind.
 *
 * ## The bug this exists to prevent
 *
 * `sqlite-vec` is two packages: a pure-JavaScript wrapper, and a per-platform
 * package holding the actual shared library (`sqlite-vec-darwin-arm64` →
 * `vec0.dylib`). The wrapper finds its library with
 * `require.resolve("<platform package>/vec0.dylib")`.
 *
 * The platform package is declared as an **`optionalDependency`** of the
 * wrapper, and electron-builder's dependency collector walks `dependencies`
 * only. So the packaged app ends up with `node_modules/sqlite-vec` and no
 * `sqlite-vec-darwin-arm64` anywhere in it: the resolve throws, the extension
 * never loads, and `services/vector-store.ts` does exactly what it is written
 * to do — fail soft, report `no-vector-store`, and let search answer with
 * keywords. Every gate stays green; semantic search is simply gone from the
 * shipped app. (Measured, not theorised: the first packaged build with
 * `sqlite-vec` in it listed four entries under `/node_modules/sqlite-vec` in
 * the asar and not one `vec0.dylib` in the whole bundle.) The same shape of
 * hole is why the previous store — LanceDB, whose platform packages are also
 * optional dependencies — is likely to have shipped vectorless too.
 *
 * ## What it does instead
 *
 * Copies this build's platform package binary to `<resources>/vec0.<ext>`,
 * which is the second location `vector-store.ts` looks in (see
 * `extensionCandidates()` there). A plain file next to the app's resources,
 * because:
 *
 *   - it is produced from `context.arch`, so a build of *any* architecture
 *     gets *its* binary — nothing here has to be edited to ship an Intel Mac;
 *   - it does not depend on the resolution rules of a third-party package, or
 *     on electron-builder changing its mind about optional dependencies;
 *   - a copy can be checked. This hook **fails the build** when the source
 *     cannot be found, because the alternative is a release that silently does
 *     less than the one before it.
 *
 * The `deps` parameter exists so the tests can drive this without a build —
 * not as a general extension point.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The library's file name per platform, matching `sqlite-vec`'s own spelling. */
export const EXTENSION_FILES = Object.freeze({
  darwin: "vec0.dylib",
  linux: "vec0.so",
  win32: "vec0.dll",
});

/**
 * electron-builder's `Arch` enum, by the value it puts on the hook context.
 *
 * Spelled out rather than imported from `builder-util`: this file runs inside
 * electron-builder, where that package is present, but importing it makes the
 * hook depend on the internals of the thing that calls it.
 */
export const ARCH_NAMES = Object.freeze({
  0: "ia32",
  1: "x64",
  2: "armv7l",
  3: "arm64",
  4: "universal",
});

/**
 * The npm package holding one platform's binary.
 *
 * Note `windows`, not `win32`: `sqlite-vec` publishes `sqlite-vec-windows-x64`
 * while Node calls the platform `win32`, and a name derived from
 * `process.platform` alone would look for a package that does not exist.
 */
export function platformPackageName({ platform, arch }) {
  const os = platform === "win32" ? "windows" : platform;
  return `sqlite-vec-${os}-${arch}`;
}

/**
 * Where the platform package's binary lives inside a pnpm install.
 *
 * pnpm does not flatten `node_modules`; the real files sit in
 * `node_modules/.pnpm/<package>@<version>/node_modules/<package>/`, and only
 * the packages listed in `package.json` get a symlink at the top level. The
 * version is read from the directory name rather than guessed, so this does
 * not need editing when `sqlite-vec` is upgraded.
 *
 * @returns {string|null} the binary's path, or `null` when this install has no
 *   package for `{platform, arch}` — which is a fact about the install, and the
 *   caller's job to decide what to do about.
 */
export function findExtensionSource({
  root = ROOT,
  platform,
  arch,
  readdir = fs.readdirSync,
  exists = fs.existsSync,
} = {}) {
  const packageName = platformPackageName({ platform, arch });
  const fileName = EXTENSION_FILES[platform];
  if (!fileName) return null;

  const store = path.join(root, "node_modules", ".pnpm");
  let entries;
  try {
    entries = readdir(store);
  } catch {
    return null;
  }

  const prefix = `${packageName}@`;
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const candidate = path.join(store, entry, "node_modules", packageName, fileName);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Where a packaged app keeps files it reads at runtime.
 *
 * macOS puts them beside the bundle's code in `Contents/Resources`; everything
 * else uses a `resources` directory next to the executable. Only darwin is
 * built today, but the layout is one ternary and guessing wrong on the other
 * platforms would be a silent no-op there.
 */
export function resourcesDir({ appOutDir, appName = "AllTheRepos", platform }) {
  return platform === "darwin"
    ? path.join(appOutDir, `${appName}.app`, "Contents", "Resources")
    : path.join(appOutDir, "resources");
}

/** The architecture this build targets, from the hook context. */
export function archName(value) {
  if (typeof value === "string") return value;
  return ARCH_NAMES[value] ?? null;
}

/**
 * Copy this build's extension into the bundle.
 *
 * @returns {{source: string, destination: string, bytes: number}}
 * @throws when the install has no binary for this platform/arch, or the copy
 *   produced nothing — a release missing its vector store must not be
 *   publishable.
 */
export function copyVectorExtension({
  root = ROOT,
  appOutDir,
  platform,
  arch,
  appName,
  fileName = EXTENSION_FILES[platform],
  copy = fs.copyFileSync,
  stat = fs.statSync,
  log = () => {},
} = {}) {
  const source = findExtensionSource({ root, platform, arch });
  if (!source) {
    throw new Error(
      `[vector-extension] no ${platformPackageName({ platform, arch })} in ` +
        `${path.join(root, "node_modules", ".pnpm")} — the packaged app would ` +
        `ship without a vector store and semantic search would degrade to ` +
        `keywords, silently. Run \`pnpm install\` and rebuild.`,
    );
  }

  const destination = path.join(resourcesDir({ appOutDir, appName, platform }), fileName);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  copy(source, destination);

  const { size } = stat(destination);
  if (!size) {
    throw new Error(
      `[vector-extension] copied ${source} to ${destination} and it is empty`,
    );
  }
  log(
    `[vector-extension] ${fileName} → ${path.relative(root, destination)} (${size} bytes)`,
  );
  return { source, destination, bytes: size };
}

/** electron-builder's `afterPack` hook. */
export default async function afterPack(context, deps = {}) {
  const platform = deps.platform ?? context?.electronPlatformName ?? process.platform;
  const arch = deps.arch ?? archName(context?.arch) ?? process.arch;
  const appName = context?.packager?.appInfo?.productFilename ?? "AllTheRepos";

  copyVectorExtension({
    root: deps.root ?? ROOT,
    appOutDir: deps.appOutDir ?? context?.appOutDir,
    platform,
    arch,
    appName,
    log: deps.log ?? console.log,
  });
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
  try {
    const platform = process.argv[2] ?? process.platform;
    const arch = process.argv[3] ?? process.arch;
    const appOutDir = process.argv[4];
    if (!appOutDir) {
      console.error(
        "[vector-extension] usage: node scripts/pack-vector-extension.mjs " +
          "[platform] [arch] <app-out-dir>",
      );
      process.exit(2);
    }
    const result = copyVectorExtension({
      platform,
      arch,
      appOutDir,
      log: console.log,
    });
    console.log(`[vector-extension] ${result.bytes} bytes in place`);
  } catch (thrown) {
    console.error(`[vector-extension] ${thrown?.message ?? thrown}`);
    process.exit(1);
  }
}
