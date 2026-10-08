/**
 * Unit test for `scripts/install-native-prebuilds.mjs`.
 *
 * The script exists because `find-git-repositories` publishes one binary per
 * ABI at `bin/<platform>-<arch>-<modulesVersion>/`, while its `main` — what
 * `require(name)` loads — is `build/Release/findGitRepos.node`, a path only a
 * successful `node-gyp` build creates. When that build cannot link, the
 * publisher's own artifact for the ABI in hand sits in the tree unused and the
 * scanner worker throws instead.
 *
 * What is pinned here is that the copy lands exactly where the loader looks,
 * and that an ABI with no published binary is reported as missing rather than
 * repaired with the wrong one. The second half matters more than it looks: a
 * binary installed for the wrong ABI is a crash that reads like a code bug.
 *
 * The `bin/darwin-arm64-135/` layout below is a **fixture** — it is the
 * published shape that produced this repair, and it keeps the rule about
 * naming rather than about that package.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "install-native-prebuilds.mjs");

interface Plan {
  installs: Array<{ name: string; from: string; to: string }>;
  missing: Array<{ name: string; expected: string }>;
}

interface Module {
  PREBUILD_MODULES: Array<{ name: string; target: string }>;
  planInstalls(options: {
    root: string;
    platform: string;
    arch: string;
    abi: number;
    exists?: (candidate: string) => boolean;
  }): Plan;
  install(options: {
    root: string;
    platform?: string;
    arch?: string;
    abi?: number;
    log?: (message: string) => void;
    error?: (message: string) => void;
  }): { installed: string[]; missing: Plan["missing"] };
}

let script: Module;
const tempDirs: string[] = [];

beforeAll(async () => {
  script = (await import(pathToFileURL(SCRIPT).href)) as unknown as Module;
});

afterEach(() => {
  while (tempDirs.length > 0) cleanupTmp(tempDirs.pop());
});

/** A package root laid out the way the publisher ships it. */
function publishLayout(
  abi: number,
  { platform = "darwin", arch = "arm64" } = {},
): string {
  const root = makeTmpDir("atr-prebuild");
  tempDirs.push(root);
  const binDir = path.join(
    root,
    "node_modules",
    "find-git-repositories",
    "bin",
    `${platform}-${arch}-${abi}`,
  );
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, "find-git-repositories.node"),
    `binary-for-abi-${abi}`,
  );
  return root;
}

describe("planInstalls", () => {
  test("names the published binary and the path the loader requires", () => {
    const root = makeTmpDir("atr-prebuild-plan");
    tempDirs.push(root);

    const plan = script.planInstalls({
      root,
      platform: "darwin",
      arch: "arm64",
      abi: 135,
      exists: () => true,
    });

    expect(plan.missing).toEqual([]);
    expect(plan.installs).toHaveLength(1);
    expect(plan.installs[0].name).toBe("find-git-repositories");
    expect(plan.installs[0].from).toBe(
      path.join(
        root,
        "node_modules",
        "find-git-repositories",
        "bin",
        "darwin-arm64-135",
        "find-git-repositories.node",
      ),
    );
    expect(plan.installs[0].to).toBe(
      path.join(
        root,
        "node_modules",
        "find-git-repositories",
        "build",
        "Release",
        "findGitRepos.node",
      ),
    );
  });

  test("an unpublished ABI is missing, and the report says which ABI", () => {
    const root = makeTmpDir("atr-prebuild-plan");
    tempDirs.push(root);

    const plan = script.planInstalls({
      root,
      platform: "darwin",
      arch: "arm64",
      abi: 127,
      exists: (candidate) => candidate.includes("darwin-arm64-127") === false,
    });

    expect(plan.installs).toEqual([]);
    expect(plan.missing).toHaveLength(1);
    expect(plan.missing[0].expected).toContain("darwin-arm64-127");
  });
});

describe("install", () => {
  test("copies the shipped binary to the path require() resolves", () => {
    const root = publishLayout(135);
    const logged: string[] = [];

    const result = script.install({
      root,
      platform: "darwin",
      arch: "arm64",
      abi: 135,
      log: (message) => logged.push(message),
    });

    expect(result.installed).toEqual(["find-git-repositories"]);
    const installed = path.join(
      root,
      "node_modules",
      "find-git-repositories",
      "build",
      "Release",
      "findGitRepos.node",
    );
    expect(fs.readFileSync(installed, "utf8")).toBe("binary-for-abi-135");
    expect(logged.join("\n")).toContain("abi 135");
  });

  test("installs nothing when it is not told which ABI it is repairing", () => {
    const root = publishLayout(135);
    const errors: string[] = [];

    const result = script.install({
      root,
      platform: "darwin",
      arch: "arm64",
      error: (message) => errors.push(message),
    });

    expect(result).toEqual({ installed: [], missing: [] });
    expect(fs.existsSync(path.join(root, "node_modules", "find-git-repositories", "build"))).toBe(false);
    expect(errors.join("\n")).toContain("no --abi");
  });

  test("reports an ABI it has no binary for, instead of copying a wrong one", () => {
    const root = publishLayout(135);

    const result = script.install({
      root,
      platform: "darwin",
      arch: "arm64",
      abi: 127,
      log: () => {},
    });

    expect(result.installed).toEqual([]);
    expect(result.missing.map((entry) => entry.name)).toEqual([
      "find-git-repositories",
    ]);
    expect(fs.existsSync(path.join(root, "node_modules", "find-git-repositories", "build"))).toBe(false);
  });
});
