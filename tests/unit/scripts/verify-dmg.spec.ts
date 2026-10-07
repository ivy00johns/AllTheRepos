/**
 * Unit test for `scripts/verify-dmg.mjs` — what a built DMG has to contain.
 *
 * The check exists because the artifact a person installs was the one thing the
 * release pipeline never opened: `release:verify` reads the three assets back
 * from GitHub, and "Verify what was signed" runs `codesign` against the bundle on
 * the runner, but nothing looked *inside* the disk image. And `dmg.contents` is a
 * config block that replaces electron-builder's defaults, so an entry dropped
 * there ships a DMG missing the only instructions that exist before the app can
 * run.
 *
 * The decisions are what is tested here, against fixtures, because that is where
 * the value is: a failure message is the whole product of a check like this, and
 * it should be readable and editable without mounting a 129 MB image. The mount
 * itself — that `hdiutil` is called correctly, that the volume is detached — is
 * proven where it cannot be faked, by running the script against a real DMG.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "verify-dmg.mjs");

interface Assessment {
  failures: string[];
  notes: string[];
}

interface DmgModule {
  APP_BUNDLE: string;
  APPLICATIONS_LINK: string;
  APPLICATIONS_TARGET: string;
  defaultDmgPath(options?: { root?: string; version?: string }): string;
  readVersion(root?: string): string;
  assessDmg(input?: Record<string, unknown>): Assessment;
  run(options?: {
    root?: string;
    dmg?: string | null;
    version?: string | null;
    log?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  }): number;
}

let dmg: DmgModule;

beforeAll(async () => {
  dmg = (await import(pathToFileURL(SCRIPT).href)) as unknown as DmgModule;
});

/**
 * Everything right, so each test can spoil exactly one thing.
 *
 * `readMe` is built from the module under test rather than pasted: the file's
 * contents are not this spec's business — that they are what the *source*
 * renders is, and a literal here would be a fourth copy of the instructions.
 */
function complete(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const app = dmg.APP_BUNDLE;
  const expectedReadMe = "the instructions a person reads inside the DMG\n";
  return {
    entries: [app, dmg.APPLICATIONS_LINK, "READ-ME-FIRST.txt", ".DS_Store"],
    applicationsTarget: dmg.APPLICATIONS_TARGET,
    readMe: expectedReadMe,
    expectedReadMe,
    bundleVersion: "0.1.7",
    expectedVersion: "0.1.7",
    codesign: { ok: true, output: "valid on disk" },
    ...overrides,
  };
}

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("a complete image passes, and says what it saw", () => {
  test("every guarantee it makes is reported as a note", () => {
    const report = dmg.assessDmg(complete());

    expect(report.failures).toEqual([]);
    const notes = report.notes.join("\n");
    expect(notes).toContain(dmg.APP_BUNDLE);
    expect(notes).toContain(`${dmg.APPLICATIONS_LINK} -> ${dmg.APPLICATIONS_TARGET}`);
    expect(notes).toContain("READ-ME-FIRST.txt");
    expect(notes).toContain("bundle version 0.1.7");
    expect(notes).toContain("codesign --verify --deep --strict");
  });

  test("its defaults are the app's own names, not a second spelling of them", () => {
    // Names, because a renamed bundle would otherwise be checked for by a string
    // this file wrote down once and nobody updated.
    expect(dmg.APP_BUNDLE).toBe("AllTheRepos.app");
    expect(dmg.APPLICATIONS_LINK).toBe("Applications");
    expect(dmg.APPLICATIONS_TARGET).toBe("/Applications");

    // And the file it compares against is what the single source renders — so a
    // DMG carrying last month's instructions fails, which is the point.
    const images = dmg.assessDmg(complete({ readMe: null }));
    expect(images.failures.join()).toContain("READ-ME-FIRST.txt");
  });
});

