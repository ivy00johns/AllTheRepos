#!/usr/bin/env node
/**
 * Read the update feed the way the shipped app reads it, and prove it works.
 *
 * `release:verify` already checks the manifest, but it checks it against the
 * release it was uploaded with, at the moment it was published, with a
 * credential. An install does the opposite of all three: it asks **anonymously**,
 * through `releases/latest`, weeks later, and it refuses the archive unless the
 * sha512 in the manifest matches the bytes it downloaded. Nothing in this
 * repository did that read, so the feed could rot — the release deleted, the
 * manifest edited, the assets re-uploaded under new names, the repo turned
 * private — and the first symptom would be somebody's app reporting that nothing
 * has ever been published.
 *
 * So this is that read, on purpose:
 *
 *   1. `GET /releases/latest` with **no credential**. An authenticated read
 *      would answer on the runner and fail for every install, which is the
 *      specific failure this is here to catch, so there is no token code path in
 *      this file at all and its tests assert the requests carry no
 *      `authorization` header.
 *   2. the `latest-mac.yml` asset of that release, downloaded the same way.
 *   3. the archive that manifest names — downloaded, hashed, and compared
 *      against the digest the manifest promises, because an update that fails
 *      its own integrity check fails *after* a hundred-megabyte download.
 *
 * The repo is read from `electron-builder.yml`'s `publish` block, the same
 * source `app-update.yml` is generated from, which
 * `tests/unit/main/services/updater-feed.spec.ts` pins to the app's own
 * `FEED_OWNER`/`FEED_REPO` constants.
 *
 * Usage:
 *   node scripts/check-updater-feed.mjs
 *   node scripts/check-updater-feed.mjs --repo owner/name
 *
 * Exit codes, and the difference between the last two is the point:
 *
 *   0 — the feed is complete and coherent.
 *   1 — it is not, and every reason is printed. A verdict.
 *   2 — the check could not run, for a reason that is **not about the feed**: no
 *       network, or GitHub refusing the anonymous read. The workflow reports
 *       this and does **not** fail on it, because an unauthenticated address gets
 *       60 requests an hour and a runner shares its address with every other job
 *       on that machine — a red run there would be somebody else's. The same
 *       bargain `pnpm links:check` strikes with a bot wall.
 *   3 — the check could not run because it was asked to do something impossible:
 *       no repo to read, or it crashed. That is a broken checker, not a broken
 *       feed and not somebody else's rate limit, so it fails loudly.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readReleasesRepo } from "./release-config.mjs";
import { MANIFEST_ASSET, parseManifest } from "./verify-release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Headers for every request this file makes — or rather, the one header.
 *
 * Deliberately without `authorization`, and this is the whole point of the file:
 * a token here would make the check pass for whoever ran it and fail for every
 * install, which looks exactly like a working feed. So no function below reads
 * `GH_TOKEN`, and the tests assert that these headers carry no authorization
 * even when one is set in the environment.
 */
export function anonymousHeaders() {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "alltherepos-feed-check",
  };
}

