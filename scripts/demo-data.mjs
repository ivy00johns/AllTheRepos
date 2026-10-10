#!/usr/bin/env node
/**
 * Build a demo profile you can record a video against.
 *
 * The catalog is the app, and the catalog is your machine. Recording a demo
 * from a working install would put real repository names, remotes and folder
 * layout on camera, so this script writes a self-contained library into a
 * throwaway Electron profile (its own `--user-data-dir`) and seeds that
 * profile's SQLite catalog with it. Your real `~/Library/Application
 * Support/alltherepos/` is never opened, read or written.
 *
 * ## Why the graph needs more than rows
 *
 * The relationship graph is not a table of edges — `src/main/services/graph.ts`
 * derives them. Inspecting the builder, an edge is drawn from:
 *
 * | signal       | where it is read from                                    |
 * | ------------ | -------------------------------------------------------- |
 * | `dependency` | each repo's `package.json` **on disk**                    |
 * | `reference`  | `repos.readme_content` in the DB                          |
 * | `submodule`  | each repo's `.gitmodules` **on disk**                     |
 * | `owner`      | `remote_url` in the DB                                    |
 * | `naming`     | `name` in the DB — shared name tokens                     |
 * | `curated`    | the `repo_links` table                                    |
 *
 * So a demo catalog that only inserts rows produces a thin map: owner edges
 * between clones, naming edges between similarly named repos, and little else.
 * This script therefore does both halves — it writes real git repositories
 * (with `package.json`, `README.md` and `.gitmodules`) to the demo folder *and*
 * inserts the matching rows and curated links, so all six signals fire.
 *
 * ## Why two processes
 *
 * Nothing here can use host Node's `better-sqlite3`: after a release build or
 * an E2E run, the natives are compiled for Electron's ABI and host Node cannot
 * load them. The script follows the `make-readme-shots.mjs` pattern — boot the
 * app once against the profile so it creates and migrates the database, then
 * run the insert under `ELECTRON_RUN_AS_NODE=1 <electron>`.
 *
 * Usage:
 *   node scripts/ensure-native-abi.mjs electron
 *   pnpm electron:build
 *   node scripts/demo-data.mjs                    # build the profile
 *   node scripts/demo-data.mjs --launch           # build it, then open the app
 *
 *   node scripts/demo-data.mjs --profile /tmp/atr-demo --force
 *
 * Exit codes: 0 — profile written (or the app launched) · 2 — bad usage, a
 * missing bundle, a profile that already exists, or natives on the wrong ABI.
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");
const DEFAULT_PROFILE = path.join(homedir(), ".alltherepos-demo");

/**
 * The git identity the demo library belongs to.
 *
 * `settings.identities` is what makes the catalog's ownership marks read
 * *mine* instead of *cloned*: without one the app infers an identity from the
 * dominant remote owner, and every demo repo would wear the wrong badge.
 */
const DEMO_IDENTITY = "ivy00johns";

/**
 * Linguist colours, mirroring `src/renderer/components/catalog/language-colors.ts`.
 *
 * `LanguageBytesSchema` requires a non-empty `color` and the UI paints it as
 * given, so a placeholder would tint the language bar wrong.
 */
const LANGUAGE_COLORS = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Rust: "#dea584",
  Go: "#00ADD8",
  CSS: "#563d7c",
  Shell: "#89e051",
  "C++": "#f34b7d",
  "Jupyter Notebook": "#DA5B0B",
  MDX: "#fcb32c",
  YAML: "#cb171e",
  HCL: "#844FBA",
  GLSL: "#5686a5",
  TOML: "#9c4221",
  HTML: "#e34c26",
};

const FALLBACK_LANGUAGE_COLOR = "#94a3b8";

