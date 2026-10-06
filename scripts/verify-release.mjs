#!/usr/bin/env node
/**
 * Verify a published release is complete and coherent (ATR-048).
 *
 * The failure this exists for is a release that *looks* published but cannot
 * be used. An update check asks for `releases/latest`, reads
 * `latest-mac.yml`, and downloads the ZIP that manifest names. If the ZIP is
 * missing, or the manifest names a different version or a file that was never
 * attached, then every install reports "No releases published yet" or
 * downloads nothing — discovered days later, long after the author watched a
 * green workflow. So this checks the three artifacts the feed depends on (DMG,
 * ZIP, `latest-mac.yml`) and the manifest's own version, path and size against
 * what is actually attached.
 *
 * The release workflow runs it twice: once while the release is still a draft
 * (`--allow-draft`), so a broken upload fails while it is still invisible, and
 * once after publishing — the state users actually see.
 *
 * Reads are anonymous, because the releases repo is public; a token is used
 * only when the environment already has one, for rate limits.
 *
 * Usage:
 *   node scripts/verify-release.mjs                        # newest release
 *   node scripts/verify-release.mjs --tag v0.2.0
 *   node scripts/verify-release.mjs --allow-draft          # before publishing
 *   node scripts/verify-release.mjs --repo owner/name      # default: publish block
 *
 * Drafts need one thing said out loud: `GET /releases/tags/{tag}` excludes
 * them, so a draft release answers 404 there even though it exists — which is
 * precisely the state the workflow checks first. So a release that 404s is
 * looked up in the releases list as well, and the assets are read back through
 * the asset API when a token is present, because a draft's
 * `browser_download_url` is not public yet. Both fallbacks are what make
 * `--allow-draft` work on a runner; without a token the script still reports
 * honestly that nothing is visible.
 *
 * Exit codes: 0 — complete · 1 — incomplete (each reason printed) · 2 — the
 * check could not run at all (bad usage, network down).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readReleasesRepo } from "./release-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The manifest asset, by the name electron-builder gives it. */
const MANIFEST_ASSET = "latest-mac.yml";

/**
 * The handful of fields `latest-mac.yml` carries — without a YAML parser.
 *
 * electron-builder writes a fixed shape: `version`, a `files` list of
 * `url`/`sha512`/`size`, and a top-level `path` naming the file the manifest
 * refers to. Anything that does not match is left null and reported as a
 * failure by `auditRelease` rather than guessed at here.
 */
export function parseManifest(text) {
  const manifest = { version: null, path: null, files: [] };
  let current = null;

  for (const line of text.split("\n")) {
    const item = /^\s+-\s+url:\s*(\S+)\s*$/.exec(line);
    if (item) {
      current = { url: item[1], size: null };
      manifest.files.push(current);
      continue;
    }
    const size = /^\s+size:\s*(\d+)\s*$/.exec(line);
    if (size && current) {
      current.size = Number(size[1]);
      continue;
    }
    const version = /^version:\s*(\S+)\s*$/.exec(line);
    if (version) {
      manifest.version = version[1];
      current = null;
      continue;
    }
    const topPath = /^path:\s*(\S+)\s*$/.exec(line);
    if (topPath) {
      manifest.path = topPath[1];
      current = null;
    }
  }
  return manifest;
}

/**
 * What is wrong with this release, if anything.
 *
 * Pure on purpose — the network callers are thin, so every failure mode below
 * is unit-tested against fixtures instead of against GitHub.
 *
 * @returns {{ failures: string[], warnings: string[], notes: string[] }}
 */
export function auditRelease({
  release,
  manifestText = null,
  tag,
  expectedVersion,
  allowDraft = false,
  latestTag = null,
}) {
  const failures = [];
  const warnings = [];
  const notes = [];

  const assets = release.assets ?? [];
  const names = assets.map((asset) => asset.name);
  const assetNamed = (name) => assets.find((asset) => asset.name === name);

  if (release.draft && !allowDraft) {
    failures.push(
      "the release is still a draft — `releases/latest` skips drafts, so the updater cannot see it",
    );
  }
  if (release.tag_name !== tag) {
    failures.push(`the release is tagged ${release.tag_name}, expected ${tag}`);
  }
  if (release.prerelease) {
    warnings.push(
      "the release is marked pre-release, so `releases/latest` will skip it",
    );
  }
  if (latestTag !== null && latestTag !== tag) {
    warnings.push(
      `\`releases/latest\` currently resolves to ${latestTag}, not ${tag} — the updater offers the newer one`,
    );
  }

  // The three artifacts the feed depends on.
  const dmg = names.find((name) => name.endsWith(".dmg")) ?? null;
  const zip =
    names.find((name) => name.endsWith("-mac.zip")) ??
    names.find((name) => name.endsWith(".zip")) ??
    null;
  const manifestAsset = names.includes(MANIFEST_ASSET) ? MANIFEST_ASSET : null;

  if (!dmg) failures.push("no .dmg attached — nothing for a person to install");
  if (!zip) failures.push("no .zip attached — the updater downloads this");
  if (!manifestAsset) {
    failures.push(
      `no ${MANIFEST_ASSET} attached — an update check has nothing to read`,
    );
  }

  if (manifestAsset && manifestText !== null) {
    const manifest = parseManifest(manifestText);

    if (manifest.version !== expectedVersion) {
      failures.push(
        `${MANIFEST_ASSET} says version ${manifest.version}, expected ${expectedVersion} — the updater would offer the wrong thing`,
      );
    }

    const fileUrl = manifest.files[0]?.url ?? manifest.path;
    if (!fileUrl) {
      failures.push(`${MANIFEST_ASSET} names no file to download`);
    } else if (!names.includes(fileUrl)) {
      failures.push(
        `${MANIFEST_ASSET} points at ${fileUrl}, which is not attached to the release`,
      );
    } else {
      const attached = assetNamed(fileUrl);
      const declared = manifest.files[0]?.size ?? null;
      if (declared !== null && attached.size !== declared) {
        failures.push(
          `${MANIFEST_ASSET} declares ${declared} bytes for ${fileUrl}, but the attached file is ${attached.size} — a stale manifest against a rebuilt asset`,
        );
      }
      if (fileUrl !== zip) {
        warnings.push(
          `${MANIFEST_ASSET} downloads ${fileUrl}; the release also carries ${zip}`,
        );
      }
    }
  }

  for (const name of [dmg, zip, manifestAsset]) {
    if (!name) continue;
    const asset = assetNamed(name);
    notes.push(`${name} (${asset.size} bytes)`);
  }

  return { failures, warnings, notes };
}

