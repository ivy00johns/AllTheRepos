#!/usr/bin/env node
/**
 * Derive the next release — version, changelog section, commit and tag.
 *
 * `scripts/release-notes.mjs` stops a *release* whose tag disagrees with
 * `package.json` or has no changelog section, but until now the bump itself was
 * typed by hand, which is the one remaining step that can go wrong quietly: a
 * forgotten changelog entry, a version that should have been a minor, a tag
 * pushed a commit too early.
 *
 * This reads the commits since the last tag and proposes the result:
 *
 *   - the **level**, by conventional-commit rules — `!` or `BREAKING CHANGE`
 *     means major, any `feat` means minor, anything else means patch;
 *   - a **changelog section** built from those commits, grouped
 *     Added / Changed / Fixed, merged with whatever was already hand-written
 *     under `[Unreleased]` (nothing you wrote by hand is discarded);
 *   - the **version** in `package.json` and the changelog's link references.
 *
 * Nothing is written without `--write`, and nothing leaves the machine without
 * `--push`. That is the approval step, and the reason the default is a plan:
 * read it, then re-run with `--write --tag --push`.
 *
 * The baseline is the last `v*` tag, so a repository that has never been tagged
 * has nothing to count from — it refuses rather than counting the whole history,
 * which would fold already-released work into the next version.
 *
 * Usage:
 *   node scripts/next-release.mjs                       # plan only
 *   node scripts/next-release.mjs --level minor         # override the guess
 *   node scripts/next-release.mjs --write               # edit the two files
 *   node scripts/next-release.mjs --write --tag         # commit and tag
 *   node scripts/next-release.mjs --write --tag --push  # ... and push (triggers CI)
 *
 * Exit codes: 0 — plan produced (or write/tag/push done) · 1 — nothing to
 * release · 2 — the script could not run (bad usage, git failure).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readReleasesRepo } from "./release-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Section order in the changelog; anything unrecognised lands before Breaking. */
const SECTION_ORDER = [
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
  "Notes",
  "Breaking changes",
];

/** Conventional types, routed to the changelog section they belong in. */
const GROUP_FOR_TYPE = {
  feat: "Added",
  fix: "Fixed",
  perf: "Fixed",
};
const DEFAULT_GROUP = "Changed";

/**
 * Split a conventional-commit subject.
 *
 * Non-conventional subjects are kept rather than dropped — they still shipped,
 * and a person reading the release notes is better served by the subject as
 * written than by it going missing.
 */
export function parseCommit(subject) {
  const match = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(subject);
  if (!match) {
    return { type: null, scope: null, breaking: false, description: subject };
  }
  return {
    type: match[1],
    scope: match[2] ?? null,
    breaking: Boolean(match[3]),
    description: match[4],
  };
}

/** major / minor / patch, or null when there is nothing to release. */
export function decideLevel(commits) {
  if (commits.length === 0) return null;
  const parsed = commits.map((commit) => ({
    ...parseCommit(commit.subject),
    body: commit.body ?? "",
  }));
  if (parsed.some((c) => c.breaking || /BREAKING[ -]CHANGE/.test(c.body))) {
    return "major";
  }
  if (parsed.some((c) => c.type === "feat")) return "minor";
  return "patch";
}