/**
 * The demo catalog.
 *
 * Built around five name families (`atlas`, `sentinel`, `mailroom`, `forge`,
 * `ledger`) so the graph has real clusters, and deliberately **spread across
 * folders** — a family with one member outside its siblings' folder is exactly
 * what the graph page exists to catch. Everything else is a plausible
 * stand-alone project so the catalog is not five families and nothing else.
 *
 * `refs` are readme cross-links to another repo's GitHub page (the `reference`
 * signal); `deps` are package.json dependencies shared inside a family (the
 * `dependency` signal). Both are written to disk as well as to the DB.
 */
const DEMO_CATALOG = [
  {
    name: "atlas-api",
    owner: DEMO_IDENTITY,
    family: "atlas",
    folder: "acme/atlas",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 212_000 },
      { name: "Shell", bytes: 3_400 },
    ],
    tags: ["api", "graphql", "service"],
    description: "The public Atlas API — a GraphQL gateway over the ledger.",
    deps: ["@atlas/protocol", "atlas-schema", "fastify"],
    refs: ["atlas-web", "atlas-worker"],
    hoursAgo: 4,
    message: "Add cursor pagination to the connections",
    sizeKb: 26_400,
  },
  {
    name: "atlas-web",
    owner: DEMO_IDENTITY,
    family: "atlas",
    folder: "acme/atlas",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 188_000 },
      { name: "CSS", bytes: 44_000 },
    ],
    tags: ["ui", "dashboard"],
    description: "Operator console for the Atlas cluster.",
    deps: ["@atlas/protocol", "@atlas/ui", "react"],
    refs: ["atlas-api"],
    hoursAgo: 9,
    message: "Darken the panel dividers",
    sizeKb: 31_900,
  },
  {
    name: "atlas-worker",
    owner: DEMO_IDENTITY,
    family: "atlas",
    folder: "experiments/atlas-worker",
    language: "TypeScript",
    languages: [{ name: "TypeScript", bytes: 121_000 }],
    tags: ["queue", "worker"],
    description: "Background fan-out for the Atlas ingest jobs.",
    deps: ["@atlas/protocol", "atlas-schema", "bullmq"],
    refs: ["atlas-api"],
    hoursAgo: 30,
    message: "Drain the retry queue on shutdown",
    sizeKb: 14_200,
  },
  {
    name: "atlas-migrate",
    owner: DEMO_IDENTITY,
    family: "atlas",
    folder: "acme/atlas",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 64_000 },
      { name: "YAML", bytes: 5_100 },
    ],
    tags: ["migrations", "cli"],
    description: "Schema migrations and backfills for Atlas.",
    deps: ["atlas-schema", "knex"],
    refs: ["atlas-api"],
    hoursAgo: 52,
    message: "Split the tenant tables out",
    sizeKb: 7_800,
  },

  {
    name: "sentinel-core",
    owner: DEMO_IDENTITY,
    family: "sentinel",
    folder: "acme/sentinel",
    language: "Rust",
    languages: [
      { name: "Rust", bytes: 141_000 },
      { name: "TOML", bytes: 2_100 },
    ],
    tags: ["security", "agent"],
    description: "Policy engine and host agent for the Sentinel fleet.",
    deps: [],
    refs: ["sentinel-rules"],
    hoursAgo: 7,
    message: "Reject unsigned rule bundles",
    sizeKb: 18_600,
  },
  {
    name: "sentinel-agent",
    owner: DEMO_IDENTITY,
    family: "sentinel",
    folder: "acme/sentinel",
    language: "Go",
    languages: [{ name: "Go", bytes: 88_000 }],
    tags: ["security", "daemon"],
    description: "The node-side daemon that reports to Sentinel core.",
    deps: [],
    refs: ["sentinel-core"],
    hoursAgo: 21,
    message: "Backoff the heartbeat when the hub is unreachable",
    sizeKb: 9_300,
  },
  {
    name: "sentinel-rules",
    owner: DEMO_IDENTITY,
    family: "sentinel",
    folder: "labs/sentinel-rules",
    language: "Rust",
    languages: [{ name: "Rust", bytes: 44_000 }],
    tags: ["security", "rules"],
    description: "The rule set the fleet loads at boot.",
    deps: [],
    refs: ["sentinel-core"],
    hoursAgo: 160,
    message: "Add a rule for outbound DNS over HTTPS",
    sizeKb: 3_100,
  },

  {
    name: "mailroom",
    owner: DEMO_IDENTITY,
    family: "mailroom",
    folder: "acme/mailroom",
    language: "Go",
    languages: [
      { name: "Go", bytes: 76_000 },
      { name: "Makefile", bytes: 1_400 },
    ],
    tags: ["email", "webhooks"],
    description: "Inbound mail webhooks, normalised and queued.",
    deps: [],
    refs: ["mailroom-queue", "mailroom-webhooks"],
    hoursAgo: 13,
    message: "Normalise the reply-to header before queueing",
    sizeKb: 8_400,
  },
  {
    name: "mailroom-queue",
    owner: DEMO_IDENTITY,
    family: "mailroom",
    folder: "acme/mailroom-queue",
    language: "Go",
    languages: [{ name: "Go", bytes: 41_000 }],
    tags: ["email", "queue"],
    description: "The durable queue sitting between ingest and delivery.",
    deps: [],
    refs: ["mailroom"],
    hoursAgo: 44,
    message: "Persist the dead-letter body",
    sizeKb: 4_700,
  },
  {
    name: "mailroom-webhooks",
    owner: DEMO_IDENTITY,
    family: "mailroom",
    folder: "experiments/mailroom-webhooks",
    language: "TypeScript",
    languages: [{ name: "TypeScript", bytes: 38_000 }],
    tags: ["email", "delivery"],
    description: "Outbound delivery webhooks, retried with backoff.",
    deps: ["mailparser", "nodemailer"],
    refs: ["mailroom"],
    hoursAgo: 400,
    message: "Sign the payload with the tenant key",
    sizeKb: 3_900,
  },

  {
    name: "pixel-forge",
    owner: DEMO_IDENTITY,
    family: "forge",
    folder: "graphics/pixel-forge",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 92_000 },
      { name: "GLSL", bytes: 17_000 },
    ],
    tags: ["shaders", "editor"],
    description: "Sprite pipeline with a live shader preview.",
    deps: ["glslify", "sharp"],
    refs: ["data-forge"],
    hoursAgo: 1_050,
    message: "Add a node graph for the atlas pass",
    sizeKb: 21_300,
  },
  {
    name: "data-forge",
    owner: DEMO_IDENTITY,
    family: "forge",
    folder: "graphics/data-forge",
    language: "TypeScript",
    languages: [{ name: "TypeScript", bytes: 58_000 }],
    tags: ["data", "tooling"],
    description: "Turns spreadsheets into spritesheets for the pipeline.",
    deps: ["glslify", "sharp"],
    refs: ["pixel-forge"],
    hoursAgo: 2_600,
    message: "Handle sheets with a hidden first row",
    sizeKb: 6_200,
  },

  {
    name: "ledger-core",
    owner: DEMO_IDENTITY,
    family: "ledger",
    folder: "services/ledger-core",
    language: "Rust",
    languages: [
      { name: "Rust", bytes: 98_000 },
      { name: "TOML", bytes: 1_900 },
    ],
    tags: ["ledger", "cli"],
    description: "Double-entry ledger with an append-only journal.",
    deps: [],
    refs: ["ledger-sync"],
    hoursAgo: 1_400,
    message: "Fail closed when a journal entry is unbalanced",
    sizeKb: 12_100,
  },
  {
    name: "ledger-sync",
    owner: DEMO_IDENTITY,
    family: "ledger",
    folder: "experiments/ledger-sync",
    language: "Rust",
    languages: [{ name: "Rust", bytes: 33_000 }],
    tags: ["ledger", "sync"],
    description: "Reconciles the local journal against the bank feed.",
    deps: [],
    refs: ["ledger-core"],
    hoursAgo: 3_300,
    message: "Tolerate a statement that closes mid-month",
    sizeKb: 5_400,
  },

  {
    name: "lighthouse-ui",
    owner: DEMO_IDENTITY,
    family: null,
    folder: "labs/lighthouse-ui",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 96_000 },
      { name: "CSS", bytes: 22_000 },
    ],
    tags: ["ui", "electron"],
    description: "A desktop shell for the internal dashboards.",
    deps: ["react"],
    refs: ["atlas-web"],
    hoursAgo: 2,
    message: "Give the toolbar a grouped segmented control",
    sizeKb: 22_700,
  },
  {
    name: "edge-proxy",
    owner: DEMO_IDENTITY,
    family: null,
    folder: "infra/edge-proxy",
    language: "Go",
    languages: [
      { name: "Go", bytes: 54_000 },
      { name: "HCL", bytes: 13_000 },
    ],
    tags: ["proxy", "terraform"],
    description: "Tiny reverse proxy with per-tenant rate limits.",
    deps: [],
    refs: [],
    hoursAgo: 620,
    dirty: true,
    message: "Pin the upstream TLS floor to 1.2",
    sizeKb: 6_600,
  },
  {
    name: "terraform-live",
    owner: DEMO_IDENTITY,
    family: null,
    folder: "infra/terraform-live",
    language: "HCL",
    languages: [{ name: "HCL", bytes: 41_000 }],
    tags: ["terraform", "aws"],
    description: "The applied stack — every change here is a change in prod.",
    deps: [],
    refs: [],
    hoursAgo: 900,
    message: "Split the network stack out of the app stack",
    sizeKb: 1_900,
  },
  {
    name: "voxel-engine",
    owner: DEMO_IDENTITY,
    family: null,
    folder: "graphics/voxel-engine",
    language: "C++",
    languages: [
      { name: "C++", bytes: 147_000 },
      { name: "GLSL", bytes: 31_000 },
      { name: "CMake", bytes: 4_100 },
    ],
    tags: ["renderer", "vulkan"],
    description: "Chunked voxel renderer: sparse octree, persistent GPU buffers.",
    deps: [],
    refs: [],
    hoursAgo: 1_800,
    message: "Defer the voxel upload by one frame",
    sizeKb: 48_300,
  },
  {
    name: "weatherbot",
    owner: DEMO_IDENTITY,
    family: null,
    folder: "labs/weatherbot",
    language: "Python",
    languages: [
      { name: "Python", bytes: 36_000 },
      { name: "Jupyter Notebook", bytes: 63_000 },
    ],
    tags: ["data", "notebook"],
    description: "Forecast deltas against the public station archive.",
    deps: [],
    refs: ["sketchbook"],
    hoursAgo: 2_400,
    message: "Backfill the 2019 station readings",
    sizeKb: 71_800,
  },
  {
    name: "sketchbook",
    owner: null,
    family: null,
    folder: "labs/sketchbook",
    language: "Jupyter Notebook",
    languages: [
      { name: "Jupyter Notebook", bytes: 122_000 },
      { name: "Python", bytes: 19_000 },
    ],
    tags: ["ml", "notes"],
    description: "Throwaway notebooks that never became a paper.",
    deps: [],
    refs: [],
    hoursAgo: 3_900,
    message: "Two-layer net on the toy corpus, for the write-up",
    sizeKb: 29_100,
  },
  {
    name: "docs-site",
    owner: "somebodyelse",
    family: null,
    folder: "web/docs-site",
    language: "MDX",
    languages: [
      { name: "MDX", bytes: 86_000 },
      { name: "TypeScript", bytes: 23_000 },
    ],
    tags: ["docs", "astro"],
    description: "A fork of a docs starter, kept for the plugin examples.",
    deps: [],
    refs: [],
    hoursAgo: 11_000,
    message: "Document the plugin hooks",
    sizeKb: 13_900,
  },
  {
    name: "old-experiment",
    owner: null,
    family: null,
    folder: "web/old-experiment",
    language: "JavaScript",
    languages: [{ name: "JavaScript", bytes: 9_400 }],
    tags: ["old"],
    description: "The first thing I ever deployed. Kept for sentimental reasons.",
    deps: [],
    refs: [],
    hoursAgo: 9_000,
    message: "Initial commit",
    sizeKb: 700,
  },
  {
    name: "orchestrator",
    owner: DEMO_IDENTITY,
    family: null,
    folder: "labs/orchestrator",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 68_000 },
      { name: "YAML", bytes: 6_100 },
    ],
    tags: ["agent", "queue"],
    description: "Dispatch layer: a work graph, a fleet, a merge queue.",
    deps: ["bullmq"],
    refs: ["atlas-worker"],
    hoursAgo: 7_200,
    message: "Isolate each worker in its own worktree",
    sizeKb: 16_700,
  },
  {
    name: "notekeeper",
    owner: DEMO_IDENTITY,
    family: null,
    folder: "web/notekeeper",
    language: "JavaScript",
    languages: [
      { name: "JavaScript", bytes: 47_000 },
      { name: "HTML", bytes: 8_200 },
    ],
    tags: ["notes", "app"],
    description: "A local-first notes app that vendors the Atlas editor.",
    deps: [],
    refs: ["atlas-web"],
    submodules: ["atlas-web"],
    hoursAgo: 5_400,
    dirty: true,
    message: "Bump the vendored editor",
    sizeKb: 11_500,
  },
];

