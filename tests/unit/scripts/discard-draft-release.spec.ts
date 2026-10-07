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
 *   3. **The CLI**, against a stub `gh` on `PATH` — because injecting `gh` is
 *      also a blind spot: the real `ghExec`/`ghProbe` pair is the code that runs
 *      on the runner, and the drill's first dispatch showed how much can hide
 *      in there. That block is what caught a `TypeError` on the one path that
 *      only runs once a release has been found.
 *
 * The real thing is proven separately, on demand: `.github/workflows/
 * release.yml`'s `drill` job leaves a real draft in the releases repo and runs
 * this script against it. That covers what a stub cannot — that `gh` and the
 * API agree with the assumptions made here.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const SCRIPTS = path.resolve(__dirname, "..", "..", "..", "scripts");

type Decision = "no-credential" | "absent" | "published" | "draft";

interface DiscardModule {
  decide(input: {
    hasToken: boolean;
    found: boolean;
    isDraft: boolean | null;
  }): Decision;
  parseIsDraft(stdout: string | null | undefined): boolean | null;
  parseArgs(argv: string[]): { tag: string; error?: string };
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

describe("parseArgs", () => {
  test("reads --tag, and treats no flag as 'use the workflow's tag'", () => {
    expect(discard.parseArgs([])).toEqual({ tag: "" });
    expect(discard.parseArgs(["--tag", "drill-draft-123"])).toEqual({
      tag: "drill-draft-123",
    });
  });

  test("refuses a --tag with no value rather than quietly looking for nothing", () => {
    // Two different things must not collapse into one: no flag means "the tag
    // the workflow is releasing", while a flag with an empty value means the
    // caller's shell lost the argument. A cleanup that reports success having
    // looked for no release is the failure this file exists to prevent.
    for (const argv of [["--tag"], ["--tag", "--tag"], ["--tag", ""]]) {
      const parsed = discard.parseArgs(argv);
      expect(parsed.tag, JSON.stringify(argv)).toBe("");
      expect(parsed.error, JSON.stringify(argv)).toContain("usage:");
    }
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

  test("a tag passed in beats GITHUB_REF_NAME, which is how the drill aims it", () => {
    // The drill cannot do this through the environment: a step that sets a
    // `GITHUB_`-prefixed name is silently ignored by GitHub, so the script read
    // `main` — the branch a dispatch runs on — and reported that there was
    // nothing to clean up, with the scratch draft sitting right there.
    const { status, calls, lines } = run(
      { release: { isDraft: true }, tag: "drill-draft-37561945038" },
      { ...ENV, GITHUB_REF_NAME: "main" },
    );

    expect(status).toBe(0);
    expect(calls[0]).toEqual([
      "release",
      "view",
      "drill-draft-37561945038",
      "--repo",
      "acme/alltherepos-releases",
      "--json",
      "isDraft",
      "--jq",
      ".isDraft",
    ]);
    expect(lines.join("\n")).toContain("Draft drill-draft-37561945038 deleted.");
  });

  test("runs from --tag alone, with no GITHUB_REF_NAME to fall back on", () => {
    const withoutBranch = {
      GH_TOKEN: ENV.GH_TOKEN,
      RELEASES_REPO: ENV.RELEASES_REPO,
    };
    const { status, calls } = run(
      { release: { isDraft: true }, tag: "drill-draft-123" },
      withoutBranch,
    );

    expect(status).toBe(0);
    expect(calls[0][2]).toBe("drill-draft-123");
  });

  test("still refuses to run without a tag from either source", () => {
    const { status, calls } = run({ tag: "" }, {
      GH_TOKEN: ENV.GH_TOKEN,
      RELEASES_REPO: ENV.RELEASES_REPO,
    });
    expect(status).toBe(2);
    expect(calls).toEqual([]);
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

describe("the real CLI, against a stub gh on PATH", () => {
  // Everything above injects `gh`, which is what makes it hermetic — and also
  // what leaves the default `ghExec`/`ghProbe` pair untested. That pair is the
  // code that runs on the runner, and it held a real defect: `ghProbe` re-wrapped
  // `ghExec`'s `{ status, stdout }` result as `stdout`, so the moment `gh`
  // *succeeded* — the only case where a release is found, and therefore the only
  // case the drill cares about — `parseIsDraft` was handed an object and threw.
  // It could not fire on the failed dispatch either, because there `gh` exited
  // non-zero and took the catch branch. So: run the real thing.
  let dir: string;
  let callsPath: string;

  beforeAll(() => {
    dir = makeTmpDir("atr-gh-stub");
    callsPath = path.join(dir, "calls.log");
    // Answers like the API: a draft exists, the delete takes, and afterwards the
    // read-back finds nothing.
    fs.writeFileSync(
      path.join(dir, "gh"),
      [
        "#!/bin/sh",
        'echo "$@" >> "$GH_CALLS"',
        'case "$*" in',
        '  *"--json isDraft"*) echo true; exit 0 ;;',
        '  "release delete "*) exit 0 ;;',
        '  "release view "*) exit 1 ;;',
        "esac",
        "exit 0",
        "",
      ].join("\n"),
    );
    fs.chmodSync(path.join(dir, "gh"), 0o755);
  });

  afterAll(() => cleanupTmp(dir));

  /** The script, in a subprocess, with the stub `gh` ahead of the real one. */
  function invoke(args: string[], env: Record<string, string>) {
    // Cleared first, so an ambient GH_TOKEN or RELEASES_REPO in the developer's
    // shell cannot turn a case that expects "no credential" green by accident.
    const clean: Record<string, string | undefined> = { ...process.env };
    for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "RELEASES_REPO", "GITHUB_REF_NAME"]) {
      delete clean[name];
    }
    fs.writeFileSync(callsPath, "");
    const result = spawnSync(
      process.execPath,
      [path.join(SCRIPTS, "discard-draft-release.mjs"), ...args],
      {
        encoding: "utf8",
        env: {
          ...clean,
          PATH: `${dir}:${clean.PATH ?? ""}`,
          GH_CALLS: callsPath,
          ...env,
        },
      },
    );
    const calls = fs
      .readFileSync(callsPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      calls,
    };
  }

  test("deletes a draft found through --tag, and says so", () => {
    const { status, stdout, stderr, calls } = invoke(["--tag", "drill-draft-9"], {
      GH_TOKEN: "token",
      RELEASES_REPO: "acme/alltherepos-releases",
      // What a dispatch really carries — the branch, not the scratch tag.
      GITHUB_REF_NAME: "main",
    });

    expect(stderr).not.toContain("TypeError");
    expect(status).toBe(0);
    expect(calls[0]).toBe(
      "release view drill-draft-9 --repo acme/alltherepos-releases --json isDraft --jq .isDraft",
    );
    expect(calls[1]).toContain("release delete drill-draft-9");
    expect(stdout).toContain("Draft drill-draft-9 deleted.");
  });

  test("reads the tag from GITHUB_REF_NAME when no flag is given", () => {
    const { status, calls } = invoke([], {
      GH_TOKEN: "token",
      RELEASES_REPO: "acme/alltherepos-releases",
      GITHUB_REF_NAME: "v0.9.9",
    });

    expect(status).toBe(0);
    expect(calls[0]).toContain("release view v0.9.9 ");
  });

  test("a --tag with no value fails loudly instead of looking for nothing", () => {
    const { status, stderr, calls } = invoke(["--tag"], {
      GH_TOKEN: "token",
      RELEASES_REPO: "acme/alltherepos-releases",
      GITHUB_REF_NAME: "main",
    });

    expect(status).toBe(2);
    expect(stderr).toContain("usage: discard-draft-release.mjs [--tag <tag>]");
    expect(calls).toEqual([]);
  });

  test("asks GitHub nothing at all without a credential", () => {
    const { status, stdout, calls } = invoke([], {
      RELEASES_REPO: "acme/alltherepos-releases",
      GITHUB_REF_NAME: "v0.9.9",
    });

    expect(status).toBe(0);
    expect(calls).toEqual([]);
    expect(stdout).toContain("No publishing credential");
  });
});
