#!/usr/bin/env node
/**
 * Assert what is *inside* the DMG, before it is published.
 *
 * Everything else in the release pipeline checks the upload or the bundle on the
 * runner: `release:verify` reads the three assets back from GitHub, and "Verify
 * what was signed" runs `codesign` against `release/mac-arm64/AllTheRepos.app`.
 * Neither of them ever opens the disk image. So the one artifact a person
 * actually installs was the one thing nothing asserted, and the failure that
 * hides there is quiet: `dmg.contents` is a config block, and defining it
 * replaces electron-builder's defaults, so dropping the `READ-ME-FIRST.txt` entry
 * ships a DMG whose only instructions on a refused first launch are simply
 * absent. The first symptom would be somebody stuck at a Gatekeeper dialog with
 * nothing to read — on the one launch where nothing inside the app is running to
 * explain it.
 *
 * This was found by hand: the v0.1.7 DMG was downloaded and mounted to confirm
 * `READ-ME-FIRST.txt` had made it in, because no step in the workflow could
 * answer that question. Now one can.
 *
 * What it checks, and each of these is a way a DMG can be wrong while every
 * other gate is green:
 *
 *   1. **The file that explains the first launch is there**, and its bytes are
 *      what `scripts/first-launch.mjs` renders. Not "a file of that name" — the
 *      same bytes the release notes and the CI warning are rendered from, so a
 *      DMG carrying last month's instructions fails too.
 *   2. **The app is there**, named as `electron-builder.yml` builds it.
 *   3. **The Applications link is there**, and points at `/Applications`. It is
 *      the second half of the drag-to-install gesture and the easiest thing to
 *      lose by editing `dmg.contents`.
 *   4. **The bundle is the version being released** — the DMG's job is to carry
 *      that version, and a mismatch means the image was built before the bump.
 *   5. **It passes `codesign --verify`**, which is the only check here about
 *      whether the copy runs at all.
 *
 * Mounted read-only, and detached in a `finally`, because a runner that leaves
 * a volume mounted fails the *next* step with a message about the disk rather
 * than about the build.
 *
 * Usage:
 *   node scripts/verify-dmg.mjs                      # release/AllTheRepos-<version>-arm64.dmg
 *   node scripts/verify-dmg.mjs --dmg path/to/one.dmg
 *   node scripts/verify-dmg.mjs --version 0.0.0      # a rehearsal's scratch version
 *
 * Exit codes: 0 — the DMG contains what a release needs · 1 — it does not, and
 * every reason is printed · 2 — the check could not run (no disk image, no
 * `hdiutil`, it would not mount).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APP_NAME, firstDifference, renderReadMeFirst } from "./first-launch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The bundle's name inside the image, derived so the two cannot disagree. */
export const APP_BUNDLE = `${APP_NAME}.app`;

/** The link that makes the image a drag-to-install gesture. */
export const APPLICATIONS_LINK = "Applications";

/** Where the link has to point, or it is not the drag target anybody expects. */
export const APPLICATIONS_TARGET = "/Applications";

/** The DMG electron-builder produces for this version. */
export function defaultDmgPath({ root = ROOT, version } = {}) {
  const released = version ?? readVersion(root);
  return path.join(root, "release", `${APP_NAME}-${released}-arm64.dmg`);
}

/** The version in `package.json`, which is what a real release builds. */
export function readVersion(root = ROOT) {
  return JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
}

/**
 * What is wrong with the DMG, if anything.
 *
 * Pure, so every way the image can be wrong is unit-tested against a fixture
 * rather than against a 129 MB disk image, and so the messages — which are the
 * entire value of a check like this — can be read and edited without mounting
 * anything. `codesign` is `{ ok, output }` or null when it was never run.
 *
 * @returns {{ failures: string[], notes: string[] }}
 */
export function assessDmg({
  entries = [],
  applicationsTarget = null,
  readMe = null,
  expectedReadMe = renderReadMeFirst(),
  bundleVersion = null,
  expectedVersion = null,
  codesign = null,
} = {}) {
  const failures = [];
  const notes = [];

  if (!entries.includes(APP_BUNDLE)) {
    failures.push(
      `the image carries no ${APP_BUNDLE} — there is nothing to install`,
    );
  } else {
    notes.push(`${APP_BUNDLE}`);
  }

  if (!entries.includes(APPLICATIONS_LINK)) {
    failures.push(
      `the image carries no ${APPLICATIONS_LINK} link — the drag-to-install gesture has no target, which is what dropping the entry from \`dmg.contents\` does`,
    );
  } else if (applicationsTarget !== APPLICATIONS_TARGET) {
    failures.push(
      `the ${APPLICATIONS_LINK} link points at ${applicationsTarget ?? "nothing"}, not ${APPLICATIONS_TARGET}`,
    );
  } else {
    notes.push(`${APPLICATIONS_LINK} -> ${APPLICATIONS_TARGET}`);
  }

  if (readMe === null) {
    failures.push(
      "READ-ME-FIRST.txt is not inside the image — and this is the one surface a person can read *before* Gatekeeper refuses the launch, so a build missing it strands somebody at a dialog with nothing to explain it",
    );
  } else if (readMe !== expectedReadMe) {
    const difference = firstDifference(expectedReadMe, readMe);
    failures.push(
      `READ-ME-FIRST.txt is not what scripts/first-launch.mjs renders${
        difference
          ? ` — first difference at line ${difference.line}: the image says ${JSON.stringify(difference.actual)}, the source renders ${JSON.stringify(difference.expected)}`
          : ""
      }`,
    );
  } else {
    notes.push(`READ-ME-FIRST.txt (${Buffer.byteLength(readMe)} bytes, as rendered)`);
  }

  if (bundleVersion === null) {
    failures.push(
      `no ${APP_BUNDLE} to read a version from — or its Info.plist has no CFBundleShortVersionString`,
    );
  } else if (expectedVersion !== null && bundleVersion !== expectedVersion) {
    failures.push(
      `the bundle in the image is ${bundleVersion}, but this release is ${expectedVersion} — the image was built from a tree at the wrong version`,
    );
  } else {
    notes.push(`bundle version ${bundleVersion}`);
  }

  if (codesign !== null) {
    if (!codesign.ok) {
      failures.push(
        `codesign refused the bundle inside the image, so an installed copy would not launch: ${codesign.output}`,
      );
    } else {
      notes.push("codesign --verify --deep --strict");
    }
  }

  return { failures, notes };
}

