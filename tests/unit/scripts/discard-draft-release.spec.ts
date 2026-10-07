/**
 * Unit test for `scripts/discard-draft-release.mjs`.
 *
 * This is the release workflow's *failure* path — the code that only ever runs
 * after something has already gone wrong, which makes it the code nothing
 * exercises. So every branch is stated here instead:
 *
 *   1. **The decision** (`decide`) — pure, and the whole point of the file. The
 *      delete branch is reachable only from `found && isDraft === true`, so a
 *      published release cannot be deleted by any combination of the other
 *      inputs.
 *   2. **The run** (`runDiscard`) — driven with an injected `gh`, so every
 *      branch is covered without a release existing anywhere.
 *
 * The real thing is proven separately, on demand: `.github/workflows/
 * release.yml`'s `drill` job leaves a real draft in the releases repo and runs
 * this script against it. That covers what a stub cannot — that `gh` and the
 * API agree with the assumptions made here.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations).
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const SCRIPTS = path.resolve(__dirname, "..", "..", "..", "scripts");

type Decision = "no-credential" | "absent" | "published" | "draft";

interface DiscardModule {
  decide(input: {
    hasToken: boolean;
    found: boolean;
    isDraft: boolean | null;
  }): Decision;
  parseIsDraft(stdout: string | null | undefined): boolean | null;
  runDiscard(options?: Record<string, unknown>): number;
}

let discard: DiscardModule;

beforeAll(async () => {
  discard = (await import(
    pathToFileURL(path.join(SCRIPTS, "discard-draft-release.mjs")).href
  )) as DiscardModule;
});

const ENV = {
  GH_TOKEN: "token",
  RELEASES_REPO: "acme/alltherepos-releases",
  GITHUB_REF_NAME: "v0.2.0",
};

/**
 * A `gh` that answers from a script of replies and records every call.
 *
 * `release view` answers with the release's `isDraft` — and once the release has
 * been deleted, answers as absent, which is how the script's read-back confirms
 * the delete took. `release delete` removes it from the table, so the read-back
 * is answered by the same state the delete produced.
 */
function harness({
  release = null,
  failDelete = false,
}: {
  release?: { isDraft: boolean } | null;
  failDelete?: boolean;
} = {}) {
  let current = release;
  const calls: string[][] = [];

  const gh = (args: string[]) => {
    calls.push(args);
    const [group, verb] = args;
    if (group !== "release") throw new Error(`unexpected gh ${args.join(" ")}`);

    if (verb === "view") {
      if (!current) {
        const error = new Error("release not found");
        Object.assign(error, { status: 1, stdout: "" });
        throw error;
      }
      const wantsDraft = args.includes("--jq");
      return wantsDraft ? String(current.isDraft) : "{\"isDraft\": false}";
    }

    if (verb === "delete") {
      if (failDelete) {
        const error = new Error("could not delete");
        Object.assign(error, { status: 1, stdout: "" });
        throw error;
      }
      current = null;
      return "";
    }
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };

  const lines: string[] = [];
  return {
    calls,
    lines,
    exec: (args: string[]) => gh(args),
    probe: (args: string[]) => {
      try {
        return { status: 0, stdout: gh(args) ?? "" };
      } catch (error) {
        const typed = error as { status?: number; stdout?: string };
        return { status: typed.status ?? 1, stdout: typed.stdout ?? "" };
      }
    },
    log: (line: string) => lines.push(line),
    error: (line: string) => lines.push(line),
  };
}

function run(
  {
    release = null,
    failDelete = false,
    ...overrides
  }: {
    release?: { isDraft: boolean } | null;
    failDelete?: boolean;
    [key: string]: unknown;
  } = {},
  env: Record<string, string> = ENV,
) {
  const h = harness({ release, failDelete });
  const status = discard.runDiscard({
    env,
    exec: h.exec,
    probe: h.probe,
    log: h.log,
    error: h.error,
    ...overrides,
  });
  return { status, ...h };
}

describe("decide", () => {
  test("only a draft is ever deleted", () => {
    expect(discard.decide({ hasToken: true, found: true, isDraft: true })).toBe(
      "draft",
    );
  });

  test("a published release is left alone, whatever else is true", () => {
    expect(discard.decide({ hasToken: true, found: true, isDraft: false })).toBe(
      "published",
    );
    // `isDraft` unknown must not fall through to deleting: the read-back
    // failing is not evidence that a release is disposable.
    expect(discard.decide({ hasToken: true, found: true, isDraft: null })).toBe(
      "published",
    );
  });

  test("nothing to do without a credential, or without a release", () => {
    expect(discard.decide({ hasToken: false, found: true, isDraft: true })).toBe(
      "no-credential",
    );
    expect(discard.decide({ hasToken: true, found: false, isDraft: null })).toBe(
      "absent",
    );
  });
});