export function bumpVersion(version, level) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`"${version}" is not a version`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown level "${level}"`);
}

/** The changelog sections these commits imply, before any merging. */
export function sectionsFromCommits(commits) {
  const sections = [];
  const byHeading = new Map();
  const add = (heading, bullet) => {
    if (!byHeading.has(heading)) {
      const section = { heading, bullets: [] };
      byHeading.set(heading, section);
      sections.push(section);
    }
    byHeading.get(heading).bullets.push(bullet);
  };

  for (const commit of commits) {
    const parsed = parseCommit(commit.subject);
    const heading = parsed.type
      ? (GROUP_FOR_TYPE[parsed.type] ?? DEFAULT_GROUP)
      : DEFAULT_GROUP;
    // A scope or a bang is worth keeping: "feat(api)!: drop v1" reads very
    // differently once the punctuation is stripped.
    const prefix = parsed.scope ? `${parsed.scope}: ` : "";
    add(heading, `${prefix}${parsed.description}`);
    if (parsed.breaking || /BREAKING[ -]CHANGE/.test(commit.body ?? "")) {
      add(
        "Breaking changes",
        `${prefix}${parsed.description} (${commit.hash ?? "unknown"})`,
      );
    }
  }
  return sections;
}

/**
 * `### Heading` blocks of a changelog body, bullets and all.
 *
 * A bullet is its marker line plus the lines directly under it, kept verbatim
 * — hand-written entries wrap, and a bullet truncated at its first line is
 * worse than no bullet at all ("`pnpm release:next` derives the next version
 * and its changelog section from"). A blank line therefore ends a bullet, and
 * a continuation line is passed through with its indentation, so what lands in
 * the released section is what was written.
 */
export function parseSections(body) {
  const sections = [];
  let current = null;
  let lines = null;

  const flush = () => {
    if (lines && current) current.bullets.push(lines.join("\n"));
    lines = null;
  };

  for (const line of body.split("\n")) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      current = { heading: heading[1], bullets: [] };
      sections.push(current);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet && current) {
      flush();
      lines = [bullet[1].trim()];
      continue;
    }
    if (lines) {
      if (line.trim().length === 0) flush();
      else lines.push(line.trimEnd());
    }
  }
  flush();

  return sections.filter((section) => section.bullets.length > 0);
}

/**
 * Fold hand-written sections into the derived ones, matching by heading so a
 * bullet a person wrote under `### Changed` stays under `### Changed`.
 *
 * This is the whole reason the merge exists: the commits describe what
 * happened, and the hand-written lines describe why it mattered — losing
 * either is worse than a slightly longer section.
 */
export function mergeSections(derived, handWritten) {
  const merged = derived.map((section) => ({
    heading: section.heading,
    bullets: [...section.bullets],
  }));
  const find = (heading) =>
    merged.find((s) => s.heading.toLowerCase() === heading.toLowerCase());

  for (const section of handWritten) {
    const target = find(section.heading);
    if (target) target.bullets.push(...section.bullets);
    else merged.push({ heading: section.heading, bullets: [...section.bullets] });
  }

  return merged
    .filter((section) => section.bullets.length > 0)
    .sort((a, b) => {
      const rank = (section) => {
        const index = SECTION_ORDER.indexOf(section.heading);
        return index === -1 ? SECTION_ORDER.length - 1 : index;
      };
      return rank(a) - rank(b);
    });
}

export function renderVersionSection({ version, date, sections }) {
  const parts = [`## [${version}] - ${date}`];
  for (const section of sections) {
    parts.push("", `### ${section.heading}`, "");
    for (const bullet of section.bullets) parts.push(`- ${bullet}`);
  }
  return `${parts.join("\n")}\n`;
}

/** The version heading line and the body under it. */
function unreleasedRegion(changelog) {
  // `[^\S\n]` rather than `\s*`: `\s` matches newlines, so a trailing `\s*$`
  // swallows the blank line after the heading and the new section lands one
  // line further down than it should.
  const heading = /^##[^\S\n]+\[Unreleased\][^\S\n]*$/m.exec(changelog);
  if (!heading) {
    throw new Error('CHANGELOG.md has no "## [Unreleased]" heading');
  }
  const bodyStart = heading.index + heading[0].length;
  const rest = changelog.slice(bodyStart);
  const next = /^##\s+\[/m.exec(rest);
  const bodyEnd = next ? bodyStart + next.index : changelog.length;
  return { bodyStart, bodyEnd, body: changelog.slice(bodyStart, bodyEnd) };
}

/**
 * Put the new section under `[Unreleased]`, move the link references along,
 * and repoint the version links that releases have moved away from — and only
 * those, so a link somebody chose on purpose survives a bump.
 */
