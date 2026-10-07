/**
 * The release workflow has two things a reader cannot see by reading it once.
 *
 * **It has to clean up after itself.** A run that dies between "assets uploaded"
 * and "notes attached" leaves its assets on a draft: invisible to
 * `releases/latest`, invisible to `GET /releases/tags/{tag}`, and reused by the
 * next run. `v0.1.1` sat in exactly that state until a person noticed the gap in
 * the version list, which is not a detection mechanism. The step that deletes it
 * must never touch a **published** release, because the verification steps
 * *after* the publish can fail too and that release is what people are
 * downloading.
 *
 * **It has to stay provable.** That cleanup is the failure path, so it runs only
 * when something has already gone wrong — which is exactly the code nothing ever
 * exercises. Its decisions therefore live in `scripts/discard-draft-release.mjs`
 * (with unit tests; see its own spec), and this workflow carries a `drill` job
 * that leaves a real draft in the releases repo and runs that script against it.
 *
 * This test asserts the wiring that makes both true: that the step is still
 * there and still gated, that the logic is genuinely in the tested script rather
 * than inlined here, that the drill exists and cannot hurt the update feed, and
 * that a manual dispatch cannot publish a release.
 *
 * Text-level on purpose: neither a YAML parser nor a shell belongs in an
 * assertion about which keys a step carries, and the repo has no YAML
 * dependency. The behaviour is asserted where the behaviour lives.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const workflow = fs.readFileSync(
  path.join(ROOT, ".github/workflows/release.yml"),
  "utf8",
);

const CLEANUP_STEP = "Discard the draft a failed run left behind";
const PUBLISH_STEP = "Attach the notes and publish the draft";
const DRILL_JOB = "drill";

const lines = workflow.split("\n");

/** The lines of one list item at `indent`, up to the next one at that indent. */
function blockAt(startIndex: number, indent: number): string {
  const block = [lines[startIndex]];
  for (const line of lines.slice(startIndex + 1)) {
    if (line.trim().length === 0) {
      block.push(line);
      continue;
    }
    if (line.search(/\S/) <= indent) break;
    block.push(line);
  }
  return block.join("\n");
}

/** The lines of one step, from its `- name:` to the next step or job. */
function stepBlock(name: string): string {
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  expect(start, `release.yml has no step named "${name}"`).toBeGreaterThan(-1);
  return blockAt(start, lines[start].search(/\S/));
}

/** The lines of one job, from `  <name>:` to the next job. */
function jobBlock(name: string): string {
  const start = lines.findIndex((line) => line === `  ${name}:`);
  expect(start, `release.yml has no job named "${name}"`).toBeGreaterThan(-1);
  return blockAt(start, 2);
}

/** Prose stripped, for assertions about what a file *does*. */
function commands(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

const cleanup = stepBlock(CLEANUP_STEP);
const drill = jobBlock(DRILL_JOB);

describe("the draft cleanup step", () => {
  test("exists, and runs only when the build failed or was cancelled", () => {
    expect(cleanup).toContain(`- name: ${CLEANUP_STEP}`);
    expect(cleanup).toMatch(/if:.*failure\(\)/);
    expect(cleanup).toMatch(/if:.*cancelled\(\)/);
  });

  test("carries the credential it needs to delete anything", () => {
    expect(cleanup).toContain("GH_TOKEN: ${{ secrets.RELEASES_TOKEN }}");
  });

  test("runs after the publish, so it is the last thing to clean up", () => {
    const names = [...workflow.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
    expect(names, "the publish step is gone from release.yml").toContain(
      PUBLISH_STEP,
    );
    expect(names.indexOf(CLEANUP_STEP)).toBeGreaterThan(names.indexOf(PUBLISH_STEP));
  });

  test("keeps its decisions in the tested script, not inline", () => {
    // The step is a call. If the branching were inlined here, this file would be
    // the only place it was ever exercised — and it is the failure path, so it
    // would never be exercised at all.
    expect(cleanup).toContain("run: node scripts/discard-draft-release.mjs");
    expect(cleanup).not.toContain("gh release delete");
    expect(cleanup).not.toContain("isDraft");
  });

  test("does not try to delete the source repo's tag", () => {
    // `--cleanup-tag` here would aim at the releases repo while the tag lives in
    // the source repo. The script's own spec asserts it never passes the flag,
    // and the drill's *own* scratch tags are a different matter (see below).
    expect(cleanup).not.toContain("--cleanup-tag");
  });
});

describe("the workflow can prove the cleanup on demand", () => {
  test("a manual dispatch cannot publish — the release job needs a tag push", () => {
    expect(workflow).toMatch(/^  workflow_dispatch:/m);
    expect(jobBlock("release")).toMatch(/if: github\.event_name == 'push'/);
  });

  test("the drill exists, and only runs when dispatched", () => {
    expect(drill).toContain(`${DRILL_JOB}:`);
    expect(drill).toMatch(/if: github\.event_name == 'workflow_dispatch'/);
  });

  test("the drill leaves a real draft and runs the same script", () => {
    expect(drill).toContain("gh release create");
    expect(drill).toContain("--draft");
    expect(drill).toContain("gh release upload");
    expect(drill).toContain("node scripts/discard-draft-release.mjs");
    // ... and then checks that it is actually gone.
    expect(drill).toMatch(/if gh release view .*DRILL_DRAFT.*; then/);
  });

  test("the drill proves a published release is left alone", () => {
    expect(drill).toContain("--prerelease");
    expect(drill).toMatch(/Assert the published release was left alone/);
    expect(drill).toMatch(/if ! gh release view .*DRILL_PUBLISHED/);
  });

  test("the drill's scratch releases cannot reach the update feed", () => {
    // `releases/latest` skips pre-releases, so a drill can never become the
    // release the app offers — which matters, because the drill publishes one.
    expect(drill).toContain("--prerelease");
  });

  test("the drill deletes its scratch releases even when it fails", () => {
    const cleanupStep = commands(drill).slice(commands(drill).indexOf("if: always()"));
    expect(cleanupStep).toContain("gh release delete");
    expect(cleanupStep).toContain("--cleanup-tag");
  });

  test("the drill's scratch tags are namespaced so nothing else can match them", () => {
    expect(drill).toMatch(/DRILL_DRAFT: drill-draft-\$\{\{ github\.run_id \}\}/);
    expect(drill).toMatch(
      /DRILL_PUBLISHED: drill-published-\$\{\{ github\.run_id \}\}/,
    );
  });
});
