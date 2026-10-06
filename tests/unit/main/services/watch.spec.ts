/**
 * Unit tests for the watcher's ignore predicate.
 *
 * This function decides the entire cost of live watching. A regression
 * here doesn't produce a visible bug — it quietly starts watching every
 * `node_modules` on the machine — so the rules are pinned explicitly
 * rather than left to be re-derived.
 *
 * The predicate is pure, so no watcher, filesystem or database is
 * involved. `electron` is stubbed only because importing the module
 * pulls in the settings service.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/atr-watch-test" } }));

import { shouldIgnorePath } from "@main/services/watch";

const ROOT = "/Users/j/Repos";
const KNOWN = new Set([`${ROOT}/ai/alpha`, `${ROOT}/work/beta`]);

const ignored = (candidate: string) => shouldIgnorePath(candidate, ROOT, KNOWN);

describe("shouldIgnorePath", () => {
  it("watches the folder skeleton above repos", () => {
    // The root itself carries no information — an event ON the root is
    // just "something inside changed", which the child event covers.
    expect(ignored(ROOT)).toBe(true);
    expect(ignored(`${ROOT}/ai`)).toBe(false);
    expect(ignored(`${ROOT}/ai/gamma`)).toBe(false);
    expect(ignored(`${ROOT}/brand-new-folder`)).toBe(false);
  });

  it("bounds how deep a repo can be and still be noticed", () => {
    const deep = `${ROOT}/${Array.from({ length: 9 }, (_, i) => `d${i}`).join("/")}`;
    expect(ignored(deep)).toBe(true);
    expect(ignored(`${ROOT}/d0/d1/d2`)).toBe(false);
  });

  it("keeps a .git directory but prunes everything inside it", () => {
    // The marker itself is how a new repo announces itself…
    expect(ignored(`${ROOT}/ai/gamma/.git`)).toBe(false);
    // …but `.git/objects` alone can hold tens of thousands of dirs.
    expect(ignored(`${ROOT}/ai/gamma/.git/objects`)).toBe(true);
    expect(ignored(`${ROOT}/ai/gamma/.git/refs/heads`)).toBe(true);
  });

  it("prunes heavy build and dependency directories at any depth", () => {
    for (const heavy of [
      "node_modules",
      "dist",
      "target",
      ".venv",
      "__pycache__",
      ".next",
      "Pods",
      "coverage",
    ]) {
      expect(ignored(`${ROOT}/ai/gamma/${heavy}`), heavy).toBe(true);
      expect(ignored(`${ROOT}/${heavy}/nested/deep`), heavy).toBe(true);
    }
  });

  it("prunes the subtree of a repo it already knows about", () => {
    // This is the filter that makes the whole thing affordable.
    expect(ignored(`${ROOT}/ai/alpha/src`)).toBe(true);
    expect(ignored(`${ROOT}/ai/alpha/src/components/deep`)).toBe(true);
    // The repo directory itself stays watched, so its disappearance is
    // still observable.
    expect(ignored(`${ROOT}/ai/alpha`)).toBe(false);
  });

  it("still watches a known repo's own .git", () => {
    // Needed so re-cloning in place is noticed.
    expect(ignored(`${ROOT}/ai/alpha/.git`)).toBe(false);
  });

  it("does not let a shared name prefix prune a sibling", () => {
    // `alpha-2` is not inside `alpha`; a naive startsWith would hide it.
    expect(ignored(`${ROOT}/ai/alpha-2`)).toBe(false);
    expect(ignored(`${ROOT}/ai/alpha-2/src`)).toBe(false);
  });

  it("does not prune on a directory that merely contains a heavy name", () => {
    expect(ignored(`${ROOT}/ai/node_modules_backup`)).toBe(false);
    expect(ignored(`${ROOT}/ai/my-dist-tool`)).toBe(false);
  });

  it("ignores anything outside the watched root", () => {
    expect(ignored("/etc/passwd")).toBe(true);
    expect(ignored("/Users/j/Repos-other/thing")).toBe(true);
  });

  it("treats a root path with no known repos as fully watchable", () => {
    expect(shouldIgnorePath(`${ROOT}/ai/alpha/src`, ROOT, new Set())).toBe(
      false,
    );
  });
});
