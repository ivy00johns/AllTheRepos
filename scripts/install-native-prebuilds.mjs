#!/usr/bin/env node
/**
 * install-native-prebuilds.mjs — put a module's own shipped binary where its
 * loader looks for it.
 *
 * `find-git-repositories` publishes a prebuilt binary per ABI under
 * `bin/<platform>-<arch>-<modulesVersion>/`, but its `main` is
 * `build/Release/findGitRepos.node` — a path only a successful `node-gyp`
 * build ever creates. When that build cannot link, the module is missing from
 * the tree and the scanner worker throws on `require`, while the binary the
 * publisher built for exactly this ABI sits right there unused. That is the
 * state this machine has been in since its Command Line Tools update installed
 * an SDK clang will not link against (ATR-057).
 *
 * So: copy it into place. This is a repair, not a rebuild — it installs the
 * publisher's artifact for the ABI being asked for, and reports when there is
 * no artifact for that ABI rather than pretending there is.
 *
 * Usage:
 *   node scripts/install-native-prebuilds.mjs --abi <modulesVersion>
 *     [--platform darwin] [--arch arm64] [--root .]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The modules with a shipped prebuild layout, and where each one's loader
 * looks for its binary.
 *
 * `target` is the package's own `main`, which is what `require(name)` resolves
 * to; `sourceDir` is the published per-ABI directory. A module only belongs
 * here if both are known — guessing a path would turn a missing binary into a
 * binary in the wrong place, which is worse.
 */
export const PREBUILD_MODULES = [
  {
    name: "find-git-repositories",
    binary: "find-git-repositories.node",
    sourceDir: ({ platform, arch, abi }) => `bin/${platform}-${arch}-${abi}`,
    target: "build/Release/findGitRepos.node",
  },
];

/**
 * What would be copied, and what cannot be.
 *
 * Pure over an injected `exists`, so both halves are testable without the
 * package being installed.
 */
export function planInstalls({
  root,
  platform,
  arch,
  abi,
  exists = fs.existsSync,
}) {
  const installs = [];
  const missing = [];

  for (const module of PREBUILD_MODULES) {
    const packageRoot = path.join(root, "node_modules", module.name);
    const from = path.join(
      packageRoot,
      module.sourceDir({ platform, arch, abi }),
      module.binary,
    );
    const to = path.join(packageRoot, module.target);
    if (exists(from)) installs.push({ name: module.name, from, to });
    else missing.push({ name: module.name, expected: from });
  }

  return { installs, missing };
}

/**
 * Copy every available prebuild into the path its loader uses.
 *
 * @returns {{installed: string[], missing: Array<{name: string, expected: string}>}}
 */
export function install({
  root,
  platform = process.platform,
  arch = process.arch,
  abi,
  log = console.log,
  error = console.error,
  exists = fs.existsSync,
  copy = fs.copyFileSync,
  mkdir = fs.mkdirSync,
} = {}) {
  if (!abi) {
    error("[prebuilds] could not run — no --abi given, so nothing says which binary to install");
    return { installed: [], missing: [] };
  }

  const { installs, missing } = planInstalls({
    root,
    platform,
    arch,
    abi,
    exists,
  });

  const installed = [];
  for (const item of installs) {
    mkdir(path.dirname(item.to), { recursive: true });
    copy(item.from, item.to);
    log(
      `  · installed ${item.name} for abi ${abi} — ${item.from} → ${item.to}`,
    );
    installed.push(item.name);
  }
  for (const item of missing) {
    log(
      `  · no ${item.name} prebuild for ${platform}-${arch}-${abi} — expected ${item.expected}`,
    );
  }

  return { installed, missing };
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
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };

  install({
    root: value("--root") ?? path.resolve(process.cwd()),
    platform: value("--platform"),
    arch: value("--arch"),
    abi: value("--abi") ? Number(value("--abi")) : undefined,
  });
}
