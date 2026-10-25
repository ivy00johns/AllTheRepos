#!/usr/bin/env node
/**
 * Point this repository's Releases tab at the download.
 *
 * The binaries are published to a separate, public releases-only repository —
 * the feed `src/main/services/updater.ts` reads, so any install can check for an
 * update with an anonymous request. That is the right place for them and it is
 * not going to change. What it left behind was a **source** repository whose
 * Releases tab was empty: a person who wants the app clicks Releases, finds
 * nothing, and reasonably concludes they have to build it. `v0.3.1` had been
 * published, verified and announced for a day when that was still true.
 *
 * So a tag push also writes a release **here**, at the same tag, whose body is
 * the signpost: where the `.dmg` is, why it is on another page, and what the
 * source archives GitHub adds are not. No assets are ever uploaded — this page
 * stays a signpost, and an asset attached to it would be a second copy of the
 * release to keep in step with `latest-mac.yml` by hand.
 *
 * The notes are the same changelog section the real release carries, extracted
 * by `scripts/release-notes.mjs` rather than by a second copy of that logic
 * (which would also drop the tag/version guard this gets for free by asking it).
 *
 * Usage:
 *   node scripts/source-release.mjs --tag v0.3.1              # create or update
 *   node scripts/source-release.mjs --tag v0.3.1 --dry-run    # print the body only
 *   node scripts/source-release.mjs --tag 0.0.0-signpost.7 --rehearse
 *
 * Reads `RELEASES_REPO` (owner/repo of the binaries) and `GITHUB_REPOSITORY`
 * (owner/repo of this one) from the environment, which is what the release
 * workflow's `source-release` job hands it. `--releases-repo` and `--repo`
 * override them for a hand run.
 *
 * `--rehearse` writes the same page as a **draft**, at a scratch tag, for the
 * weekly rehearsal. The job only ever ran on a tag push, which made the one run
 * of it that matters the first run of it: a token without write access here, or
 * a body this script stopped building, would have been found by a release rather
 * than by a Monday. A draft is the shape that can be written and read back
 * without appearing anywhere — it is invisible on the Releases tab, sends no
 * notification, and owns no tag ref, so it cannot trip the `v*` filter above and
 * start a release. The job deletes it again.
 *
 * Its notes come from `package.json`'s version rather than from the tag, because
 * a scratch tag names no version. The guard still runs — it is asked about the
 * version instead of about the tag — so a missing changelog section fails a
 * rehearsal exactly as it fails a release.
 *
 * Exit codes: 0 — the page now points at the download (or a dry run printed it)
 * · 1 — bad usage, or the notes guard failed · 2 — GitHub could not be reached
 * or refused the write.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The body of the signpost, before the changelog section.
 *
 * Every link is built from `releasesRepo` and `tag` rather than written out, so
 * a release cannot point at a page it was not published to. The tag page and
 * `releases/latest` are both offered: the first is the build this note is about,
 * the second is the one worth bookmarking because it keeps resolving.
 *
 * @returns {string}
 */
export function releaseBody({ tag, releasesRepo, notes }) {
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  const page = `https://github.com/${releasesRepo}/releases/tag/${tag}`;
  const latest = `https://github.com/${releasesRepo}/releases/latest`;

  return [
    "## 📦 Download",
    "",
    `**[Download AllTheRepos ${version} for macOS →](${page})** — the \`.dmg\` is the first asset on that page (Apple silicon).`,
    "",
    `This page is a signpost rather than the release itself. The binaries live in`,
    `[\`${releasesRepo}\`](${latest}), the public releases-only repository the app's updater`,
    "reads, so an installed copy can check for a new version with an anonymous request and",
    "without access to this source repository. That page redirects to the newest release, so",
    "it is the one worth bookmarking.",
    "",
    "Nothing is attached to this release, and the **Source code (zip)** and **(tar.gz)** rows",
    "GitHub adds by itself are this tag's source tree — not an installer. Building them is not",
    "how you get the app.",
    "",
    "---",
    "",
    notes.trim(),
    "",
  ].join("\n");
}

/**
 * The `--tag` and friends, read from `argv` (everything after the script path).
 *
 * A flag with nothing after it is an error rather than an empty value: a shell
 * that lost an argument must not turn into a run that points a release at a page
 * named after nothing.
 *
 * @returns {{ tag: string, repo: string, releasesRepo: string, notesFile: string, dryRun: boolean, rehearse: boolean, error?: string }}
 */