describe("the first-launch file, which is why this check exists", () => {
  test("a DMG with no READ-ME-FIRST.txt fails, and says what that costs", () => {
    const report = dmg.assessDmg(complete({ entries: [dmg.APP_BUNDLE, dmg.APPLICATIONS_LINK], readMe: null }));

    expect(report.failures).toHaveLength(1);
    const failure = report.failures[0];
    // The consequence, not just the absence: `dmg.contents` dropping the entry is
    // a one-line config edit, and whoever reads this line is deciding whether to
    // block a release over it.
    expect(failure).toContain("READ-ME-FIRST.txt is not inside the image");
    expect(failure).toContain("Gatekeeper");
  });

  test("a DMG carrying instructions that are not what the source renders fails", () => {
    const stale = "Open the DMG, then right-click the app and choose Open once.\n";
    const report = dmg.assessDmg(complete({ readMe: stale }));

    expect(report.failures).toHaveLength(1);
    // Naming the line is the difference between a report and a puzzle.
    expect(report.failures[0]).toContain("first difference at line 1");
    expect(report.failures[0]).toContain("right-click");
  });

  test("content that differs only in whitespace is still a difference", () => {
    // A trailing-newline change is exactly the edit a hand-written file gets, and
    // it is the one that makes the file stop being what the source renders.
    const report = dmg.assessDmg(
      complete({ readMe: "the instructions a person reads inside the DMG\n\n" }),
    );
    expect(report.failures).toHaveLength(1);
  });

  test("an empty file is not mistaken for a present one", () => {
    // `null` means absent; the empty string is a file that is there and wrong,
    // and the two must not collapse into one message.
    const report = dmg.assessDmg(complete({ readMe: "" }));
    expect(report.failures[0]).toContain("is not what scripts/first-launch.mjs renders");
  });
});

describe("the rest of what an image has to carry", () => {
  test("no app bundle at all", () => {
    const report = dmg.assessDmg(complete({ entries: [dmg.APPLICATIONS_LINK] }));
    expect(report.failures.join()).toContain("there is nothing to install");
  });

  test("no Applications link, and what that breaks", () => {
    const report = dmg.assessDmg(complete({ entries: [dmg.APP_BUNDLE] }));
    expect(report.failures.join()).toContain("drag-to-install gesture has no target");
  });

  test("an Applications link aimed somewhere else", () => {
    const report = dmg.assessDmg(complete({ applicationsTarget: "/Users/me/Desktop" }));
    expect(report.failures.join()).toContain("not /Applications");
  });

  test("a link that exists but cannot be read is not a passing link", () => {
    const report = dmg.assessDmg(complete({ applicationsTarget: null }));
    expect(report.failures.join()).toContain("not /Applications");
  });

  test("a bundle whose version is not the release's", () => {
    const report = dmg.assessDmg(complete({ bundleVersion: "0.1.6" }));
    expect(report.failures.join()).toContain("built from a tree at the wrong version");
  });

  test("a bundle with no readable version", () => {
    const report = dmg.assessDmg(complete({ bundleVersion: null }));
    expect(report.failures.join()).toContain("CFBundleShortVersionString");
  });

  test("a bundle codesign refuses", () => {
    const report = dmg.assessDmg(
      complete({ codesign: { ok: false, output: "code object is not signed at all" } }),
    );
    expect(report.failures.join()).toContain("code object is not signed at all");
  });

  test("an unmade codesign claim is not a passing one", () => {
    // `null` — never run — must claim nothing in either direction, rather than
    // reporting a verification that did not happen.
    const report = dmg.assessDmg(complete({ codesign: null }));
    expect(report.failures).toEqual([]);
    expect(report.notes.join()).not.toContain("codesign");
  });

  test("every problem is reported, not just the first", () => {
    // Four independent things are wrong with an image that has nothing in it,
    // and a report that stopped at the first would send whoever reads it round
    // the loop once per problem.
    const report = dmg.assessDmg({ entries: [] });
    expect(report.failures).toHaveLength(4);

    const joined = report.failures.join("\n");
    for (const subject of [
      dmg.APP_BUNDLE,
      dmg.APPLICATIONS_LINK,
      "READ-ME-FIRST.txt",
      "version",
    ]) {
      expect(joined, `nothing in the report is about ${subject}`).toContain(subject);
    }
  });
});

describe("the CLI", () => {
  test("the default image is named after the version being released", () => {
    expect(dmg.defaultDmgPath({ root: ROOT, version: "9.9.9" })).toBe(
      path.join(ROOT, "release", "AllTheRepos-9.9.9-arm64.dmg"),
    );
    // ... and with no version named, after `package.json`'s.
    expect(dmg.defaultDmgPath({ root: ROOT })).toContain(
      `AllTheRepos-${dmg.readVersion(ROOT)}-arm64.dmg`,
    );
  });

  test("a missing image exits 2 and names the flag that would fix it", () => {
    const missing = runCli(["--dmg", path.join(ROOT, "release", "definitely-not-here.dmg")]);
    // 2, not 1: nothing was judged about an image, so this must not read as a
    // verdict on one.
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("--dmg");
    expect(missing.stderr).toContain("pnpm electron:dist");
  });
});
