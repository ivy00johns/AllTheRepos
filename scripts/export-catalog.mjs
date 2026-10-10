#!/usr/bin/env node
/**
 * Export the real catalog to JSON, for the browser bridge.
 *
 * `src/renderer/lib/browser-bridge.ts` renders the app in a plain browser tab,
 * and it reads a 12-repo demo library — which is the wrong library when the
 * question is "does this screen work with *my* repos". This writes the catalog
 * the app actually holds, in the shapes the IPC boundary hands the renderer, to
 * a file the dev server serves at `/__atr/catalog.json`. The bridge fetches it
 * at install time and serves it instead of the demo, or serves the demo when
 * the file is absent. Nothing about the app changes: this is a dev-time
 * convenience for looking at the UI, and it is not read by the app itself.
 *
 * Why it picks its runtime: the catalog lives in `better-sqlite3`, a native
 * module built for whichever ABI is installed. `pnpm test` builds it for host
 * Node and `pnpm electron:dev` / the E2E suite build it for Electron, so no
 * single runtime is reliably right. The script tries the one it is in and, only
 * if that fails, borrows Electron's through `ELECTRON_RUN_AS_NODE=1` — the same
 * bargain `tests/e2e/_seed-catalog.mjs` strikes.
 *
 * The row mapping mirrors `mapRawRepoRow` + `rowToRepo` in
 * `src/main/db/queries.ts` (and its `previewOf` cap) because the renderer's
 * schemas are strict: a field the schema rejects does not break one row, it
 * makes the whole catalog render empty with nothing in the console. `format` is
 * bumped if this shape ever changes, and the bridge refuses a format it does not
 * know rather than half-loading one.
 *
 * Privacy: the output names your repos, their paths, tags and READMEs. It is
 * written to a gitignored path by default and must never be committed.
 *
 * Usage:
 *   node scripts/export-catalog.mjs [--db <alltherepos.db>] [--out <file>]
 *
 * Exit codes: 0 — written · 2 — no database found (all candidates listed).
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** The shape the bridge knows how to load. Bump it if the shape changes. */
const FORMAT = 1;

/** Where the file goes by default — gitignored, one path, easy to delete. */
const DEFAULT_OUT = join(REPO_ROOT, ".atr-catalog.json");

/**
 * Load `better-sqlite3` in whichever runtime has a working copy.
 *
 * The module is native, and the repository builds it for one ABI at a time: the
 * test suite builds it for host Node, while `pnpm electron:dev` and the Electron
 * E2E suite build it for Electron. So neither runtime is reliably the right one,
 * and the script asks rather than assumes — it tries the runtime it is in, and
 * only if that fails does it borrow Electron's, once, for the same reason
 * `tests/e2e/_seed-catalog.mjs` does: so the reader and the app agree on
 * NODE_MODULE_VERSION.
 */
const HOP_MARKER = "ATR_EXPORT_HOPPED";

let Database;
try {
  Database = (await import("better-sqlite3")).default;
} catch (error) {
  if (error?.code !== "ERR_DLOPEN_FAILED" || process.env[HOP_MARKER]) {
    console.error(
      "[export-catalog] better-sqlite3 will not load in this runtime. Build the native modules " +
        "for the runtime you are using first: `pnpm electron:rebuild` for Electron, or " +
        "`node scripts/ensure-native-abi.mjs host` for plain Node.",
    );
    console.error(error);
    process.exit(3);
  }
  const electronPath = (await import("electron")).default;
  const result = spawnSync(
    electronPath,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", [HOP_MARKER]: "1" },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

// ---------------------------------------------------------------------------
// Arguments and the database
// ---------------------------------------------------------------------------

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

/**
 * Every place the app's database has been seen on this machine.
 *
 * Development runs (`electron-vite dev`) use the app name from `package.json`
 * while a packaged build uses its product name, and Electron's own default dir
 * shows up when the name was not set — so all three are candidates rather than
 * a guess at which one this checkout produced.
 */
function candidateDbs() {
  const names = ["alltherepos", "AllTheRepos", "Electron"];
  const bases =
    process.platform === "darwin"
      ? [join(homedir(), "Library", "Application Support")]
      : process.platform === "win32"
        ? [process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")]
        : [join(homedir(), ".config")];
  return bases.flatMap((base) =>
    names.map((name) => join(base, name, "alltherepos.db")),
  );
}

function findDatabase() {
  if (process.env.ATR_DB?.trim()) return process.env.ATR_DB.trim();
  const explicit = readFlag("--db");
  if (explicit) return explicit;
  const found = candidateDbs().filter((path) => existsSync(path));
  if (found.length === 0) return null;
  // The one most recently written is the one the app is actually using.
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

const dbPath = findDatabase();
if (!dbPath || !existsSync(dbPath)) {
  console.error("[export-catalog] no catalog database found. Looked in:");
  for (const path of candidateDbs()) console.error(`  ${path}`);
  console.error(
    "\nPass one explicitly with --db <path>, or set ATR_DB. Launch the app once so it creates its database.",
  );
  process.exit(2);
}

const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });

// ---------------------------------------------------------------------------
// Row mapping — the same conversion `src/main/db/queries.ts` performs
// ---------------------------------------------------------------------------

const PREVIEW_MAX = 2048;

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function previewOf(readme) {
  if (!readme) return null;
  return readme.length <= PREVIEW_MAX ? readme : readme.slice(0, PREVIEW_MAX);
}

function toRepo(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    fullPath: row.full_path,
    remoteUrl: row.remote_url ?? null,
    defaultBranch: row.default_branch ?? null,
    currentBranch: row.current_branch ?? null,
    lastCommitHash: row.last_commit_hash ?? null,
    lastCommitDate: row.last_commit_date ?? null,
    lastCommitMsg: row.last_commit_msg ?? null,
    isDirty: Boolean(row.is_dirty),
    primaryLanguage: row.primary_language ?? null,
    languages: parseJson(row.languages_json, []),
    tags: parseJson(row.tags_json, []),
    description: row.description ?? null,
    readmePreview: previewOf(row.readme_content),
    readmeHash: row.readme_hash ?? null,
    sizeBytes: row.size_bytes ?? null,
    lastScannedAt: row.last_scanned_at ?? null,
    lastOpenedAt: row.last_opened_at ?? null,
    isFavorite: Boolean(row.is_favorite),
    favoritedAt: row.favorited_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source ?? "filesystem_scan",
    // ATR-028: computed at read time in the app, and just as computed here —
    // this process can see the disk, so the flag is a real answer.
    missing: !existsSync(row.full_path),
  };
}

const repos = sqlite.prepare("SELECT * FROM repos ORDER BY id").all().map(toRepo);
const knownSlugs = new Set(repos.map((repo) => repo.slug));

/** Group membership per repo, for the detail panel. */
const membership = new Map();
for (const row of sqlite
  .prepare(
    `SELECT repo_groups.repo_id AS repoId, groups.id AS id, groups.name AS name
       FROM repo_groups JOIN groups ON groups.id = repo_groups.group_id`,
  )
  .all()) {
  const list = membership.get(row.repoId) ?? [];
  list.push({ id: row.id, name: row.name });
  membership.set(row.repoId, list);
}

const groupCounts = new Map();
for (const row of sqlite
  .prepare("SELECT group_id AS groupId, count(*) AS count FROM repo_groups GROUP BY group_id")
  .all()) {
  groupCounts.set(row.groupId, Number(row.count) || 0);
}

const groups = sqlite
  .prepare("SELECT * FROM groups ORDER BY sort_order, name")
  .all()
  .map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    isSmart: Boolean(row.is_smart),
    smartFilter: parseJson(row.smart_filter_json, null),
    parentGroupId: row.parent_group_id ?? null,
    sortOrder: row.sort_order ?? 0,
    repoCount: groupCounts.get(row.id) ?? 0,
  }));

