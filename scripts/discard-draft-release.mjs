#!/usr/bin/env node
/**
 * Delete the draft release a failed release run left behind.
 *
 * A run that dies between "assets uploaded" and "notes attached" leaves its
 * assets on a **draft**: invisible to `releases/latest` and to
 * `GET /releases/tags/{tag}`, so nobody sees it, and reused by the next run
 * that comes along. `v0.1.1` sat in exactly that state until a person noticed a
 * gap in the version list, which is not a detection mechanism.
 *
 * The release workflow's last step runs this only on a failure or a cancel.
 * The one property that step has to get right is that it must never touch a
 * release that is **published**: the verification steps *after* the publish can
 * fail too, and that release is what people are downloading. So nothing here is
 * inferred from which step failed — `isDraft` is read back from the API, and
 * only `true` deletes anything.
 *
 * It lives in a file rather than in the workflow's YAML for one reason: this is
 * the code path that can only run when something has already gone wrong, so it
 * is the code path nothing ever exercises. As a script it has unit tests for
 * every branch, and `.github/workflows/release.yml` has a `workflow_dispatch`
 * drill that leaves a **real** draft behind in the releases repo and runs this
 * against it — the on-demand proof that the cleanup works on GitHub, not just
 * against a stub.
 *
 * Deliberately never passes `--cleanup-tag`: the tag lives in the *source*
 * repo, not in the releases repo, so aiming it at that repo would delete
 * something that was never this script's to delete.
 *
 * Usage:
 *   node scripts/discard-draft-release.mjs
 *
 * Reads `GH_TOKEN`, `RELEASES_REPO` and `GITHUB_REF_NAME` from the environment,
 * which is exactly what the workflow step hands it.
 *
 * Exit codes: 0 — nothing was left behind (deleted, absent, or published and
 * left alone) · 1 — a draft survived this run · 2 — the check could not run at
 * all (no `gh`, or GitHub refused every call).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * What to do, decided from facts rather than from which step failed.
 *
 * Pure, so every branch is unit-tested. `"delete"` is reachable only from
 * `found && isDraft === true`, which is the guarantee the whole file exists for.
 *
 * @returns {"no-credential" | "absent" | "published" | "draft"}
 */
export function decide({ hasToken, found, isDraft }) {
  if (!hasToken) return "no-credential";
  if (!found) return "absent";
  return isDraft === true ? "draft" : "published";
}

/** `true`/`false` from `gh release view --json isDraft --jq .isDraft`. */
export function parseIsDraft(stdout) {
  const text = (stdout ?? "").trim();
  if (text === "true") return true;
  if (text === "false") return false;
  return null;
}

/** One `gh` call. Injected in the tests, which is what keeps them hermetic. */
function ghExec(args, { env, timeoutMs }) {
  const result = execFileSync("gh", args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
  return { status: 0, stdout: result };
}

/** Like `ghExec` but treats a non-zero exit as an answer rather than a crash. */
function ghProbe(args, options) {
  try {
    return { status: 0, stdout: ghExec(args, options) ?? "" };
  } catch (error) {
    return { status: error?.status ?? 1, stdout: error?.stdout ?? "" };
  }
}

export function runDiscard({
  env = process.env,
  exec = ghExec,
  probe = ghProbe,
  log = console.log,
  error = console.error,
  timeoutMs = 30_000,
} = {}) {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN ?? "";
  const repo = env.RELEASES_REPO ?? "";
  const tag = env.GITHUB_REF_NAME ?? "";
  const options = { env, timeoutMs };

  if (decide({ hasToken: token.length > 0, found: false, isDraft: null }) === "no-credential") {
    log(
      "No publishing credential, so nothing can have been uploaded — nothing to clean up.",
    );
    return 0;
  }
  if (repo.length === 0 || tag.length === 0) {
    error(
      "RELEASES_REPO and GITHUB_REF_NAME are both required to look for a draft.",
    );
    return 2;
  }

  const view = probe(
    ["release", "view", tag, "--repo", repo, "--json", "isDraft", "--jq", ".isDraft"],
    options,
  );
  const isDraft = view.status === 0 ? parseIsDraft(view.stdout) : null;

  const decision = decide({
    hasToken: true,
    found: view.status === 0 && isDraft !== null,
    isDraft,
  });

  if (decision === "absent") {
    log(`No release tagged ${tag} in ${repo} — nothing to clean up.`);
    return 0;
  }
  if (decision === "published") {
    log(`${tag} is published in ${repo} — leaving it alone.`);
    return 0;
  }

  log(
    `::warning::${repo} still holds ${tag} as a draft after a failed run; deleting it so the next attempt starts from nothing.`,
  );
  try {
    exec(["release", "delete", tag, "--repo", repo, "--yes"], options);
  } catch (thrown) {
    error(
      `::error::could not delete the draft ${tag} from ${repo} — remove it by hand before re-running, or the next attempt will reuse it. (${thrown?.message ?? thrown})`,
    );
    return 1;
  }

  const survivor = probe(["release", "view", tag, "--repo", repo], options);
  if (survivor.status === 0) {
    error(
      `::error::${repo} still has ${tag} after the delete — remove it by hand before re-running.`,
    );
    return 1;
  }

  log(`Draft ${tag} deleted.`);
  return 0;
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: the same file has two
 * paths whenever a symlink is involved — on macOS `os.tmpdir()` hands back
 * `/var/folders/...` while the loader resolves it to `/private/var/...` — and a
 * string compare then quietly does nothing at all, exiting 0 as if the cleanup
 * had run.
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
  process.exit(runDiscard());
}