/**
 * The release carrying `tag`, out of a list from the releases endpoint.
 *
 * Exported and pure so the draft case is testable without GitHub: the list
 * endpoint is the only one that can return a draft, and picking the wrong
 * entry out of it would verify somebody else's release.
 */
export function findRelease(releases, tag) {
  if (!Array.isArray(releases)) return null;
  return (
    releases.find((release) => release && release.tag_name === tag) ?? null
  );
}

function authToken() {
  return process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null;
}

function requestHeaders() {
  const token = authToken();
  return {
    accept: "application/vnd.github+json",
    "user-agent": "alltherepos-release-verify",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function getJson(url) {
  const response = await fetch(url, { headers: requestHeaders() });
  if (response.status !== 200) return { status: response.status, body: null };
  return { status: 200, body: await response.json() };
}

async function getText(url, headers = requestHeaders()) {
  const response = await fetch(url, { headers });
  if (response.status !== 200) return { status: response.status, text: null };
  return { status: 200, text: await response.text() };
}

/**
 * An attached asset's bytes.
 *
 * The asset API is preferred over `browser_download_url` when a token exists: a
 * draft's download URL is not public, and asking the API for
 * `application/octet-stream` returns the bytes themselves. Without a token
 * there is nothing better than the plain URL — which is all a published
 * release needs.
 */
async function getAssetText(repo, asset) {
  if (authToken() && asset.id) {
    const viaApi = await getText(
      `https://api.github.com/repos/${repo}/releases/assets/${asset.id}`,
      { ...requestHeaders(), accept: "application/octet-stream" },
    );
    if (viaApi.status === 200) return viaApi;
  }
  return getText(asset.browser_download_url);
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
}

async function main() {
  const args = process.argv.slice(2);
  const allowDraft = args.includes("--allow-draft");
  const repo =
    flagValue(args, "--repo") ??
    process.env.RELEASES_REPO ??
    readReleasesRepo(ROOT);
  const expectedVersion =
    flagValue(args, "--version") ??
    JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const tag =
    flagValue(args, "--tag") ??
    process.env.GITHUB_REF_NAME ??
    `v${expectedVersion}`;

  console.log(`[verify-release] ${repo} @ ${tag} (version ${expectedVersion})`);

  let release = await getJson(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
  );
  if (release.status === 404) {
    // The by-tag endpoint hides drafts, so a draft upload looks like no release
    // at all. The list endpoint shows them — to a token that may see them,
    // which is the credential the release workflow runs with.
    const list = await getJson(
      `https://api.github.com/repos/${repo}/releases?per_page=100`,
    );
    const found = list.status === 200 ? findRelease(list.body, tag) : null;
    if (found) release = { status: 200, body: found };
  }
  if (release.status === 404) {
    console.error(
      `[verify-release] no release tagged ${tag} in ${repo}. Nothing published yet — or the tag was never pushed.`,
    );
    if (!authToken()) {
      console.error(
        "[verify-release] note: drafts are invisible without a token, so `--allow-draft` needs GH_TOKEN (or GITHUB_TOKEN) set.",
      );
    }
    process.exit(1);
  }
  if (release.status !== 200) {
    console.error(
      `[verify-release] GitHub answered ${release.status} for ${repo} — cannot verify (network, rate limit, or a typo in the repo).`,
    );
    process.exit(2);
  }

  const latest = await getJson(
    `https://api.github.com/repos/${repo}/releases/latest`,
  );
  const latestTag = latest.status === 200 ? latest.body.tag_name : null;

  const manifestName = MANIFEST_ASSET;
  let manifestText = null;
  const manifestAsset = (release.body.assets ?? []).find(
    (asset) => asset.name === manifestName,
  );
  if (manifestAsset) {
    const downloaded = await getAssetText(repo, manifestAsset);
    manifestText = downloaded.text;
  }

  const { failures, warnings, notes } = auditRelease({
    release: release.body,
    manifestText,
    tag,
    expectedVersion,
    allowDraft,
    latestTag,
  });

  for (const note of notes) console.log(`  · ${note}`);
  for (const warning of warnings) console.warn(`  ! ${warning}`);

  if (failures.length > 0) {
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error(
      `[verify-release] FAILED — ${failures.length} problem(s) with ${repo}@${tag}`,
    );
    process.exit(1);
  }

  console.log(
    `[verify-release] OK — ${repo}@${tag} has the DMG, the ZIP and a ${manifestName} that matches.`,
  );
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: the same file has two
 * paths whenever a symlink is involved — on macOS `os.tmpdir()` hands back
 * `/var/folders/...` while the loader resolves it to `/private/var/...` — and
 * a string compare then quietly does nothing at all, exiting 0 as if the
 * release had been checked and found complete.
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
  main().catch((error) => {
    console.error(`[verify-release] ${error?.message ?? error}`);
    process.exit(2);
  });
}
