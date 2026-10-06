/**
 * Unit test for `scripts/verify-release.mjs` (ATR-048).
 *
 * Every check is a pure function over API-shaped fixtures, so the whole matrix
 * of "a release that looks published but cannot be used" runs here instead of
 * against GitHub: a draft, a missing DMG, a missing manifest, a manifest that
 * names a version nobody published, a manifest pointing at a file that was
 * never attached, a stale size, a wrong tag.
 *
 * The script is imported by URL rather than by path: it is a `.mjs` CLI with no
 * type declarations, and loading it dynamically keeps TypeScript out of a
 * resolution problem it cannot solve — the same trick the release-notes spec
 * uses to drive a copy of that script.
 *
 * One case runs it as a *program* instead of importing it, because that half is
 * the one that can fail silently: the entry-point guard, which decides whether
 * `main()` runs at all. A guard that never matches exits 0 having checked
 * nothing, so a release would look verified without being looked at.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const SCRIPT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "verify-release.mjs",
);

interface Manifest {
  version: string | null;
  path: string | null;
  files: Array<{ url: string; size: number | null }>;
}

interface Audit {
  failures: string[];
  warnings: string[];
  notes: string[];
}

interface VerifyModule {
  parseManifest(text: string): Manifest;
  findRelease(
    releases: unknown,
    tag: string,
  ): { tag_name?: string; draft?: boolean } | null;
  auditRelease(input: {
    release: unknown;
    manifestText?: string | null;
    tag: string;
    expectedVersion: string;
    allowDraft?: boolean;
    latestTag?: string | null;
  }): Audit;
}

let verify: VerifyModule;

beforeAll(async () => {
  verify = (await import(pathToFileURL(SCRIPT).href)) as VerifyModule;
});

const MANIFEST = [
  "version: 0.2.0",
  "files:",
  "  - url: AllTheRepos-0.2.0-arm64-mac.zip",
  "    sha512: PmVmFye/abc==",
  "    size: 121",
  "path: AllTheRepos-0.2.0-arm64-mac.zip",
  "sha512: PmVmFye/abc==",
  "releaseDate: '2026-10-06T20:08:30.749Z'",
  "",
].join("\n");

/** A release that passes every check; each test breaks exactly one thing. */
function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: "v0.2.0",
    draft: false,
    prerelease: false,
    assets: [
      { name: "AllTheRepos-0.2.0-arm64.dmg", size: 125 },
      { name: "AllTheRepos-0.2.0-arm64-mac.zip", size: 121 },
      { name: "AllTheRepos-0.2.0-arm64-mac.zip.blockmap", size: 1 },
      { name: "latest-mac.yml", size: 359 },
    ],
    ...overrides,
  };
}

function audit(
  releaseOverrides: Record<string, unknown> = {},
  input: Record<string, unknown> = {},
) {
  return verify.auditRelease({
    release: release(releaseOverrides),
    manifestText: MANIFEST,
    tag: "v0.2.0",
    expectedVersion: "0.2.0",
    ...input,
  });
}

describe("parseManifest", () => {
  test("reads the version, the followed file and each file's size", () => {
    const manifest = verify.parseManifest(MANIFEST);

    expect(manifest.version).toBe("0.2.0");
    expect(manifest.path).toBe("AllTheRepos-0.2.0-arm64-mac.zip");
    expect(manifest.files).toEqual([
      { url: "AllTheRepos-0.2.0-arm64-mac.zip", size: 121 },
    ]);
  });

  test("returns nulls rather than throwing on an unfamiliar manifest", () => {
    const manifest = verify.parseManifest("something: else\n");

    expect(manifest.version).toBeNull();
    expect(manifest.path).toBeNull();
    expect(manifest.files).toEqual([]);
  });
});

describe("findRelease", () => {
  // The whole reason this exists: the release workflow verifies a *draft*, and
  // `GET /releases/tags/{tag}` 404s for drafts. Only the list endpoint returns
  // them, so the release is picked out of that list — and picking the wrong
  // entry would verify somebody else's release.
  const releases = [
    { tag_name: "v0.1.1", draft: true, assets: [] },
    { tag_name: "v0.1.0", draft: false, assets: [] },
  ];

  test("finds the draft the by-tag endpoint refuses to return", () => {
    expect(verify.findRelease(releases, "v0.1.1")).toEqual(releases[0]);
  });

  test("finds a published release too, so one path serves both calls", () => {
    expect(verify.findRelease(releases, "v0.1.0")).toEqual(releases[1]);
  });

  test("returns null for a tag nobody released", () => {
    expect(verify.findRelease(releases, "v0.9.9")).toBeNull();
  });

  test("survives a malformed body rather than verifying nothing", () => {
    expect(verify.findRelease(null, "v0.1.1")).toBeNull();
    expect(verify.findRelease({ message: "Not Found" }, "v0.1.1")).toBeNull();
    expect(verify.findRelease([null, undefined], "v0.1.1")).toBeNull();
  });
});

