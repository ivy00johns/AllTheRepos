/**
 * The release workflow has to clean up after itself, and nothing else does it.
 *
 * A run that dies between "assets uploaded" and "notes attached" leaves its
 * assets on a **draft**: invisible to `releases/latest`, invisible to
 * `GET /releases/tags/{tag}`, and reused by the next run that comes along.
 * `v0.1.1` sat in exactly that state until a person noticed the gap in the
 * version list, which is not a detection mechanism.
 *
 * So the workflow has a last step that deletes a draft a failed run left — and
 * the whole safety of that step is one condition: it must never touch a release
 * that is *published*, because the steps whose failure it is cleaning up after
 * can fail *after* the publish, and that release is what people are
 * downloading. This test exists so that condition cannot be quietly dropped,
 * widened, or moved.
 *
 * Two kinds of assertion, for two kinds of change:
 *
 *   1. **Text**, on the step as written in `release.yml` — that the step is
 *      still there, still gated on `failure() || cancelled()`, still reading
 *      `isDraft` back from the API, still not passing `--cleanup-tag`, and
 *      still positioned after the publish. Neither a YAML parser nor a shell
 *      belongs in an assertion about which keys a step carries; the repo has no
 *      YAML dependency and does not want one for this.
 *   2. **Behaviour**, by running the step's own shell against a stub `gh`. The
 *      property that matters is not what the text says but what the script
 *      *does* with a published release, and a text assertion cannot tell an
 *      `if` that gates the delete from an `if` that only looks like it does.
 *      The stub is why this can be checked without deleting a real release.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const workflow = fs.readFileSync(
  path.join(ROOT, ".github/workflows/release.yml"),
  "utf8",
);

const CLEANUP_STEP = "Discard the draft a failed run left behind";
const PUBLISH_STEP = "Attach the notes and publish the draft";

/** The lines of one step, from its `- name:` to the next step. */
function stepBlock(name: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  expect(start, `release.yml has no step named "${name}"`).toBeGreaterThan(-1);

  const indent = lines[start].search(/\S/);
  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      block.push(line);
      continue;
    }
    // A step ends where the next list item begins, or where the indentation
    // falls back out of this one.
    if (line.search(/\S/) <= indent && trimmed.startsWith("- ")) break;
    if (line.search(/\S/) < indent) break;
    block.push(line);
  }
  return block.join("\n");
}

/** The `run: |` body of a step, dedented as YAML would hand it to bash. */
function shellOf(block: string): string {
  const lines = block.split("\n");
  const runIndex = lines.findIndex((line) => /^\s+run: \|$/.test(line));
  expect(runIndex, "the step has no `run: |` block").toBeGreaterThan(-1);

  const runIndent = lines[runIndex].search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(runIndex + 1)) {
    if (line.trim().length === 0) {
      body.push("");
      continue;
    }
    if (line.search(/\S/) <= runIndent) break;
    body.push(line.slice(runIndent + 2));
  }
  return `${body.join("\n")}\n`;
}

const block = stepBlock(CLEANUP_STEP);
const shell = shellOf(block);

describe("the draft cleanup step", () => {
  test("exists, and runs only when the build failed or was cancelled", () => {
    expect(block).toContain(`- name: ${CLEANUP_STEP}`);
    expect(block).toMatch(/if:.*failure\(\)/);
    expect(block).toMatch(/if:.*cancelled\(\)/);
  });

  test("carries the credential it needs to delete anything", () => {
    expect(block).toContain("GH_TOKEN: ${{ secrets.RELEASES_TOKEN }}");
  });

  test("runs after the publish, so it is the last thing to clean up", () => {
    const names = [...workflow.matchAll(/^\s+- name: (.+)$/gm)].map(
      (match) => match[1],
    );
    const publish = names.indexOf(PUBLISH_STEP);
    expect(names, "the publish step is gone from release.yml").toContain(
      PUBLISH_STEP,
    );
    expect(names.indexOf(CLEANUP_STEP)).toBeGreaterThan(publish);
  });

  test("asks the API what the release is, instead of assuming", () => {
    // `isDraft` is read back because a failure *after* the publish must leave a
    // live release alone; inferring the state from which step failed would get
    // exactly that case wrong.
    expect(shell).toMatch(/gh release view[\s\S]*--json isDraft/);
    expect(shell).toMatch(/--jq \.isDraft/);
  });

  test("deletes inside the draft branch, and never from the published one", () => {
    const draftCheck = shell.indexOf('"$is_draft" = "true"');
    const deletion = shell.indexOf("gh release delete");
    expect(draftCheck, "nothing compares isDraft to true").toBeGreaterThan(-1);
    expect(deletion, "nothing deletes the release").toBeGreaterThan(-1);
    expect(
      deletion,
      "the delete is not inside the draft branch — it would run for a published release",
    ).toBeGreaterThan(draftCheck);

    // Whatever the published branch does, it must not delete.
    const published = shell.slice(shell.indexOf("else", deletion));
    expect(published).not.toContain("release delete");
    expect(published).toContain("leaving it alone");
  });

  test("never tries to publish the failed run, and never deletes the tag", () => {
    // Publishing assets from a run that failed partway is the one thing there
    // is least reason to trust, and the tag lives in the *source* repo, so
    // `--cleanup-tag` would aim at the wrong repository entirely.
    //
    // Comments are stripped first: the step *explains* `--cleanup-tag` in prose,
    // which is the reason it is absent, and an assertion on the raw file would
    // have to choose between the explanation and the guarantee.
    const commands = workflow
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");

    expect(block).not.toContain("--draft=false");
    expect(commands).not.toContain("--cleanup-tag");
  });

  test("fails loudly when the draft it was asked to delete survives", () => {
    expect(shell).toContain("::error::");
    expect(shell).toMatch(/if gh release view .*>\/dev\/null 2>&1; then/);
    expect(shell).toContain("remove it by hand");
  });
});