/**
 * Curated links — a person's assertions, the highest-weight signal.
 *
 * Deliberately includes both the family reorgs (the `part-of` edges that make
 * the scatter list actionable) and a couple of cross-project links, so the map
 * shows accent arrows that no derived signal would have drawn.
 */
const DEMO_LINKS = [
  {
    from: "atlas-worker",
    to: "atlas-api",
    kind: "part-of",
    why: "spun out of the API repo, belongs back under acme/atlas",
  },
  {
    from: "sentinel-rules",
    to: "sentinel-core",
    kind: "part-of",
    why: "the rule bundle ships with core",
  },
  {
    from: "mailroom-webhooks",
    to: "mailroom",
    kind: "part-of",
    why: "delivery half of the same service",
  },
  {
    from: "ledger-sync",
    to: "ledger-core",
    kind: "part-of",
    why: "reads the same journal",
  },
  {
    from: "orchestrator",
    to: "lighthouse-ui",
    kind: "depends-on",
    why: "dispatches work into the desktop shell",
  },
  {
    from: "lighthouse-ui",
    to: "atlas-web",
    kind: "depends-on",
    why: "borrowed the operator console layout",
  },
];

// ---------------------------------------------------------------------------
// Derived shapes — pure, so the test suite can check them without Electron.
// ---------------------------------------------------------------------------