export function parseArgs(argv, env = process.env) {
  const parsed = {
    tag: "",
    repo: env.GITHUB_REPOSITORY ?? "",
    releasesRepo: env.RELEASES_REPO ?? "",
    notesFile: "",
    dryRun: false,
    rehearse: false,
  };

  const value = (flag) => {
    const at = argv.indexOf(flag);
    if (at === -1) return null;
    const next = argv[at + 1];
    if (next === undefined || next.startsWith("--")) {
      return { error: `${flag} needs a value` };
    }
    return next;
  };

  for (const [flag, key] of [
    ["--tag", "tag"],
    ["--repo", "repo"],
    ["--releases-repo", "releasesRepo"],
    ["--notes-file", "notesFile"],
  ]) {
    const found = value(flag);
    if (found && typeof found === "object") {
      return { ...parsed, error: found.error };
    }
    if (found !== null) parsed[key] = found;
  }

  parsed.dryRun = argv.includes("--dry-run");
  parsed.rehearse = argv.includes("--rehearse");

  // A rehearsal writes at a name that is not a version, and this is the one
  // mistake that would outlive the run: a draft filed at `v0.5.0` is a release
  // the next real `v0.5.0` cannot create, because `gh` answers "already exists"
  // — and the draft is invisible, so nothing says why. Refusing is cheaper than
  // that, and a `v` tag is the whole signal needed.
  if (parsed.rehearse && parsed.tag.startsWith("v")) {
    return {
      ...parsed,
      error: `--rehearse writes a scratch page, so --tag must not name a release (got ${parsed.tag})`,
    };
  }

  if (parsed.tag === "") {
    // No default from `package.json` on purpose: the workflow always passes the
    // pushed tag, and a hand run that guesses could point the page at a version
    // that has no download behind it.
    return { ...parsed, error: "--tag is required, e.g. --tag v0.3.1" };
  }
  if (parsed.repo === "") {
    return { ...parsed, error: "--repo (or GITHUB_REPOSITORY) is required" };
  }
  if (parsed.releasesRepo === "") {
    return {
      ...parsed,
      error: "--releases-repo (or RELEASES_REPO) is required",
    };
  }
  return parsed;
}

/**
 * Is this `gh api` failure "there is no release at that tag"?
 *
 * The distinction decides whether a run creates a release or edits one, and
 * getting it wrong is quiet in both directions: treating a 404 as an error stops
 * the first release of every version, and treating an auth failure as a 404
 * makes the script try to create a release it is not allowed to create and
 * report *that* error instead. So a 404 is recognised by GitHub's own words, and
 * everything else is an error.
 */
export function isMissingRelease(error) {
  const text = `${error?.stderr ?? ""}${error?.message ?? ""}`;
  return /HTTP 404|Not Found/i.test(text);
}

/** `release:view` for this repository, or `null` when the tag has no release. */
function readExistingRelease(repo, tag) {
  try {
    execFileSync("gh", ["api", `repos/${repo}/releases/tags/${tag}`], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return true;
  } catch (error) {
    if (isMissingRelease(error)) return false;
    throw error;
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) {
    console.error(`[source-release] ${options.error}`);
    return 1;
  }

  let notes;
  if (options.notesFile !== "") {
    notes = fs.readFileSync(options.notesFile, "utf8");
  } else {
    // A rehearsal's tag is a scratch name, so asking the guard about it would
    // fail on "not a version" every Monday. Ask it about the version instead:
    // same guard, same changelog section, and a rehearsal still fails when the
    // section a release would need is missing.
    const notesArgs = options.rehearse ? [] : [options.tag];
    try {
      notes = execFileSync(
        process.execPath,
        [path.join(ROOT, "scripts", "release-notes.mjs"), ...notesArgs],
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
      );
    } catch {
      // release-notes has already said why on stderr: a tag that disagrees with
      // `package.json`, or a version with no changelog section. Repeating it in
      // this script's voice would be a second, shorter copy of the same message.
      return 1;
    }
  }

  const body = releaseBody({
    tag: options.tag,
    releasesRepo: options.releasesRepo,
    notes,
  });

  if (options.dryRun) {
    process.stdout.write(body);
    return 0;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-source-release-"));
  const bodyFile = path.join(dir, "body.md");
  fs.writeFileSync(bodyFile, body);

  try {
    const exists = readExistingRelease(options.repo, options.tag);
    const args = exists
      ? ["release", "edit", options.tag]
      : ["release", "create", options.tag];
    execFileSync(
      "gh",
      [
        ...args,
        "--repo",
        options.repo,
        "--title",
        options.tag,
        "--notes-file",
        bodyFile,
        // A rehearsal's page is a draft: nothing to see, nothing announced, and
        // no tag ref of its own — which is what keeps the scratch name from
        // matching the workflow's `v*` tag filter and starting a release.
        ...(options.rehearse ? ["--draft"] : []),
      ],
      { stdio: "inherit" },
    );
    console.log(
      options.rehearse
        ? `[source-release] wrote a scratch draft ${options.tag} in ${options.repo} — the rehearsal's page, which the job removes again`
        : `[source-release] ${exists ? "updated" : "created"} ${options.repo} ${options.tag} — points at https://github.com/${options.releasesRepo}/releases/tag/${options.tag}`,
    );
    return 0;
  } catch (error) {
    console.error(
      `[source-release] GitHub refused to write the signpost: ${error.message}`,
    );
    return 2;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
