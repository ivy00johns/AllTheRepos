#!/usr/bin/env node
/**
 * point-sdkroot.mjs — make a bare `pnpm rebuild <native module>` link.
 *
 * `ensure-native-abi.mjs` already hands the rebuild *it* runs the SDKROOT that
 * links, which is what makes `pnpm test` and `pnpm test:electron-e2e` work on a
 * machine whose linker cannot read the SDK its own tools name (ATR-057). It does
 * nothing for the command a person types by hand, because that build is the
 * dependency's: `pnpm rebuild find-git-repositories` runs *its* node-gyp hook
 * with the environment it inherits, and this repository's scripts are not in the
 * path of that child at all.
 *
 * gyp has exactly one place that reaches such a build — `~/.gyp/include.gypi`,
 * which gyp forcibly includes into every `.gyp` file it reads. So this puts the
 * resolved SDK there.
 *
 * Only when it is needed. The environment is asked first, with the same
 * three-line link `linkProbe` uses: if a build links as things stand and there
 * is no file of ours in the way, nothing is pointed anywhere and nothing is
 * written. A file carrying {@link GYP_INCLUDE_MARKER} is this repository's and is
 * refreshed — including when the SDK it names has gone away, since gyp applies
 * that line to every build on the machine and a stale one breaks builds the
 * machine's own tools would have handled. A file *without* the marker is
 * somebody's own and is reported, never overwritten: the difference between a
 * convenience and a program editing a file another person keeps is that line.
 *
 * It exits 0 whatever it finds, and that is deliberate: this runs on every
 * install, and an install that worked should not fail because a convenience
 * could not be arranged. What it found is printed instead, and `pnpm run doctor`
 * is where the state of this machine is a verdict.
 *
 * Both of the hooks in `package.json` point here, and the pair is the point:
 * `pnpm:devPreinstall` is run by pnpm at the top of the install, *before* it
 * resolves or builds a single dependency, while `preinstall` runs after — so a
 * machine that has never built these natives gets the SDK in place before the
 * dependency that needs it compiles, and every later install is checked again
 * afterwards. Neither is a duplicate of the other, and `--ignore-scripts` skips
 * both, which is the one case a person is on their own.
 *
 * Usage:
 *   node scripts/point-sdkroot.mjs             # point it, if it needs pointing
 *   node scripts/point-sdkroot.mjs --dry-run   # say what it would do, write nothing
 */

import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  GYP_INCLUDE_MARKER,
  gypIncludePath,
  linkProbe,
  pointGypAtSdk,
  resolveSdk,
  sdkFromGypInclude,
} from "./native-toolchain.mjs";

/** Everything this file does, with the machine and the files injectable. */
export function run({
  platform = process.platform,
  home = os.homedir(),
  dryRun = false,
  probe = linkProbe,
  resolve = resolveSdk,
  point = pointGypAtSdk,
  read = null,
  log = console.log,
} = {}) {
  if (platform !== "darwin") {
    log(
      `[sdkroot] nothing to point at on ${platform} — a native build here uses this platform's own toolchain`,
    );
    return 0;
  }

  const include = gypIncludePath({ home });

  /*
   * What is already in the file, before any compiler runs.
   *
   * This is the cheap and common case: after the first install the file says the
   * right thing, and asking the linker to prove again what it proved last time
   * would cost a compile on every install for an answer nothing has changed.
   * `read` is injectable so the spec never looks at a real home directory.
   */
  const existing = (read ?? defaultRead)(include);
  const ours = existing !== null && existing.includes(GYP_INCLUDE_MARKER);
  const pinned = ours ? sdkFromGypInclude(existing) : null;
  const pinnedLinks = pinned === null ? null : probe({ sdkPath: pinned });

  if (pinnedLinks?.ok) {
    log(`[sdkroot] ${include} still points a node-gyp build at ${pinned}`);
    return 0;
  }

  /*
   * The awkward case: the file is ours, and the SDK it names is gone — an Xcode
   * that was replaced, a path that moved. gyp applies that one line to every
   * `.gyp` it reads, so leaving it alone is worse than having no file at all: a
   * machine whose own tools link perfectly well would still fail the build,
   * with an error about a directory that does not exist. It is replaced below,
   * and when nothing better resolves this says which file to delete rather than
   * reporting the machine as healthy.
   */
  const stale = pinned !== null;

  const asItStands = probe({});
  if (asItStands.ok && !stale) {
    log(
      `[sdkroot] a node-gyp build links as this machine stands — nothing to point anywhere`,
    );
    return 0;
  }

  const sdk = resolve({});
  if (!sdk.ok || sdk.sdkPath === null) {
    log(
      stale
        ? `[sdkroot] ${include} names ${pinned}, which no longer links (${pinnedLinks?.detail}), and no usable macOS SDK was found to replace it — delete that file and a build falls back to this machine's own tools; see ATR-057 in docs/REMAINING-WORK.md`
        : `[sdkroot] a node-gyp build cannot link (${asItStands.detail}) and no macOS SDK was found to point it at — see ATR-057 in docs/REMAINING-WORK.md`,
    );
    return 0;
  }

  const sdkPath = sdk.env?.SDKROOT ?? sdk.sdkPath;
  if (dryRun) {
    log(
      `[sdkroot] would point a node-gyp build at ${sdkPath} in ${include} — ` +
        (stale
          ? `the file there names ${pinned}, which no longer links (${pinnedLinks?.detail})`
          : `a build as this machine stands cannot link (${asItStands.detail})`),
    );
    return 0;
  }

  const verdict = point({ sdkPath, home });
  log(
    `[sdkroot] ${verdict.reason}` +
      (verdict.foreign
        ? ` — add \`'SDKROOT': '${sdkPath}'\` to it to point a plain \`pnpm rebuild\` at an SDK that links`
        : verdict.wrote
          ? `, so \`pnpm rebuild\` links without \`SDKROOT\` exported by hand`
          : ""),
  );
  return 0;
}

/** `fs.readFileSync` with every failure — including "no such file" — as `null`. */
function defaultRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
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
  process.exit(run({ dryRun: process.argv.includes("--dry-run") }));
}
