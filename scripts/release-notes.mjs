#!/usr/bin/env node
/**
 * Release notes, and the tag/version guard that has to pass first.
 *
 * Two failures this exists to prevent, both of which ship something the
 * updater will never offer:
 *
 *   1. **The tag and `package.json` disagree.** electron-builder publishes to
 *      `<tag prefix><package version>` (the tag prefix comes from the publish
 *      config), so a `v0.2.0` tag on a tree that still says `0.1.0` publishes
 *      a `v0.1.0` release: either it collides with the previous one or it
 *      lands under a tag nobody pushing `v0.2.0` was looking at.
 *   2. **A version ships with no changelog entry**, so its release page says
 *      nothing about what changed — and the release is the only thing a person
 *      downloading the DMG ever reads.
 *
 * Both checks are cheap and run *before* the build, so a release fails in
 * seconds instead of after ten minutes of packaging.
 *
 * Usage:
 *   node scripts/release-notes.mjs            # check the current version
 *   node scripts/release-notes.mjs v0.2.0     # guard a tag (this is what CI does)
 *   node scripts/release-notes.mjs v0.2.0 > notes.md
 *
 * The release notes — the changelog section for that version — go to stdout
 * so callers can redirect them. Any mismatch exits 1 with an explanation and
 * prints nothing, which is deliberate: a workflow that does
 * `node scripts/release-notes.mjs "$tag" > notes.md` must not end up with a
 * half-written notes file it then attaches to a release.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Matches `## [1.2.3]`, with or without a trailing date. */
const versionHeading = (version) =>
  new RegExp(`^##\\s+\\[${version.replace(/\./g, "\\.")}\\]\\s*(?:-.*)?$`, "m");

function fail(message) {
  console.error(`[release-notes] ${message}`);
  process.exit(1);
}

const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
);
const version = pkg.version;

const rawTag = process.argv[2];
if (process.argv.length > 3) fail("usage: release-notes.mjs [tag]");

// Accept `v1.2.3` and `1.2.3`; strip the prefix rather than demanding one, so
// whoever runs this by hand isn't punished for forgetting it.
const tag = rawTag ?? `v${version}`;
const tagVersion = tag.startsWith("v") ? tag.slice(1) : tag;

if (!/^\d+\.\d+\.\d+/.test(tagVersion)) {
  fail(`"${tag}" is not a v<semver> tag.`);
}
if (tagVersion !== version) {
  fail(
    `tag ${tag} says ${tagVersion} but package.json says ${version}. ` +
      "Bump the version (and the changelog) in the same commit as the tag, " +
      "or retag the commit that already has it.",
  );
}

const changelogPath = path.join(ROOT, "CHANGELOG.md");
if (!fs.existsSync(changelogPath)) {
  fail("CHANGELOG.md is missing — the release would have no notes.");
}

const changelog = fs.readFileSync(changelogPath, "utf8");
const heading = versionHeading(version);
const match = heading.exec(changelog);
if (!match) {
  fail(
    `CHANGELOG.md has no "## [${version}]" section. Add one (Keep a Changelog ` +
      "sections: Added / Changed / Fixed) before tagging.",
  );
}

// The section runs to the next `## [` heading, to the first link-definition
// line (Keep a Changelog keeps its `[0.1.0]: <url>` links at the foot of the
// file, and they are not part of any release's notes), or to the end.
const rest = changelog.slice(match.index + match[0].length);
const stop = rest.search(/^##\s+\[|^\[[^\]]+\]:\s/m);
const body = (stop === -1 ? rest : rest.slice(0, stop)).trim();

if (body.length === 0) fail(`the "## [${version}]" section is empty.`);

process.stdout.write(`${body}\n`);