const kebab = (value) =>
  value
    .replace(/[A-Z]+/g, (match) => `-${match.toLowerCase()}`)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const shortHash = (value) =>
  crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);

const remoteUrl = (entry) =>
  entry.owner ? `git@github.com:${entry.owner}/${entry.name}.git` : null;

const entryByName = (name) => DEMO_CATALOG.find((entry) => entry.name === name);

/** A repo's readme, cross-linking its family and its explicit refs. */
function readmeFor(entry) {
  const peers = new Set(entry.refs ?? []);
  for (const other of DEMO_CATALOG) {
    if (other.family && other.family === entry.family && other.name !== entry.name) {
      peers.add(other.name);
    }
  }

  const related = [...peers]
    .map((name) => entryByName(name))
    .filter((peer) => peer && peer.owner)
    .map(
      (peer) =>
        `- [${peer.name}](https://github.com/${peer.owner}/${peer.name}) — ${peer.description}`,
    );

  return [
    `# ${entry.name}`,
    "",
    entry.description,
    "",
    ...(related.length > 0 ? ["## Related", "", ...related, ""] : []),
  ].join("\n");
}

/** `package.json` contents, or null when the repo declares nothing. */
function packageJsonFor(entry) {
  if (!entry.deps || entry.deps.length === 0) return null;
  return `${JSON.stringify(
    {
      name: entry.name,
      private: true,
      version: "0.0.0",
      dependencies: Object.fromEntries(entry.deps.map((dep) => [dep, "1.0.0"])),
    },
    null,
    2,
  )}\n`;
}

