#!/usr/bin/env node
/**
 * Resolve every external link in the repo's Markdown.
 *
 * A link is the cheapest thing in a repository to break and the most expensive
 * to notice. `CHANGELOG.md` pointed its `[0.1.1]` entry at a release tag that
 * had been deleted, and the only reason anyone found out was that a person read
 * the file. `contracts/actions.v1.md` cited Electron's accelerator page, which
 * upstream moved out from under it — the contract had been citing a 404 for as
 * long as anyone can tell. Neither failure breaks a build, so nothing was ever
 * going to catch it except a check like this one.
 *
 * So: every `http(s)` URL in the tracked Markdown is extracted and resolved.
 * A link that answers **404 or 410** is dead and fails the run. One that could
 * not be judged — a rate limit, a bot wall, a host that was simply slow, a
 * private repository read without a credential — is reported and does **not**
 * fail, because a check that cannot run is not a verdict: that distinction is
 * the same one `verify-release.mjs` draws when it exits 2 instead of 1.
 *
 * GitHub URLs are resolved through the API rather than the web page, for two
 * reasons. The API answers for a private repository to a token (the README's
 * workflow links point at one), and it answers precisely — a release tag, a
 * commit, a compare range — instead of a 200 for GitHub's soft-404 page. When
 * no credential is available, a 404 on a private repository is indistinguishable
 * from a 404 on a deleted page, so one extra request asks whether the repository
 * itself is visible; if it is not, the link is `unverified` rather than dead.
 *
 * One URL is done differently. The `chore: release vX` commit is pushed before
 * the artifacts are — that is the whole point of tagging — so for the minutes
 * between the bump and the publish, the changelog's newest version link answers
 * 404. That is not rot, it is a release in flight, and failing on it would make
 * every release commit red. It is excused **by exact URL**: the version
 * `package.json` names, at the repo releases are published to. Nothing else is.
 * The moment the next bump moves `package.json` on, that version's link is an
 * ordinary one again — so a release that never published is still caught, just
 * on the next run instead of this one. Until then the release workflow owns that
 * check, and it fails the job if the release never appears (`release:verify`).
 *
 * Text extraction, not a Markdown parser: the repo has no Markdown dependency
 * and does not need one to find `https://`. URLs inside code fences are
 * therefore checked too — a URL in a fence is still a URL a reader may paste —
 * which is what `NOT_A_LINK` is for.
 *
 * Usage:
 *   node scripts/check-doc-links.mjs              # every tracked *.md
 *   node scripts/check-doc-links.mjs --verbose    # also list the links that resolve
 *
 * A credential is read from `GH_TOKEN`, `GITHUB_TOKEN`, or the `gh` CLI, in
 * that order, and is used only to read GitHub — never sent anywhere else.
 *
 * Exit codes: 0 — every link resolved (warnings allowed) · 1 — at least one
 * link is dead · 2 — the check could not run at all (no git, no network).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readReleasesRepo } from "./release-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A request that has not answered by now is a link that cannot be judged. */
const TIMEOUT_MS = 15_000;

const USER_AGENT = "alltherepos-link-check";

/**
 * Hosts that only answer on the machine reading the file. A link to your own
 * laptop is not one a reader can follow, and resolving it would make the same
 * file pass here and fail on a runner.
 */
export const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

/**
 * URLs that are illustrations rather than destinations.
 *
 * Every one of these is dead *by construction*: `github.com/user/repo.git` is a
 * placeholder clone target in the archived plans, and the fonts README quotes a
 * Google path with an ellipsis in it. Resolving them would ship a permanently
 * red check, which is worse than no check — a gate everyone has learned to
 * ignore stops being a gate. So they are skipped by exact URL, and this list is
 * deliberately the interesting part of the file: adding to it is how a new
 * illustration gets blessed, and every entry has to say why. The key is the
 * *trimmed* URL, because that is what extraction produced.
 */