// --- the step's own shell, against a stub gh ------------------------------

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) cleanupTmp(dirs.pop());
});

/**
 * A `gh` that answers from `GH_MODE`, and logs every call.
 *
 * `release delete` always succeeds unless the mode says otherwise, so the case
 * under test is what the *step* decides, not what gh does.
 */
function writeStubGh(binDir: string): void {
  const stub = path.join(binDir, "gh");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env bash
echo "gh $*" >> "$GH_LOG"
args="$*"
if [[ "$args" == "release delete "* ]]; then
  if [ "$GH_MODE" = "delete-fails" ]; then
    echo "could not delete" >&2
    exit 1
  fi
  exit 0
fi
if [[ "$args" == *"--jq .isDraft"* ]]; then
  case "$GH_MODE" in
    absent) echo "release not found" >&2; exit 1 ;;
    published) echo "false" ;;
    *) echo "true" ;;
  esac
  exit 0
fi
# A plain \`release view\`: the read-back that confirms the delete took.
case "$GH_MODE" in
  draft) echo "release not found" >&2; exit 1 ;;
  *) exit 0 ;;
esac
`,
  );
  fs.chmodSync(stub, 0o755);
}

function runCleanupStep(
  mode: "draft" | "published" | "absent" | "delete-fails",
  token = "token",
) {
  const dir = makeTmpDir("atr-draft-cleanup");
  dirs.push(dir);
  const binDir = path.join(dir, "bin");
  fs.mkdirSync(binDir);
  writeStubGh(binDir);

  const script = path.join(dir, "step.sh");
  fs.writeFileSync(script, shell);
  const log = path.join(dir, "gh.log");
  fs.writeFileSync(log, "");

  // `bash -eo pipefail` is the shell GitHub Actions runs a `run:` block with,
  // so the `-e` semantics the step relies on are the ones being exercised.
  const result = spawnSync("bash", ["-eo", "pipefail", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      GH_LOG: log,
      GH_MODE: mode,
      GH_TOKEN: token,
      GITHUB_REF_NAME: "v0.2.0",
      RELEASES_REPO: "acme/alltherepos-releases",
    },
  });

  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    calls: fs.readFileSync(log, "utf8"),
  };
}

describe("the cleanup step's behaviour", () => {
  test("deletes a draft the failed run left behind, and confirms it went", () => {
    const { status, output, calls } = runCleanupStep("draft");

    expect(status).toBe(0);
    expect(output).toContain("::warning::");
    expect(output).toContain("Draft v0.2.0 deleted.");
    expect(calls).toContain(
      "gh release delete v0.2.0 --repo acme/alltherepos-releases --yes",
    );
    expect(calls).not.toContain("--cleanup-tag");
  });

  test("leaves a published release alone — the case that must never break", () => {
    const { status, output, calls } = runCleanupStep("published");

    expect(status).toBe(0);
    expect(output).toContain("leaving it alone");
    expect(calls).not.toContain("release delete");
    expect(calls).not.toContain("--cleanup-tag");
  });

  test("does nothing when the run failed before anything was uploaded", () => {
    const { status, output, calls } = runCleanupStep("absent");

    expect(status).toBe(0);
    expect(output).toContain("nothing to clean up");
    expect(calls).not.toContain("release delete");
  });

  test("does nothing, and asks GitHub nothing, without a credential", () => {
    const { status, output, calls } = runCleanupStep("draft", "");

    expect(status).toBe(0);
    expect(output).toContain("No publishing credential");
    expect(calls).toBe("");
  });

  test("fails the step when the draft survives the delete", () => {
    const { status, output } = runCleanupStep("delete-fails");

    expect(status).toBe(1);
    expect(output).toContain("::error::");
    expect(output).toContain("remove it by hand");
  });
});