/** One tool, both streams — `codesign` reports the useful half on stderr. */
function tool(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: !result.error && result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() ||
      String(result.error?.message ?? ""),
  };
}

/**
 * Mount the image, read it, hang it back up.
 *
 * The mount point is chosen rather than parsed out of `hdiutil`'s output: the
 * volume name is the app's, and `electron-builder.yml` is free to change it, so
 * a check that scraped it would break on a cosmetic edit and pass on a real one.
 */
export function run({
  root = ROOT,
  dmg = null,
  version = null,
  log = console.log,
  error = console.error,
} = {}) {
  const expectedVersion = version ?? readVersion(root);
  const image = dmg ?? defaultDmgPath({ root, version: expectedVersion });

  if (!fs.existsSync(image)) {
    error(
      `[verify-dmg] no disk image at ${image} — build one with \`pnpm electron:dist\`, or name it with --dmg`,
    );
    return 2;
  }

  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), "atr-verify-dmg-"));
  const attached = tool("hdiutil", [
    "attach",
    "-nobrowse",
    "-readonly",
    "-mountpoint",
    mountPoint,
    image,
  ]);

  if (!attached.ok) {
    fs.rmSync(mountPoint, { recursive: true, force: true });
    error(`[verify-dmg] ${image} would not mount: ${attached.output}`);
    return 2;
  }

  let report;
  try {
    const app = path.join(mountPoint, APP_BUNDLE);
    const readMePath = path.join(mountPoint, "READ-ME-FIRST.txt");
    const applications = path.join(mountPoint, APPLICATIONS_LINK);

    report = assessDmg({
      entries: fs.readdirSync(mountPoint),
      applicationsTarget: fs.existsSync(applications)
        ? fs.readlinkSync(applications)
        : null,
      readMe: fs.existsSync(readMePath)
        ? fs.readFileSync(readMePath, "utf8")
        : null,
      bundleVersion: fs.existsSync(app)
        ? plistVersion(app)
        : null,
      expectedVersion,
      codesign: fs.existsSync(app)
        ? tool("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app])
        : null,
    });
  } finally {
    const detached = tool("hdiutil", ["detach", mountPoint, "-quiet"]);
    fs.rmSync(mountPoint, { recursive: true, force: true });
    if (!detached.ok) {
      // Reported, never fatal: the verdict above is about the image's contents,
      // and a volume left attached is a problem for the *next* step.
      error(`[verify-dmg] could not detach ${mountPoint}: ${detached.output}`);
    }
  }

  const name = path.basename(image);
  for (const note of report.notes) log(`  · ${note}`);

  if (report.failures.length > 0) {
    for (const failure of report.failures) error(`  ✗ ${failure}`);
    error(
      `[verify-dmg] FAILED — ${name} is not a DMG this project can publish (${report.failures.length} problem(s))`,
    );
    return 1;
  }

  log(
    `[verify-dmg] OK — ${name} carries ${APP_BUNDLE} at ${expectedVersion}, the ${APPLICATIONS_LINK} link, and first-launch instructions that match what scripts/first-launch.mjs renders`,
  );
  return 0;
}

/** The version macOS would report for a bundle, from its own Info.plist. */
function plistVersion(app) {
  const read = tool("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    path.join(app, "Contents", "Info.plist"),
  ]);
  return read.ok ? read.output : null;
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: the same file has two paths
 * whenever a symlink is involved — on macOS `os.tmpdir()` hands back
 * `/var/folders/...` while the loader resolves it to `/private/var/...` — and a
 * string compare then quietly exits 0 as though the image had been opened and
 * found complete.
 */
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
  try {
    process.exit(
      run({
        dmg: flagValue(args, "--dmg"),
        version: flagValue(args, "--version"),
      }),
    );
  } catch (thrown) {
    console.error(`[verify-dmg] ${thrown?.message ?? thrown}`);
    process.exit(2);
  }
}