/** READMEs are only sent for the repos that have one. */
const detail = {};
for (const row of sqlite
  .prepare("SELECT slug, readme_content FROM repos WHERE readme_content IS NOT NULL")
  .all()) {
  const repo = repos.find((candidate) => candidate.slug === row.slug);
  detail[row.slug] = {
    readmeContent: row.readme_content,
    groups: repo ? (membership.get(repo.id) ?? []) : [],
  };
}

const links = sqlite
  .prepare(
    `SELECT repo_links.id AS id, from_repo.slug AS fromSlug, to_repo.slug AS toSlug,
            repo_links.kind AS kind, repo_links.why AS why,
            repo_links.source AS source, repo_links.created_at AS createdAt
       FROM repo_links
       JOIN repos AS from_repo ON from_repo.id = repo_links.from_repo_id
       JOIN repos AS to_repo ON to_repo.id = repo_links.to_repo_id`,
  )
  .all()
  // A link whose end is no longer in the catalog is not a link this bridge can
  // draw, and the schema's slugs are meant to resolve.
  .filter((link) => knownSlugs.has(link.fromSlug) && knownSlugs.has(link.toSlug))
  .map((link) => ({ ...link, why: link.why ?? null, source: link.source ?? "mcp" }));

const settingsRow = sqlite
  .prepare("SELECT data_json, schema_version FROM settings WHERE id = 1")
  .get();
const scanPaths = sqlite
  .prepare("SELECT path, enabled FROM scan_paths")
  .all()
  .filter((row) => Boolean(row.enabled))
  .map((row) => row.path);
const parsedSettings = parseJson(settingsRow?.data_json ?? null, {});
const settings = {
  scanPaths: parsedSettings.scanPaths?.length ? parsedSettings.scanPaths : scanPaths,
  ollamaBaseUrl: parsedSettings.ollamaBaseUrl ?? "http://localhost:11434",
  ollamaEmbedModel: parsedSettings.ollamaEmbedModel ?? "nomic-embed-text",
  openaiEmbedModel: parsedSettings.openaiEmbedModel ?? null,
  defaultEditor: parsedSettings.defaultEditor ?? "vscode",
  defaultTerminal: parsedSettings.defaultTerminal ?? null,
  identities: parsedSettings.identities ?? [],
  adHocNoticeDismissed: parsedSettings.adHocNoticeDismissed ?? false,
  schemaVersion: parsedSettings.schemaVersion ?? settingsRow?.schema_version ?? 1,
};

sqlite.close();

// ---------------------------------------------------------------------------
// Write it
// ---------------------------------------------------------------------------

const outPath = readFlag("--out") ?? DEFAULT_OUT;
const payload = {
  format: FORMAT,
  exportedAt: new Date().toISOString(),
  dbPath,
  repos,
  groups,
  detail,
  links,
  settings,
};

writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const bytes = statSync(outPath).size;
console.log(
  `[export-catalog] wrote ${repos.length} repos, ${groups.length} groups and ` +
    `${links.length} curated links from ${dbPath} to ${outPath} (${Math.round(bytes / 1024)} KiB)`,
);
console.log(
  "[export-catalog] the dev server serves it at /__atr/catalog.json — restart " +
    "`pnpm electron:dev` if it was already running, then open the dev URL in a browser tab",
);