/** `.gitmodules` contents, or null when the repo vendors nothing. */
function gitmodulesFor(entry) {
  if (!entry.submodules || entry.submodules.length === 0) return null;
  return entry.submodules
    .map(
      (name) =>
        `[submodule "${name}"]\n\tpath = vendor/${name}\n\turl = ${remoteUrl(entryByName(name))}`,
    )
    .join("\n")
    .concat("\n");
}

/**
 * The demo library as catalog rows, ready to insert.
 *
 * `slug`, `languages[].color`, `tags[].source` and `readme_content` are all
 * required by the schemas the IPC layer validates against — see
 * `tests/unit/scripts/demo-data.spec.ts`, which checks every row here against
 * the real schemas. A row that omits one makes the *whole* list read fail and
 * the app renders an empty catalog with no error.
 */
export function demoRepos(root) {
  return DEMO_CATALOG.map((entry) => {
    const fullPath = path.join(root, entry.folder, entry.name);
    return {
      slug: `${kebab(entry.name)}-${shortHash(fullPath)}`,
      name: entry.name,
      fullPath,
      remoteUrl: remoteUrl(entry),
      defaultBranch: "main",
      currentBranch: "main",
      lastCommitHash: shortHash(`${entry.name}-head`),
      lastCommitDate: new Date(
        Date.now() - entry.hoursAgo * 3_600_000,
      ).toISOString(),
      lastCommitMsg: entry.message,
      isDirty: entry.dirty ? 1 : 0,
      primaryLanguage: entry.language,
      languages: entry.languages.map((language) => ({
        ...language,
        color: LANGUAGE_COLORS[language.name] ?? FALLBACK_LANGUAGE_COLOR,
      })),
      tags: entry.tags.map((value) => ({ value, source: "user" })),
      description: entry.description,
      sizeBytes: entry.sizeKb * 1024,
      readmeContent: readmeFor(entry),
    };
  });
}