describe("parseIsDraft", () => {
  test("reads gh's output, and refuses to guess", () => {
    expect(discard.parseIsDraft("true\n")).toBe(true);
    expect(discard.parseIsDraft("false")).toBe(false);
    expect(discard.parseIsDraft("")).toBeNull();
    expect(discard.parseIsDraft(null)).toBeNull();
    expect(discard.parseIsDraft("release not found")).toBeNull();
  });
});

describe("runDiscard", () => {
  test("deletes a draft, and only after reading isDraft back", () => {
    const { status, calls, lines } = run({ release: { isDraft: true } });

    expect(status).toBe(0);
    expect(calls[0]).toEqual([
      "release",
      "view",
      "v0.2.0",
      "--repo",
      "acme/alltherepos-releases",
      "--json",
      "isDraft",
      "--jq",
      ".isDraft",
    ]);
    expect(calls[1]).toEqual([
      "release",
      "delete",
      "v0.2.0",
      "--repo",
      "acme/alltherepos-releases",
      "--yes",
    ]);
    // The read-back that proves it went.
    expect(calls[2]).toEqual([
      "release",
      "view",
      "v0.2.0",
      "--repo",
      "acme/alltherepos-releases",
    ]);
    expect(lines.join("\n")).toContain("Draft v0.2.0 deleted.");
  });

  test("leaves a published release alone — the case that must never break", () => {
    const { status, calls, lines } = run({ release: { isDraft: false } });

    expect(status).toBe(0);
    expect(calls.some((args) => args.includes("delete"))).toBe(false);
    expect(lines.join("\n")).toContain("leaving it alone");
  });

  test("does nothing when the run failed before anything was uploaded", () => {
    const { status, calls, lines } = run({});

    expect(status).toBe(0);
    expect(calls.some((args) => args.includes("delete"))).toBe(false);
    expect(lines.join("\n")).toContain("nothing to clean up");
  });

  test("asks GitHub nothing at all without a credential", () => {
    const { status, calls, lines } = run({}, { ...ENV, GH_TOKEN: "" });

    expect(status).toBe(0);
    expect(calls).toEqual([]);
    expect(lines.join("\n")).toContain("No publishing credential");
  });

  test("fails when the delete itself fails, and says what to do", () => {
    const { status, lines } = run({
      release: { isDraft: true },
      failDelete: true,
    });

    expect(status).toBe(1);
    expect(lines.join("\n")).toContain("::error::");
    expect(lines.join("\n")).toContain("remove it by hand");
  });

  test("fails when the draft survives the delete", () => {
    // `gh release delete` exits 0 but the release is still there — the state
    // that would otherwise look like a clean-up and be found later. Here the
    // delete is a no-op, so the read-back still finds the release.
    const h = harness({ release: { isDraft: true } });
    const status = discard.runDiscard({
      env: ENV,
      exec: () => "",
      probe: h.probe,
      log: h.log,
      error: h.error,
    });

    expect(status).toBe(1);
    expect(h.lines.join("\n")).toContain("after the delete");
  });

  test("refuses to run without the tag or the repo to look in", () => {
    for (const env of [
      { ...ENV, GITHUB_REF_NAME: "" },
      { ...ENV, RELEASES_REPO: "" },
    ]) {
      const { status, calls } = run({}, env);
      expect(status, JSON.stringify(env)).toBe(2);
      expect(calls).toEqual([]);
    }
  });
});

describe("the workflow step that runs this", () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "..", ".github/workflows/release.yml"),
    "utf8",
  );
  /** Prose is stripped: the file *explains* `--cleanup-tag` in a comment. */
  const source = fs
    .readFileSync(path.join(SCRIPTS, "discard-draft-release.mjs"), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");

  /** The lines of one step, from its `- name:` to the next step or job. */
  function stepLines(name: string): string {
    const lines = workflow.split("\n");
    const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
    expect(start, `release.yml has no step named "${name}"`).toBeGreaterThan(-1);
    const indent = lines[start].search(/\S/);
    const block = [lines[start]];
    for (const line of lines.slice(start + 1)) {
      if (line.trim().length === 0) {
        block.push(line);
        continue;
      }
      if (line.search(/\S/) <= indent) break;
      block.push(line);
    }
    return block.join("\n");
  }

  test("the step invokes the script, and carries a credential to do it with", () => {
    const step = stepLines("Discard the draft a failed run left behind");
    expect(step).toContain("node scripts/discard-draft-release.mjs");
    expect(step).toContain("GH_TOKEN: ${{ secrets.RELEASES_TOKEN }}");
  });

  test("the script never aims --cleanup-tag at the releases repo", () => {
    // The tag lives in the *source* repo; `--cleanup-tag` here would delete
    // something in the wrong repository.
    expect(source).not.toContain("--cleanup-tag");
  });
});