describe("auditRelease", () => {
  test("a complete release passes and reports its three artifacts", () => {
    const result = audit();

    expect(result.failures).toEqual([]);
    expect(result.notes).toHaveLength(3);
    expect(result.notes.join(" ")).toContain(".dmg");
    expect(result.notes.join(" ")).toContain("latest-mac.yml");
  });

  test("a draft fails, unless the caller is checking a draft on purpose", () => {
    expect(audit({ draft: true }).failures.join(" ")).toMatch(/draft/);
    expect(audit({ draft: true }, { allowDraft: true }).failures).toEqual([]);
  });

  test("a pre-release is a warning, not a failure", () => {
    const result = audit({ prerelease: true });

    expect(result.failures).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/pre-release/);
  });

  test("a different latest release is reported, so a stale tag is noticed", () => {
    const result = audit({}, { latestTag: "v0.3.0" });

    expect(result.failures).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/v0\.3\.0/);
  });

  test("a tag that does not match fails", () => {
    expect(audit({ tag_name: "v0.1.9" }).failures.join(" ")).toMatch(
      /tagged v0\.1\.9/,
    );
  });

  test("a missing DMG fails", () => {
    const assets = release().assets.filter(
      (asset) => !asset.name.endsWith(".dmg"),
    );
    expect(audit({ assets }).failures.join(" ")).toMatch(/no \.dmg attached/);
  });

  test("a missing ZIP fails", () => {
    const assets = release().assets.filter(
      (asset) => !asset.name.endsWith(".zip"),
    );
    expect(audit({ assets }).failures.join(" ")).toMatch(/no \.zip attached/);
  });

  test("a missing update manifest fails before any manifest checks", () => {
    const assets = release().assets.filter(
      (asset) => asset.name !== "latest-mac.yml",
    );
    const result = audit({ assets });

    expect(result.failures.join(" ")).toMatch(/no latest-mac\.yml attached/);
    expect(result.failures.join(" ")).not.toMatch(/names no file/);
  });

  test("a manifest naming the wrong version fails", () => {
    expect(audit({}, { expectedVersion: "0.3.0" }).failures.join(" ")).toMatch(
      /says version 0\.2\.0, expected 0\.3\.0/,
    );
  });

  test("a manifest naming an unattached file fails", () => {
    const manifestText = MANIFEST.replace(
      "AllTheRepos-0.2.0-arm64-mac.zip",
      "AllTheRepos-0.2.0-arm64.zip",
    );
    expect(audit({}, { manifestText }).failures.join(" ")).toMatch(
      /not attached to the release/,
    );
  });

  test("a manifest whose size disagrees with the asset fails", () => {
    const manifestText = MANIFEST.replace("size: 121", "size: 999");
    expect(audit({}, { manifestText }).failures.join(" ")).toMatch(
      /declares 999 bytes .* attached file is 121/,
    );
  });

  test("a manifest naming no file at all fails", () => {
    const manifestText = "version: 0.2.0\nfiles: []\n";
    expect(audit({}, { manifestText }).failures.join(" ")).toMatch(
      /names no file/,
    );
  });
});

describe("the CLI entry point", () => {
  const fixtures: string[] = [];

  afterEach(() => {
    while (fixtures.length > 0) cleanupTmp(fixtures.pop());
  });

  test("runs when this file is the program Node was asked to run", () => {
    // A copy in a temp directory — reached through a symlink on macOS, which is
    // exactly the case a naive `import.meta.url === argv[1]` compare loses.
    const dir = makeTmpDir("atr-verify-release");
    fixtures.push(dir);
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    for (const script of ["verify-release.mjs", "release-config.mjs"]) {
      fs.copyFileSync(
        path.join(path.dirname(SCRIPT), script),
        path.join(dir, "scripts", script),
      );
    }

    // No `--repo`, no `RELEASES_REPO`, and no publish block to fall back on, so
    // the script must complain about it — and only a guard that fired can.
    const env = { ...process.env };
    delete env.RELEASES_REPO;
    delete env.GITHUB_REF_NAME;
    const result = spawnSync(
      process.execPath,
      [path.join(dir, "scripts", "verify-release.mjs")],
      { cwd: dir, encoding: "utf8", env },
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("[verify-release]");
    expect(result.stderr).toContain("electron-builder.yml");
  });
});