/** Curated links resolved to the slugs `demoRepos` produced. */
export function demoLinks(root) {
  const slugOf = new Map(
    demoRepos(root).map((row) => [row.name, row.slug]),
  );
  return DEMO_LINKS.map((link) => ({
    fromSlug: slugOf.get(link.from),
    toSlug: slugOf.get(link.to),
    kind: link.kind,
    why: link.why,
  }));
}

/**
 * The demo library as files on disk.
 *
 * `package.json` and `.gitmodules` are what the graph reads directly, so these
 * have to exist or the `dependency` and `submodule` signals never fire.
 */
export function demoFiles(root) {
  const files = [];
  for (const entry of DEMO_CATALOG) {
    const dir = path.join(root, entry.folder, entry.name);
    files.push({ path: path.join(dir, "README.md"), content: readmeFor(entry) });
    const pkg = packageJsonFor(entry);
    if (pkg) files.push({ path: path.join(dir, "package.json"), content: pkg });
    const modules = gitmodulesFor(entry);
    if (modules) {
      files.push({ path: path.join(dir, ".gitmodules"), content: modules });
    }
  }
  return files;
}

/** The scan roots the demo profile is configured with. */
export function demoScanPaths(root) {
  return [root];
}

// ---------------------------------------------------------------------------
// Seed mode — runs under Electron's Node, never host Node.
// ---------------------------------------------------------------------------