export const NOT_A_LINK = new Map([
  [
    "https://github.com/user/repo.git",
    "placeholder clone target in the archived plans",
  ],
  [
    "https://github.com/acme/hive.git",
    "placeholder clone target in the MCP plan",
  ],
  [
    // `…/...` in the README — extraction trims the ellipsis off, so the key is
    // the trimmed form. The real Google Fonts URL in that file is the `/css2`
    // one, and it is checked.
    "https://fonts.googleapis.com/",
    "an elided @import sample in the fonts README",
  ],
  ["https://api.openai.com", "named in a sentence, not linked"],
  ["https://avatars.githubusercontent.com", "named in a sentence, not linked"],
]);

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

const API_ROOT = "https://api.github.com";

/**
 * The release page for the version in `package.json`, which does not exist yet.
 *
 * Returns null when the repo has no `package.json` or no publish config, which
 * is the case in the tests' throwaway checkouts — there is then nothing to
 * excuse, and every link is judged on its own.
 */
export function pendingReleaseUrl(root) {
  try {
    const version = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ).version;
    return `https://github.com/${readReleasesRepo(root)}/releases/tag/v${version}`;
  } catch {
    return null;
  }
}

/**
 * Every `http(s)` URL in one Markdown file, with the line it came from.
 *
 * Trailing punctuation is trimmed because Markdown puts it straight after the
 * URL: a sentence ending `see <https://example.com>.` and a table cell ending
 * `…/v0.1.1 |` both used to carry the stop character into the request. The
 * character class excludes the delimiters a URL cannot contain unescaped
 * (`<`, `>`, `"`, a backtick, `[`, `]`) and both brackets, since every link in
 * this repo is written either as `<url>` or `](url)`.
 */
export function extractLinks(markdown) {
  const links = [];
  markdown.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/https?:\/\/[^\s<>()"'`[\]]+/g)) {
      const url = match[0].replace(/[.,;:*]+$/, "");
      if (url.length > 0) links.push({ url, line: index + 1 });
    }
  });
  return links;
}

/**
 * The API path that answers for a GitHub URL, or null to fall back to the web.
 *
 * Only the shapes the repository actually writes are mapped. `releases/download`
 * is deliberately absent: a public asset URL resolves on its own, and mapping it
 * to the tag it belongs to would report a deleted *asset* as present.
 */
export function githubApiPath(url) {
  const parsed = url instanceof URL ? url : new URL(url);
  if (!GITHUB_HOSTS.has(parsed.hostname)) return null;

  const [owner, repo, ...rest] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repo) return null;
  const base = `/repos/${owner}/${repo}`;
  const tail = rest.join("/");

  if (tail === "") return base;
  if (tail === "releases") return `${base}/releases`;

  const patterns = [
    [/^releases\/tag\/(.+)$/, (m) => `${base}/releases/tags/${m[1]}`],
    [/^commit\/(.+)$/, (m) => `${base}/commits/${m[1]}`],
    [/^compare\/(.+)$/, (m) => `${base}/compare/${m[1]}`],
    [
      /^actions\/workflows\/(.+?)(?:\/badge\.svg)?$/,
      (m) => `${base}/actions/workflows/${m[1]}`,
    ],
  ];
  for (const [pattern, build] of patterns) {
    const match = pattern.exec(tail);
    if (match) return build(match);
  }
  return null;
}

/**
 * What to do with a URL, decided before any request is made.
 *
 * @returns {{action: "skip", reason: string} |
 *           {action: "check", via: "api" | "http", target: string,
 *            repoApi: string | null}}
 */