export function applyToChangelog(
  changelog,
  { version, date, sections, compareRepo, releasesRepo },
) {
  const { bodyStart, bodyEnd } = unreleasedRegion(changelog);
  const section = renderVersionSection({ version, date, sections });
  let next = `${changelog.slice(0, bodyStart)}\n\n${section}\n${changelog.slice(bodyEnd)}`;

  if (!compareRepo) {
    return { changelog: next, linkRefs: false };
  }

  // `readReleasesRepo` reports `owner/repo`, but a link reference needs a URL.
  // Accept either form here so no caller has to remember which one it holds.
  const releasesBase = /^https?:\/\//.test(releasesRepo ?? "")
    ? releasesRepo
    : `https://github.com/${releasesRepo}`;

  next = next.replace(
    /^\[Unreleased\]:.*$/m,
    `[Unreleased]: ${compareRepo}/compare/v${version}...HEAD`,
  );
  next = next.replace(
    /^\[Unreleased\]:.*$/m,
    (line) => `${line}\n[${version}]: ${releasesBase}/releases/tag/v${version}`,
  );
  // Older links are corrected only when they are the ones this repo moved
  // *away* from: `<source>/releases/tag/v1.2.3` is what the changelog carried
  // while releases lived in the source repo, and it does not resolve there any
  // more. Everything else is left exactly as written — a link already at the
  // releases repo, a version that was never published and points at a commit or
  // a compare by hand, anything. Sweeping every `[x.y.z]:` line was how the one
  // version with no release ended up pointing at a tag URL that 404s, and it
  // would re-break that link on the very next bump.
  const versionLink = /^\[(\d+\.\d+\.\d+)\]:[^\S\n]*(\S+)$/gm;
  next = next.replace(versionLink, (line, tag, url) =>
    url === `${compareRepo}/releases/tag/v${tag}`
      ? `[${tag}]: ${releasesBase}/releases/tag/v${tag}`
      : line,
  );
  return { changelog: next, linkRefs: true };
}

// --- CLI -------------------------------------------------------------------

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`,
    );
  }
  return result;
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
}

function lastTag() {
  const result = git(["describe", "--tags", "--abbrev=0", "--match", "v*"], {
    allowFailure: true,
  });
  const tag = (result.stdout ?? "").trim();
  return tag.length > 0 ? tag : null;
}

/** `https://github.com/owner/repo` for origin, in either URL form. */
function originUrl() {
  const url = (git(["remote", "get-url", "origin"], { allowFailure: true }).stdout ?? "").trim();
  if (!url) return null;
  const ssh = /^git@([^:]+):(.+)$/.exec(url);
  if (ssh) return `https://${ssh[1]}/${ssh[2].replace(/\.git$/, "")}`;
  const https = /^https?:\/\/(.+)$/.exec(url);
  if (https) return `https://${https[1].replace(/\.git$/, "")}`;
  return null;
}