if (process.argv[2] === "--seed" && isMainModule()) {
  const [dbPath, jsonPath] = process.argv.slice(3);
  if (!dbPath || !jsonPath) {
    console.error("usage: demo-data.mjs --seed <dbPath> <jsonPath>");
    process.exit(2);
  }

  const { default: Database } = await import("better-sqlite3");
  const { rows, links } = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const sqlite = new Database(dbPath);

  try {
    for (const table of ["repo_links", "repo_groups", "groups", "repos"]) {
      sqlite.prepare(`DELETE FROM ${table}`).run();
    }

    const insertRepo = sqlite.prepare(`
      INSERT INTO repos (
        slug, name, full_path, remote_url, default_branch, current_branch,
        last_commit_hash, last_commit_date, last_commit_msg, is_dirty,
        primary_language, languages_json, tags_json, description,
        readme_content, readme_hash, size_bytes, last_scanned_at, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLink = sqlite.prepare(`
      INSERT INTO repo_links (from_repo_id, to_repo_id, kind, why, source)
      SELECT f.id, t.id, ?, ?, 'ui'
        FROM repos f, repos t
       WHERE f.slug = ? AND t.slug = ?
    `);

    const seed = sqlite.transaction(() => {
      for (const row of rows) {
        insertRepo.run(
          row.slug,
          row.name,
          row.fullPath,
          row.remoteUrl,
          row.defaultBranch,
          row.currentBranch,
          row.lastCommitHash,
          row.lastCommitDate,
          row.lastCommitMsg,
          row.isDirty,
          row.primaryLanguage,
          JSON.stringify(row.languages),
          JSON.stringify(row.tags),
          row.description,
          row.readmeContent,
          null,
          row.sizeBytes,
          new Date().toISOString(),
          "filesystem_scan",
        );
      }
      for (const link of links) {
        insertLink.run(link.kind, link.why, link.fromSlug, link.toSlug);
      }
    });

    seed();
    console.log(
      `[demo-data] seeded ${rows.length} repos and ${links.length} curated links into ${dbPath}`,
    );
  } finally {
    sqlite.close();
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Profile mode.
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
};
const has = (name) => argv.includes(name);

/** A real git repo, so the detail rail and the scanner have answers. */
function initRepo(dir, { dirty, commitMessage }) {
  mkdirSync(dir, { recursive: true });
  const git = (args) => spawnSync("git", args, { cwd: dir });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git([
    "-c",
    "user.email=demo@example.com",
    "-c",
    "user.name=Demo",
    "commit",
    "-q",
    "-m",
    commitMessage,
  ]);
  if (dirty) {
    fs.writeFileSync(path.join(dir, "work-in-progress.txt"), "scratch\n");
  }
}

function launchApp(profileDir) {
  return spawn(require("electron"), [MAIN_ENTRY, `--user-data-dir=${profileDir}`], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "inherit",
  });
}

/**
 * Whether the natives are built for Electron's ABI.
 *
 * The failure is unrecognisable otherwise: the main process dies loading
 * `better-sqlite3` and Electron reports nothing useful. `new Database(...)`
 * rather than a bare `require`, because better-sqlite3 defers its bindings —
 * a require succeeds against a foreign ABI and would report a healthy tree.
 */
function nativesMatchElectron() {
  const probe =
    'const D = require("better-sqlite3"); new D(":memory:").close();';
  const result = spawnSync(require("electron"), ["-e", probe], {
    cwd: REPO_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
  });
  return result.status === 0;
}

async function main() {
  const launch = has("--launch");
  const force = has("--force");
  const profileDir = resolve(flag("--profile", DEFAULT_PROFILE));
  const reposRoot = resolve(flag("--root", path.join(profileDir, "Code")));

  if (!fs.existsSync(MAIN_ENTRY)) {
    console.error(
      `[demo-data] no bundle at ${MAIN_ENTRY} — run \`pnpm electron:build\` first.`,
    );
    process.exit(2);
  }
  if (!nativesMatchElectron()) {
    console.error(
      "[demo-data] the native modules are not built for Electron's ABI. Run:\n" +
        "[demo-data]   node scripts/ensure-native-abi.mjs electron",
    );
    process.exit(2);
  }
  if (fs.existsSync(profileDir) && !force) {
    console.error(
      `[demo-data] ${profileDir} already exists — refusing to overwrite it.\n` +
        "[demo-data] pass --force to rebuild it, or --profile <dir> for a fresh one.",
    );
    process.exit(2);
  }
  if (fs.existsSync(profileDir)) {
    rmSync(profileDir, { recursive: true, force: true });
  }

  const rows = demoRepos(reposRoot);
  const links = demoLinks(reposRoot);
  const dbPath = path.join(profileDir, "alltherepos.db");

  mkdirSync(profileDir, { recursive: true });

  // Claim the one-shot legacy migration before first boot, so the app does NOT
  // copy the real `~/.alltherepos/` catalog — and its repos, notes and remotes —
  // into this profile.
  fs.writeFileSync(path.join(profileDir, "MIGRATED"), new Date().toISOString());

  // Settings, so the demo library has a scan root to be measured against and an
  // identity so the ownership marks read *mine*. `__legacyPromoted` stops the
  // app from overwriting this file with freshly-seeded defaults (and then
  // scanning whatever real roots those defaults imply).
  fs.writeFileSync(
    path.join(profileDir, "settings.json"),
    `${JSON.stringify(
      {
        scanPaths: demoScanPaths(reposRoot),
        ollamaBaseUrl: "http://localhost:11434",
        ollamaEmbedModel: "nomic-embed-text",
        openaiEmbedModel: null,
        defaultEditor: "vscode",
        identities: [DEMO_IDENTITY],
        schemaVersion: 1,
        __legacyPromoted: true,
      },
      null,
      2,
    )}\n`,
  );

  // The library on disk — the half of the graph that is read from files.
  for (const file of demoFiles(reposRoot)) {
    mkdirSync(path.dirname(file.path), { recursive: true });
    fs.writeFileSync(file.path, file.content);
  }
  for (const entry of DEMO_CATALOG) {
    initRepo(path.join(reposRoot, entry.folder, entry.name), {
      dirty: entry.dirty,
      commitMessage: entry.message,
    });
  }
  console.log(
    `[demo-data] wrote ${DEMO_CATALOG.length} repositories under ${reposRoot}`,
  );

  // 1. Boot the app once against the profile so it creates and migrates the
  //    database — the seeder fills an existing DB, it does not create one,
  //    because the app owns that DDL.
  const { _electron: electron } = await import("@playwright/test");
  const bootstrap = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: "test", ATR_E2E: "1" },
  });
  try {
    const win = await bootstrap.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    // Give migrations a moment to finish before the seeder opens the file.
    await win.waitForTimeout(1_500);
  } finally {
    await bootstrap.close();
  }

  // 2. Insert rows and curated links under Electron's Node.
  const jsonPath = path.join(profileDir, "demo-seed.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ rows, links }));
  const seeded = spawnSync(
    require("electron"),
    [fileURLToPath(import.meta.url), "--seed", dbPath, jsonPath],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    },
  );
  rmSync(jsonPath, { force: true });
  if (seeded.status !== 0) {
    console.error(
      `[demo-data] seed failed (${seeded.status})\n${seeded.stdout ?? ""}\n${seeded.stderr ?? ""}`,
    );
    process.exit(2);
  }
  console.log((seeded.stdout ?? "").trim());

  console.log("");
  console.log(`  Demo profile ready at  ${profileDir}`);
  console.log("  Every repo, remote and folder in it is invented.");
  console.log("");
  console.log("  To record:");
  console.log(
    `    ${require("electron")} ${path.relative(process.cwd(), MAIN_ENTRY) || MAIN_ENTRY} --user-data-dir="${profileDir}"`,
  );
  console.log("");

  if (launch) {
    const child = launchApp(profileDir);
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, because the same file has two paths
 * whenever a symlink is involved and a string compare would then never match —
 * the seed would silently not run, and importing the module in the test suite
 * would boot an app.
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
  await main();
}