export function planFor(url, { pendingRelease = null } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { action: "skip", reason: "not a URL" };
  }

  if (LOCAL_HOSTS.has(parsed.hostname)) {
    return { action: "skip", reason: "answers only on the reading machine" };
  }

  if (pendingRelease && url === pendingRelease) {
    return {
      action: "skip",
      reason:
        "the version being released — its page appears when the release workflow publishes it, and that workflow verifies the publish",
    };
  }

  const illustration = NOT_A_LINK.get(url);
  if (illustration) return { action: "skip", reason: illustration };

  const apiPath = githubApiPath(parsed);
  if (apiPath) {
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    return {
      action: "check",
      via: "api",
      target: `${API_ROOT}${apiPath}`,
      repoApi: `${API_ROOT}/repos/${owner}/${repo}`,
    };
  }

  return { action: "check", via: "http", target: url, repoApi: null };
}

/**
 * The verdict for one response.
 *
 * Pure, so every threshold below is unit-tested against a status code instead of
 * against a live host that happens to be having a bad day. `unverified` is the
 * important one: 403 is how a bot wall answers, 429 is how a rate limit answers,
 * 5xx is how a bad afternoon answers, and none of those is evidence that a page
 * is gone.
 */
export function verdictFor({ via, status, error }) {
  if (error) return { state: "unverified", reason: error };
  if (status >= 200 && status < 400) return { state: "ok", reason: `HTTP ${status}` };

  if (via === "api") {
    if (status === 404) return { state: "dead", reason: "HTTP 404" };
    return { state: "unverified", reason: `HTTP ${status}` };
  }

  if (status === 404 || status === 410) return { state: "dead", reason: `HTTP ${status}` };
  return { state: "unverified", reason: `HTTP ${status}` };
}

/**
 * 1 when something is dead, 0 when nothing is, and 2 when nothing could be
 * judged at all — a run where every request failed is a broken check, not a
 * clean repository, and must not read as success.
 */
export function exitCodeFor(results) {
  if (results.some((result) => result.state === "dead")) return 1;
  const judged = results.filter(
    (result) => result.state === "ok" || result.state === "dead",
  ).length;
  const checked = results.filter((result) => result.state !== "skipped").length;
  if (checked > 0 && judged === 0) return 2;
  return 0;
}