/** What the app's update check resolves first, with no credential. */
export function latestReleaseUrl(repo) {
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

/** The `latest-mac.yml` asset of a release, or null when it carries none. */
export function manifestAsset(release) {
  return (
    (release?.assets ?? []).find((asset) => asset?.name === MANIFEST_ASSET) ??
    null
  );
}

/**
 * The file the manifest tells the updater to download.
 *
 * `url` falls back to the top-level `path` because that is what the manifest is
 * for — if the two disagree the `files` entry is what the updater follows, and
 * the top-level one is what everything that reads the file by hand follows.
 */
export function manifestDownload(manifest) {
  const file = manifest?.files?.[0] ?? null;
  return {
    url: file?.url ?? manifest?.path ?? null,
    sha512: file?.sha512 ?? null,
    size: file?.size ?? null,
  };
}

/** What electron-updater compares a download against, for the same reason. */
export function sha512Base64(bytes) {
  return createHash("sha512").update(bytes).digest("base64");
}

/**
 * What is wrong with this feed, if anything.
 *
 * Pure, so every failure mode below is unit-tested against fixtures rather than
 * against GitHub. `archive` is what the download of the manifest's file
 * returned — `{ status, bytes }`, or null when it was never attempted — and the
 * distinction matters: a check that could not read the file the whole manifest
 * exists to point at has proved nothing, so that is a failure and not a skip.
 *
 * @returns {{ failures: string[], warnings: string[], notes: string[] }}
 */
export function auditFeed({ release, manifest, archive = null }) {
  const failures = [];
  const warnings = [];
  const notes = [];

  const tag = release?.tag_name ?? null;
  const assets = release?.assets ?? [];

  // `releases/latest` excludes drafts and pre-releases by definition, so either
  // of these means the answer did not come from where the updater looks.
  if (release?.draft) {
    failures.push(
      "`releases/latest` answered with a draft — an anonymous update check cannot see it at all",
    );
  }
  if (release?.prerelease) {
    failures.push(
      "`releases/latest` answered with a pre-release — the updater skips those, so nobody would be offered this release",
    );
  }

  if (!manifest) {
    failures.push(
      `no ${MANIFEST_ASSET} is attached to ${tag ?? "the latest release"} — an update check has nothing to read`,
    );
    return { failures, warnings, notes };
  }

  const declaredVersion = manifest.version;
  if (!tag) {
    failures.push("the release has no tag to compare the manifest's version against");
  } else if (declaredVersion !== tag.replace(/^v/, "")) {
    failures.push(
      `${MANIFEST_ASSET} says version ${declaredVersion} but the release is ${tag} — an update check would offer the wrong version`,
    );
  }

  const download = manifestDownload(manifest);
  const attached = download.url
    ? ((assets ?? []).find((asset) => asset?.name === download.url) ?? null)
    : null;
  const bytes = archive?.status === 200 ? archive.bytes : null;

  if (!download.url) {
    failures.push(`${MANIFEST_ASSET} names no file to download`);
  } else if (!attached) {
    failures.push(
      `${MANIFEST_ASSET} names ${download.url}, which is not attached to the release — the download would 404`,
    );
  } else if (bytes === null) {
    // Reading the manifest and then not fetching what it names would be a check
    // of the map rather than the road: every claim below is about those bytes.
    failures.push(
      `${download.url} could not be downloaded (${archive ? `HTTP ${archive.status}` : "never attempted"}) — an install would fail at exactly that point`,
    );
  } else {
    if (!download.sha512) {
      failures.push(
        `${MANIFEST_ASSET} carries no sha512 for ${download.url} — the updater has nothing to verify the download against`,
      );
    } else {
      const actual = sha512Base64(bytes);
      if (actual !== download.sha512) {
        failures.push(
          `the bytes of ${download.url} hash to ${actual}, but ${MANIFEST_ASSET} promises ${download.sha512} — every install would download all of it and then refuse it`,
        );
      } else {
        notes.push(`sha512 of the download matches ${MANIFEST_ASSET}`);
      }
    }

    if (download.size !== null && bytes.length !== download.size) {
      failures.push(
        `${MANIFEST_ASSET} declares ${download.size} bytes for ${download.url}, but the attached file is ${bytes.length}`,
      );
    }
  }

  if (tag) notes.push(`release ${tag}`);
  if (attached) notes.push(`${attached.name} (${attached.size} bytes)`);

  return { failures, warnings, notes };
}

/** One anonymous GET, with the body left as the caller asked for. */
async function get(fetchImpl, url, shape) {
  const response = await fetchImpl(url, { headers: anonymousHeaders() });
  if (response.status !== 200) return { status: response.status, body: null };
  if (shape === "json") return { status: 200, body: await response.json() };
  if (shape === "text") return { status: 200, body: await response.text() };
  return { status: 200, body: Buffer.from(await response.arrayBuffer()) };
}

/** A status GitHub returns when it is refusing to answer, not reporting rot. */
function isRefusal(status) {
  return status === 403 || status === 429;
}

/**
 * The whole check, with the network injected so it can be driven from a fixture.
 *
 * @returns {Promise<number>} the process exit code this run deserves
 */
export async function runFeedCheck({
  repo,
  fetchImpl = globalThis.fetch,
  log = console.log,
  error = console.error,
} = {}) {
  if (!repo) {
    error("[check-updater-feed] no repo to check — pass --repo or set RELEASES_REPO");
    return 3;
  }

  log(
    `[check-updater-feed] reading ${repo} anonymously, the way a shipped app does`,
  );

  let latest;
  try {
    latest = await get(fetchImpl, latestReleaseUrl(repo), "json");
  } catch (thrown) {
    error(
      `[check-updater-feed] could not reach GitHub: ${thrown?.message ?? thrown}`,
    );
    return 2;
  }

  if (isRefusal(latest.status)) {
    error(
      `[check-updater-feed] GitHub refused the anonymous read (${latest.status}) — an unauthenticated address gets 60 requests an hour, and a runner shares its address. Try again later; this says nothing about the feed.`,
    );
    return 2;
  }
  if (latest.status === 404) {
    // One message for three states, because an anonymous reader genuinely
    // cannot tell them apart: GitHub answers 404 for a repo that does not exist
    // and for one it will not show an unauthenticated request. The third is real
    // rot worth naming — `releases/latest` skips drafts and pre-releases, so a
    // version that only ever reached a draft reads exactly like this.
    error(
      `[check-updater-feed] FAILED — ${repo} has nothing an anonymous reader can see, which is what every install asks for and gets told "no releases published yet". Either nothing has been published (drafts and pre-releases do not appear here), or the repo is not public — and it is public by design, because the app has no credential to offer.`,
    );
    return 1;
  }
  if (latest.status !== 200) {
    error(
      `[check-updater-feed] GitHub answered ${latest.status} for ${repo} — cannot check (a typo in the repo name would do it).`,
    );
    return 2;
  }

  const release = latest.body;
  const asset = manifestAsset(release);

  let manifest = null;
  let archive = null;

  if (asset) {
    const fetched = await get(fetchImpl, asset.browser_download_url, "text");
    if (isRefusal(fetched.status)) {
      error(
        `[check-updater-feed] GitHub refused to serve ${MANIFEST_ASSET} (${fetched.status}) — try again later.`,
      );
      return 2;
    }
    if (fetched.status !== 200) {
      // Reported by `auditFeed` rather than here, so the message is the same
      // one the unit tests read.
      archive = { status: fetched.status, bytes: null };
    } else {
      manifest = parseManifest(fetched.body);

      const download = manifestDownload(manifest);
      const target = download.url
        ? ((release.assets ?? []).find((a) => a?.name === download.url) ?? null)
        : null;
      if (target) {
        // The expensive half, and the half nothing else does: the app downloads
        // this file and verifies it before offering anything, so the check has
        // to hold the same bytes.
        const bytes = await get(fetchImpl, target.browser_download_url, "bytes");
        if (isRefusal(bytes.status)) {
          error(
            `[check-updater-feed] GitHub refused to serve ${download.url} (${bytes.status}) — try again later.`,
          );
          return 2;
        }
        archive = { status: bytes.status, bytes: bytes.body };
      }
    }
  }

  const { failures, warnings, notes } = auditFeed({ release, manifest, archive });

  for (const note of notes) log(`  · ${note}`);
  for (const warning of warnings) log(`  ! ${warning}`);

  if (failures.length > 0) {
    for (const failure of failures) error(`  ✗ ${failure}`);
    error(`[check-updater-feed] FAILED — ${failures.length} problem(s) with ${repo}`);
    return 1;
  }

  log(
    `[check-updater-feed] OK — an anonymous update check resolves ${repo}, reads a ${MANIFEST_ASSET} that matches, and downloads bytes that hash to what it promises.`,
  );
  return 0;
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: the same file has two
 * paths whenever a symlink is involved — on macOS `os.tmpdir()` hands back
 * `/var/folders/...` while the loader resolves it to `/private/var/...` — and a
 * string compare then quietly does nothing at all, exiting 0 as if the feed had
 * been read and found correct.
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
  const args = process.argv.slice(2);
  const repo =
    flagValue(args, "--repo") ?? process.env.RELEASES_REPO ?? readReleasesRepo(ROOT);
  runFeedCheck({ repo })
    .then((code) => process.exit(code))
    .catch((thrown) => {
      // Not 2: reaching here means the checker itself threw, which is a fault in
      // the checker rather than a rate limit or a feed that has rotted.
      console.error(`[check-updater-feed] ${thrown?.message ?? thrown}`);
      process.exit(3);
    });
}