function readCommits(range) {
  const format = "%h%x1f%s%x1f%b%x1e";
  const raw = git(["log", "--no-merges", `--format=${format}`, range]).stdout;
  return raw
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, subject, body] = record.split("\x1f");
      return { hash, subject, body: body ?? "" };
    })
    .filter(
      (commit) =>
        !/^Merge /.test(commit.subject) &&
        !/^chore: release v\d/.test(commit.subject),
    );
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const tag = args.includes("--tag");
  const push = args.includes("--push");
  const levelOverride = flagValue(args, "--level");
  const date = flagValue(args, "--date") ?? new Date().toISOString().slice(0, 10);

  if (push && !tag) throw new Error("--push requires --tag");
  if (tag && !write) throw new Error("--tag requires --write");
  if (levelOverride && !["major", "minor", "patch"].includes(levelOverride)) {
    throw new Error(`--level must be major, minor or patch (got "${levelOverride}")`);
  }

  const packagePath = path.join(ROOT, "package.json");
  const changelogPath = path.join(ROOT, "CHANGELOG.md");
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const current = pkg.version;
  const changelog = fs.readFileSync(changelogPath, "utf8");

  const from = flagValue(args, "--from") ?? lastTag();
  if (!from) {
    // With no baseline the range would be the entire history, so on a repo that
    // has already shipped, released work would be folded into the next version
    // — and the section describing it dropped on the way. Which commits belong
    // to the release that already happened is not something this can infer, so
    // it stops and says what to do instead of guessing a version.
    throw new Error(
      `nothing is tagged, so there is no \"since\" to count from. If v${current} is the version that shipped, tag it first (git tag v${current}) and run this again; otherwise name a baseline with --from <ref>.`,
    );
  }
  const commits = readCommits(`${from}..HEAD`);
  const level = levelOverride ?? decideLevel(commits);

  if (!level) {
    console.log(`[next-release] nothing to release — no commits since ${from}.`);
    process.exit(1);
  }

  const version = bumpVersion(current, level);
  const sections = mergeSections(
    sectionsFromCommits(commits),
    parseSections(unreleasedRegion(changelog).body),
  );
  const compareRepo = originUrl();
  const releasesRepo = readReleasesRepo(ROOT);

  console.log(`[next-release] ${from} -> v${version}`);
  console.log(
    `  ${commits.length} commit(s), level ${level}${levelOverride ? " (forced)" : ""}, ${current} -> ${version}`,
  );
  console.log(
    `  sections: ${sections.map((s) => `${s.heading} (${s.bullets.length})`).join(", ")}`,
  );
  console.log(
    `  notes come from commits; hand-written [Unreleased] bullets are merged in, not replaced`,
  );
  console.log("\n--- CHANGELOG section ---\n");
  console.log(
    renderVersionSection({ version, date, sections })
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"),
  );

  if (!write) {
    console.log(
      `\n[next-release] plan only. Re-run with --write (and --tag, --push) to apply.`,
    );
    console.log(`  files it would touch: package.json, CHANGELOG.md`);
    return;
  }

  pkg.version = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  const applied = applyToChangelog(changelog, {
    version,
    date,
    sections,
    compareRepo,
    releasesRepo,
  });
  fs.writeFileSync(changelogPath, applied.changelog);
  console.log(
    `\n[next-release] wrote package.json (${current} -> ${version}) and CHANGELOG.md`,
  );
  if (!applied.linkRefs) {
    console.warn(
      "[next-release] no origin remote — changelog link references were left alone",
    );
  }
  if (!tag) {
    console.log(
      `[next-release] review the diff, then:\n  git add package.json CHANGELOG.md && git commit -m "chore: release v${version}"\n  git tag v${version} && git push origin HEAD && git push origin v${version}`,
    );
    return;
  }

  if ((git(["tag", "-l", `v${version}`]).stdout ?? "").trim().length > 0) {
    throw new Error(`tag v${version} already exists — delete it or pick a level`);
  }

  git(["add", "package.json", "CHANGELOG.md"]);
  // Signing is not available to every session on this machine (ATR-025), and a
  // release that cannot be committed is worse than an unsigned commit.
  git([
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--no-gpg-sign",
    "-m",
    `chore: release v${version}`,
  ]);
  git(["-c", "tag.gpgsign=false", "tag", "-a", `v${version}`, "-m", `v${version}`]);
  console.log(`[next-release] committed and tagged v${version}`);

  if (!push) {
    console.log(
      `[next-release] nothing pushed. When you are ready:\n  git push origin HEAD && git push origin v${version}`,
    );
    return;
  }

  git(["push", "origin", "HEAD"]);
  git(["push", "origin", `v${version}`]);
  console.log(
    `[next-release] pushed v${version} — the release workflow is building it now`,
  );
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: the same file has two
 * paths whenever a symlink is involved — on macOS `os.tmpdir()` hands back
 * `/var/folders/...` while the loader resolves it to `/private/var/...` — and
 * a string compare then quietly does nothing at all, exiting 0 as if the
 * script had run.
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
  try {
    main();
  } catch (error) {
    console.error(`[next-release] ${error?.message ?? error}`);
    process.exit(2);
  }
}
