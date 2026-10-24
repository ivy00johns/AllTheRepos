/**
 * Repository discovery — the rules wrapped around `find-git-repositories`.
 *
 * The one rule that matters here is the root that is itself a repository.
 * The native walker stops at the first `.git` it meets (it records the
 * directory and does not queue its children), so pointing the app at `~/Repos`
 * after an accidental `git init` there used to index exactly one repository and
 * hide every project below it — a green "done · 1 repos" with nothing under it
 * (ATR-033, audit SC-1).
 *
 * The walker is real here, not a fake: the pruning this module works around is
 * its behaviour, and a fake that pruned differently would let the test pass
 * while the app still failed. The control below pins that behaviour, so if a
 * future version of the dependency stops pruning, the reason this module
 * exists is re-examined rather than silently kept.
 *
 * Uses only the filesystem and the native addon — no DB, no Electron.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  discoverRepoRoots,
  type FindGitRepos,
} from "@main/services/scan-discovery";

const requireCjs = createRequire(import.meta.url);
const findGitRepos = requireCjs("find-git-repositories") as FindGitRepos;

let tmp = "";

/** A directory the walker will read as a repository: it only looks for `.git`. */
function makeRepo(dir: string): void {
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
}

/** Compare what the OS reports, not the spelling the test typed. */
function real(...paths: string[]): string[] {
  return paths.map((p) => fs.realpathSync(p)).sort();
}

function sort(paths: string[]): string[] {
  return [...paths].sort();
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atr-scan-discovery-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("discoverRepoRoots", () => {
  it("indexes the projects under a scan root that is itself a repository", async () => {
    const root = path.join(tmp, "Repos");
    makeRepo(root);
    makeRepo(path.join(root, "direct"));
    makeRepo(path.join(root, "plain", "inner"));

    const found = await discoverRepoRoots({
      roots: [root],
      findGitRepos,
    });

    // Three, not one: the root's own `.git` must not stand between the scan
    // and the projects it was pointed at.
    expect(sort(found)).toEqual(
      real(root, path.join(root, "direct"), path.join(root, "plain", "inner")),
    );
  });

  it("still finds every repository when the root is not one", async () => {
    const root = path.join(tmp, "Projects");
    makeRepo(path.join(root, "alpha"));
    makeRepo(path.join(root, "nested", "beta"));

    const found = await discoverRepoRoots({
      roots: [root],
      findGitRepos,
    });

    expect(sort(found)).toEqual(
      real(path.join(root, "alpha"), path.join(root, "nested", "beta")),
    );
  });

  it("skips an ignored repository, including one found by the root's expansion", async () => {
    const root = path.join(tmp, "Repos");
    makeRepo(root);
    makeRepo(path.join(root, "wanted"));
    makeRepo(path.join(root, "ignored"));

    const found = await discoverRepoRoots({
      roots: [root],
      ignorePaths: [path.join(root, "ignored")],
      findGitRepos,
    });

    expect(sort(found)).toEqual(real(root, path.join(root, "wanted")));
  });

  it("the native walker alone stops at the root — the behaviour being worked around", async () => {
    const root = path.join(tmp, "Repos");
    makeRepo(root);
    makeRepo(path.join(root, "child"));

    const alone = await findGitRepos(root, () => {});

    expect(alone).toHaveLength(1);
    // The walker echoes the path it was handed, so this is the root's `.git`
    // exactly — and nothing from beneath it.
    expect(alone[0]).toBe(path.join(root, ".git"));
  });
});