/** One request, following redirects, with HEAD falling back to GET. */
async function request(target, options) {
  const { via, fetchImpl, token, timeoutMs, method } = options;
  const headers = { "user-agent": USER_AGENT };
  if (via === "api") {
    headers.accept = "application/vnd.github+json";
    if (token) headers.authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetchImpl(target, {
      method,
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // A host is allowed to refuse HEAD; the same URL over GET is the same link.
    if (method === "HEAD" && (response.status === 405 || response.status === 501)) {
      return request(target, { ...options, method: "GET" });
    }
    return { status: response.status };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      status: 0,
      error: timedOut ? `timed out after ${timeoutMs / 1000}s` : (error?.message ?? String(error)),
    };
  }
}

/**
 * Resolve one link. Exported with its collaborators injected so the tests can
 * exercise the private-repository branch without a private repository.
 */
export async function checkLink(link, options) {
  const plan = planFor(link.url, { pendingRelease: options.pendingRelease });
  if (plan.action === "skip") {
    return { ...link, state: "skipped", reason: plan.reason };
  }

  const response = await request(plan.target, {
    via: plan.via,
    fetchImpl: options.fetchImpl,
    token: options.token,
    timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
    method: plan.via === "api" ? "GET" : "HEAD",
  });

  // Without a credential, GitHub says 404 for a private repository *and* for a
  // path that is genuinely gone, so the 404 alone settles nothing. Asking
  // whether the repository itself is visible separates the two cases: a public
  // repository that 404s the path is a dead link, a hidden one is not a verdict.
  if (plan.via === "api" && !options.token && response.status === 404) {
    const repo = await request(plan.repoApi, {
      via: "api",
      fetchImpl: options.fetchImpl,
      token: options.token,
      timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
      method: "GET",
    });
    if (repo.status !== 200) {
      return {
        ...link,
        state: "unverified",
        reason: `HTTP 404 — and no credential, so a private repository cannot be told from a deleted page`,
      };
    }
  }

  return { ...link, ...verdictFor({ via: plan.via, ...response }) };
}

/** Resolve every link, deduplicated, so a repeated URL is fetched once. */
export async function checkLinks(links, options) {
  const byUrl = new Map();
  for (const link of links) {
    const seen = byUrl.get(link.url);
    if (seen) seen.places.push({ file: link.file, line: link.line });
    else byUrl.set(link.url, { ...link, places: [{ file: link.file, line: link.line }] });
  }

  const results = [];
  for (const entry of byUrl.values()) results.push(await checkLink(entry, options));
  return results;
}

/** The tracked Markdown, which is what ships and what a runner checks out. */
function listMarkdown(root) {
  const output = execFileSync("git", ["ls-files", "-z", "--", "*.md"], {
    cwd: root,
    encoding: "utf8",
  });
  return output
    .split("\0")
    .filter((file) => file.length > 0 && !file.includes("node_modules/"));
}

export function collectLinks(root, files = listMarkdown(root)) {
  const links = [];
  for (const file of files) {
    const markdown = fs.readFileSync(path.join(root, file), "utf8");
    for (const link of extractLinks(markdown)) links.push({ ...link, file });
  }
  return links;
}

function resolveToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    // The developer's own `gh` login, so a local run judges the private
    // repository's links instead of listing them as unverified.
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function describe(result) {
  const where = result.places
    .map((place) => `${place.file}:${place.line}`)
    .join(", ");
  return `${where} — ${result.reason}`;
}

export async function run({
  root = ROOT,
  files,
  fetchImpl = globalThis.fetch,
  token = resolveToken(),
  timeoutMs = TIMEOUT_MS,
  pendingRelease = pendingReleaseUrl(root),
  verbose = false,
  log = console.log,
  error = console.error,
} = {}) {
  const links = collectLinks(root, files);
  const results = await checkLinks(links, {
    fetchImpl,
    token,
    timeoutMs,
    pendingRelease,
  });

  const ok = results.filter((result) => result.state === "ok");
  const dead = results.filter((result) => result.state === "dead");
  const unverified = results.filter((result) => result.state === "unverified");
  const skipped = results.filter((result) => result.state === "skipped");

  log(
    `[check-doc-links] ${results.length} links across ${new Set(links.map((l) => l.file)).size} Markdown files` +
      `${token ? "" : " (no credential: GitHub links to a private repository stay unverified)"}`,
  );

  if (verbose) {
    for (const result of ok) log(`  · ${result.url}`);
  }
  for (const result of skipped) log(`  · skipped ${result.url} — ${result.reason}`);

  if (unverified.length > 0) {
    error("[check-doc-links] could not be judged (not a dead link):");
    for (const result of unverified) error(`  ! ${result.url}\n      ${describe(result)}`);
  }

  if (dead.length > 0) {
    error("[check-doc-links] dead links:");
    for (const result of dead) error(`  ✗ ${result.url}\n      ${describe(result)}`);
    error(
      `[check-doc-links] FAILED — ${dead.length} dead link(s). A release, a page or a repository it points at is gone; repoint it or drop it.`,
    );
    return exitCodeFor(results);
  }

  const code = exitCodeFor(results);
  if (code === 2) {
    error(
      "[check-doc-links] nothing could be checked — no request was judged resolvable. Assume the network, not the links.",
    );
    return code;
  }

  log(
    `[check-doc-links] OK — ${ok.length} resolved, ${skipped.length} skipped, ${unverified.length} unverified.`,
  );
  return code;
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: the same file has two
 * paths whenever a symlink is involved — on macOS `os.tmpdir()` hands back
 * `/var/folders/...` while the loader resolves it to `/private/var/...` — and a
 * string compare then quietly does nothing at all, exiting 0 as if every link
 * had been checked and found live.
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
  run({ verbose: process.argv.includes("--verbose") })
    .then((code) => process.exit(code))
    .catch((thrown) => {
      console.error(`[check-doc-links] ${thrown?.message ?? thrown}`);
      process.exit(2);
    });
}
