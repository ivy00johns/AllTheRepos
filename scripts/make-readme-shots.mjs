#!/usr/bin/env node
/**
 * Regenerate the screenshots in `docs/images/` for the README.
 *
 * The library in these shots is **demo data in a throwaway profile**. The
 * README is public and the developer's real catalog is not — a screenshot of a
 * working machine would leak repo names, remotes and folder layout — so the app
 * is launched with `--user-data-dir` pointed at a temp directory, the rows are
 * written there, and nothing outside that directory is touched.
 *
 * The rows cannot be written by this (host Node) process: the release workflow
 * and the Electron E2E suite leave `better-sqlite3` compiled against Electron's
 * ABI, so host Node cannot load it. This file therefore has a second mode —
 * `--seed <dbPath> <jsonPath>` — that runs the insert under
 * `ELECTRON_RUN_AS_NODE=1 <electron>`, borrowing the app's own runtime so the
 * writer and the app agree on NODE_MODULE_VERSION without a second rebuild.
 *
 * Usage:
 *   node scripts/ensure-native-abi.mjs electron && electron-vite build
 *   node scripts/make-readme-shots.mjs
 *   node scripts/make-readme-shots.mjs --out docs/images --size 1440x900
 *
 * Exit codes: 0 — shots written · 2 — bad usage or a missing bundle.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");

// ---------------------------------------------------------------------------
// Seed mode — runs under Electron's Node, never under host Node.
// ---------------------------------------------------------------------------

if (process.argv[2] === "--seed" && isMainModule()) {
  const [dbPath, jsonPath] = process.argv.slice(3);
  if (!dbPath || !jsonPath) {
    console.error("usage: make-readme-shots.mjs --seed <dbPath> <jsonPath>");
    process.exit(2);
  }

  const { default: Database } = await import("better-sqlite3");
  const rows = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const sqlite = new Database(dbPath);

  try {
    // The catalog must contain the demo library and nothing else. A boot with
    // no `MIGRATED` sentinel copies the developer's real `~/.alltherepos/`
    // database into the profile, so this clears before it fills — belt and
    // braces with the sentinel the capture mode writes.
    for (const table of ["repo_links", "repo_groups", "groups", "repos"]) {
      sqlite.prepare(`DELETE FROM ${table}`).run();
    }

    const insert = sqlite.prepare(`
      INSERT INTO repos (
        slug, name, full_path, remote_url, default_branch, current_branch,
        last_commit_hash, last_commit_date, last_commit_msg, is_dirty,
        primary_language, languages_json, tags_json, description,
        readme_content, readme_hash, size_bytes, last_scanned_at, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seed = sqlite.transaction(() => {
      for (const row of rows) {
        insert.run(
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
          null,
          null,
          row.sizeBytes,
          new Date().toISOString(),
          "filesystem_scan",
        );
      }
    });

    seed();
    console.log(`[readme-shots] seeded ${rows.length} demo repos into ${dbPath}`);
  } finally {
    sqlite.close();
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Capture mode.
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
};

const OUT_DIR = resolve(REPO_ROOT, flag("--out", "docs/images"));
const SIZE = flag("--size", "1440x900");
const [WIDTH, HEIGHT] = SIZE.split("x").map(Number);

// The bundle and size checks live in `main()`, not here: a unit test imports
// this module for `demoRows`, and a top-level `process.exit` would take the
// whole test process down with it.

const { _electron: electron } = await import("@playwright/test");
const electronBinary = require("electron");

/**
 * The git handles that make the demo library classify as "mine".
 *
 * Without one, the catalog infers an identity from the dominant remote owner
 * and every repository reads as somebody else's clone — the ownership marks in
 * the shots would be uniformly wrong.
 */
const DEMO_IDENTITY = "ivy00johns";

/**
 * Linguist colours for the languages the demo library uses.
 *
 * Mirrors `src/renderer/components/catalog/language-colors.ts`, which is the
 * source of truth. The value has to be *present* — `LanguageBytesSchema`
 * requires a non-empty `color` — and it is rendered as given
 * (`l.color || colorForLanguage(l.name)`), so a placeholder would tint the
 * language bar wrong. Languages absent from that palette get its own fallback.
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
};

/** The palette's own fallback, for languages it does not list. */
const FALLBACK_LANGUAGE_COLOR = "#94a3b8";

/**
 * The demo library.
 *
 * Chosen to exercise every visual state the catalog has a chip for: a mix of
 * languages (so the language bar segments differ), recency from minutes to a
 * year (the activity ramp), one dirty tree, one no-remote local-only repo, and
 * a couple of clones that belong to somebody else (ownership marks).
 */
const DEMO_REPOS = [
  {
    name: "lighthouse-ui",
    group: "design",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 182_000 },
      { name: "CSS", bytes: 41_000 },
      { name: "Shell", bytes: 3_400 },
    ],
    tags: ["ui", "electron", "tailwind"],
    remote: "git@github.com:ivy00johns/lighthouse-ui.git",
    hoursAgo: 3,
    message: "Polish the catalog toolbar spacing",
    description: "The desktop surface: catalog, filter chips and the detail rail.",
    sizeKb: 24_800,
  },
  {
    name: "ledger-core",
    group: "services",
    language: "Rust",
    languages: [
      { name: "Rust", bytes: 96_000 },
      { name: "TOML", bytes: 2_100 },
    ],
    tags: ["ledger", "cli"],
    remote: "git@github.com:ivy00johns/ledger-core.git",
    hoursAgo: 26,
    message: "Fail closed when a journal entry is unbalanced",
    description: "Double-entry ledger with an append-only journal.",
    sizeKb: 11_200,
  },
  {
    name: "mailroom",
    group: "services",
    language: "Go",
    languages: [
      { name: "Go", bytes: 74_000 },
      { name: "Makefile", bytes: 1_400 },
    ],
    tags: ["email", "queue"],
    remote: "git@github.com:ivy00johns/mailroom.git",
    hoursAgo: 5,
    dirty: true,
    message: "Retry the webhook delivery with backoff",
    description: "Inbound mail webhooks, normalised and queued.",
    sizeKb: 8_100,
  },
  {
    name: "edge-proxy",
    group: "infra",
    language: "Go",
    languages: [
      { name: "Go", bytes: 51_000 },
      { name: "HCL", bytes: 12_000 },
    ],
    tags: ["proxy", "terraform"],
    remote: "git@github.com:ivy00johns/edge-proxy.git",
    hoursAgo: 140,
    message: "Pin the upstream TLS floor to 1.2",
    description: "Tiny reverse proxy with per-tenant rate limits.",
    sizeKb: 6_600,
  },
  {
    name: "terraform-live",
    group: "infra",
    language: "HCL",
    languages: [{ name: "HCL", bytes: 38_000 }],
    tags: ["terraform", "aws"],
    remote: "git@github.com:ivy00johns/terraform-live.git",
    hoursAgo: 340,
    message: "Split the network stack out of the app stack",
    description: "The applied stack — every change here is a change in prod.",
    sizeKb: 1_900,
  },
  {
    name: "voxel-engine",
    group: "graphics",
    language: "C++",
    languages: [
      { name: "C++", bytes: 143_000 },
      { name: "GLSL", bytes: 29_000 },
      { name: "CMake", bytes: 4_000 },
    ],
    tags: ["renderer", "vulkan"],
    remote: "git@github.com:ivy00johns/voxel-engine.git",
    hoursAgo: 620,
    message: "Defer the voxel upload by one frame",
    description: "Chunked voxel renderer: sparse octree, GPU-persistent buffers.",
    sizeKb: 46_300,
  },
  {
    name: "pixel-forge",
    group: "graphics",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 88_000 },
      { name: "GLSL", bytes: 16_000 },
    ],
    tags: ["shaders", "editor"],
    remote: "git@github.com:ivy00johns/pixel-forge.git",
    hoursAgo: 1_100,
    message: "Add a node graph for the sprite atlas pass",
    description: "Sprite pipeline with a live shader preview.",
    sizeKb: 19_400,
  },
  {
    name: "weatherbot",
    group: "labs",
    language: "Python",
    languages: [
      { name: "Python", bytes: 33_000 },
      { name: "Jupyter Notebook", bytes: 61_000 },
    ],
    tags: ["data", "notebook"],
    remote: "git@github.com:ivy00johns/weatherbot.git",
    hoursAgo: 2_400,
    message: "Backfill the 2019 station readings",
    description: "Forecast deltas against the public station archive.",
    sizeKb: 73_800,
  },
  {
    name: "sketchbook",
    group: "labs",
    language: "Jupyter Notebook",
    languages: [
      { name: "Jupyter Notebook", bytes: 120_000 },
      { name: "Python", bytes: 18_000 },
    ],
    tags: ["ml", "notes"],
    remote: null,
    hoursAgo: 3_900,
    message: "Two-layer net on the toy corpus, for the write-up",
    description: "Throwaway notebooks that never became a paper.",
    sizeKb: 28_100,
  },
  {
    name: "orchestrator",
    group: "labs",
    language: "TypeScript",
    languages: [
      { name: "TypeScript", bytes: 64_000 },
      { name: "YAML", bytes: 5_500 },
    ],
    tags: ["agent", "queue"],
    remote: "git@github.com:ivy00johns/orchestrator.git",
    hoursAgo: 7_200,
    message: "Isolate each worker in its own worktree",
    description: "Dispatch layer: a work graph, a fleet, a merge queue.",
    sizeKb: 15_700,
  },
  {
    name: "docs-site",
    group: "web",
    language: "MDX",
    languages: [
      { name: "MDX", bytes: 84_000 },
      { name: "TypeScript", bytes: 21_000 },
    ],
    tags: ["docs", "astro"],
    remote: "https://github.com/somebodyelse/docs-site.git",
    hoursAgo: 11_000,
    message: "Document the plugin hooks",
    description: "A fork of a docs starter, kept for the plugin examples.",
    sizeKb: 12_900,
  },
  {
    name: "old-experiment",
    group: "web",
    language: "JavaScript",
    languages: [{ name: "JavaScript", bytes: 9_400 }],
    tags: ["old"],
    remote: null,
    hoursAgo: 9_000,
    message: "Initial commit",
    description: "The first thing I ever deployed. Kept for sentimental reasons.",
    sizeKb: 700,
  },
];

const kebab = (value) =>
  value
    .replace(/[A-Z]+/g, (m) => `-${m.toLowerCase()}`)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const shortHash = (value) =>
  crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);

/** A real git repo, so the detail rail's branch and dirty reads have answers. */
function initRepo(dir, dirty) {
  mkdirSync(dir, { recursive: true });
  const git = (args) => spawnSync("git", args, { cwd: dir });
  git(["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(dir, "README.md"), `# ${path.basename(dir)}\n`);
  git(["add", "-A"]);
  git([
    "-c",
    "user.email=demo@example.com",
    "-c",
    "user.name=Demo",
    "commit",
    "-q",
    "-m",
    "Initial commit",
  ]);
  if (dirty) {
    fs.writeFileSync(path.join(dir, "work-in-progress.txt"), "scratch\n");
  }
}

/**
 * The demo library as catalog rows, ready to be inserted.
 *
 * Exported, and pure, so `tests/unit/scripts/make-readme-shots.spec.ts` can
 * check each row against the same Zod schemas the IPC layer validates against.
 * That test exists because this function was silently wrong once: `tags` and
 * `languages` went in without the `source` and `color` those schemas require,
 * every list read failed validation afterwards, and the app rendered an empty
 * catalog with no error anywhere — a fault that showed up only as a screenshot
 * timeout, several minutes into an Electron launch.
 */
export function demoRows(root) {
  return DEMO_REPOS.map((repo) => {
    const fullPath = path.join(root, repo.group, repo.name);
    return {
      slug: `${kebab(repo.name)}-${shortHash(fullPath)}`,
      name: repo.name,
      fullPath,
      remoteUrl: repo.remote,
      defaultBranch: "main",
      currentBranch: "main",
      lastCommitHash: shortHash(`${repo.name}-head`),
      lastCommitDate: new Date(
        Date.now() - repo.hoursAgo * 3_600_000,
      ).toISOString(),
      lastCommitMsg: repo.message,
      isDirty: repo.dirty ? 1 : 0,
      primaryLanguage: repo.language,
      languages: repo.languages.map((language) => ({
        ...language,
        color: LANGUAGE_COLORS[language.name] ?? FALLBACK_LANGUAGE_COLOR,
      })),
      // `source` is required by TagSchema, and "user" is what the app writes
      // for a tag a person added — which is what a curated demo library shows.
      tags: repo.tags.map((value) => ({ value, source: "user" })),
      description: repo.description,
      sizeBytes: repo.sizeKb * 1024,
    };
  });
}

function launch(profileDir) {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      // Show the window without stealing focus — the same courtesy the E2E
      // suite pays the developer, since this runs on their live desktop.
      ATR_E2E: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });
}

/** Screenshot the page at the window's own pixel size, not 2x Retina. */
async function shoot(win, name) {
  const file = path.join(OUT_DIR, name);
  await win.screenshot({ path: file, scale: "css" });
  const { size } = fs.statSync(file);
  console.log(
    `[readme-shots] ${path.relative(REPO_ROOT, file)} (${(size / 1024).toFixed(0)} KB)`,
  );
}

async function main() {
  if (!fs.existsSync(MAIN_ENTRY)) {
    console.error(
      `[readme-shots] no bundle at ${MAIN_ENTRY} — run \`pnpm electron:build\` first.`,
    );
    process.exit(2);
  }
  if (!Number.isFinite(WIDTH) || !Number.isFinite(HEIGHT)) {
    console.error(`[readme-shots] --size wants WxH, got "${SIZE}"`);
    process.exit(2);
  }

  const root = mkdtempSync(path.join(tmpdir(), "atr-readme-shots-"));
  const profileDir = path.join(root, "profile");
  const reposRoot = path.join(root, "Developer");
  const rows = demoRows(reposRoot);
  const dbPath = path.join(profileDir, "alltherepos.db");

  mkdirSync(profileDir, { recursive: true });
  for (const repo of DEMO_REPOS) {
    initRepo(path.join(reposRoot, repo.group, repo.name), repo.dirty);
  }

  // Claim the one-shot legacy migration before the first boot, so the app does
  // NOT copy the developer's real `~/.alltherepos/` database — and its library,
  // notes and remotes — into this profile. The demo library is the only thing
  // that may appear in a public screenshot.
  fs.writeFileSync(path.join(profileDir, "MIGRATED"), new Date().toISOString());

  // Settings, so the demo library has a scan root to be measured against:
  // folder labels on the cards and the rail both come from `scanPaths`, and
  // without one every card reads as an absolute temp path.
  //
  // `__legacyPromoted` is load-bearing, and not a detail: without it the app
  // treats the file as un-migrated, overwrites it wholesale with the freshly
  // seeded defaults from the SQLite settings row, and then scans whatever
  // `scanPaths` those defaults imply — which, on a developer machine, is the
  // real library this profile exists to keep out of the screenshots.
  fs.writeFileSync(
    path.join(profileDir, "settings.json"),
    `${JSON.stringify(
      {
        scanPaths: [reposRoot],
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

  mkdirSync(OUT_DIR, { recursive: true });

  try {
    // 1. Boot once so the app creates and migrates the database in the throwaway
    //    profile — the seeder fills an existing DB, it does not create one,
    //    because the app owns that DDL.
    const bootstrap = await launch(profileDir);
    try {
      const win = await bootstrap.firstWindow();
      await win.waitForLoadState("domcontentloaded");
    } finally {
      await bootstrap.close();
    }

    // 2. Write the demo rows.
    const rowsPath = path.join(root, "rows.json");
    fs.writeFileSync(rowsPath, JSON.stringify(rows));
    const seeded = spawnSync(
      electronBinary,
      [fileURLToPath(import.meta.url), "--seed", dbPath, rowsPath],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        encoding: "utf8",
      },
    );
    if (seeded.status !== 0) {
      throw new Error(
        `seed failed (${seeded.status})\n${seeded.stdout ?? ""}\n${seeded.stderr ?? ""}`,
      );
    }
    console.log((seeded.stdout ?? "").trim());

    // 3. Drive the app and capture.
    const app = await launch(profileDir);
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      await app.evaluate(
        ({ BrowserWindow }, size) => {
          const [window] = BrowserWindow.getAllWindows();
          window?.setContentSize(size.width, size.height);
        },
        { width: WIDTH, height: HEIGHT },
      );

      // The catalog, which is what the app is: sidebar, grid, detail rail.
      const cards = win.locator("article[data-repo-slug], tr[data-repo-slug]");
      try {
        await cards.first().waitFor({ state: "visible", timeout: 30_000 });
      } catch (error) {
        // The catalog renders "0 repos" both when it is genuinely empty and
        // when an IPC result failed validation, so print what is on screen
        // rather than leaving a bare timeout to interpret.
        const text = await win.evaluate(() => document.body.innerText);
        throw new Error(
          `no repo cards rendered after 30s — the app is showing:\n${text.slice(0, 1200)}\n\n${error.message}`,
        );
      }

      // Prove the shots show the demo library and nothing else. These images
      // are published, so "it looked fine" is not good enough: a single row
      // from the developer's real catalog would put a private repository name,
      // remote and folder layout in the README.
      const shown = await win.$$eval(
        "[data-repo-slug]",
        (nodes) => nodes.map((node) => node.getAttribute("data-repo-slug")),
      );
      const allowed = new Set(rows.map((row) => row.slug));
      const strays = shown.filter((slug) => !allowed.has(slug));
      if (strays.length > 0) {
        throw new Error(
          `refusing to publish screenshots: the catalog shows ${strays.length} repo(s) outside the demo library — ${strays.slice(0, 5).join(", ")}`,
        );
      }
      console.log(
        `[readme-shots] catalog shows ${shown.length} demo repos, no strays`,
      );
      await cards
        .filter({ hasText: "lighthouse-ui" })
        .first()
        .click();
      await win
        .getByRole("complementary", { name: /repo detail/i })
        .waitFor({ state: "visible", timeout: 15_000 });
      await win.waitForTimeout(600); // let the rail's own reads settle
      await shoot(win, "catalog.png");

      // The command palette, over the same catalog.
      await win.keyboard.press("Meta+k");
      const palette = win.getByRole("dialog", { name: /command palette/i });
      await palette.waitFor({ state: "visible", timeout: 10_000 });
      await palette.locator("input").fill("ledger");
      await win.waitForTimeout(400);
      await shoot(win, "command-palette.png");
      await win.keyboard.press("Escape");

      // Settings — the scan paths, the ignore globs, and the update controls
      // the release pipeline feeds.
      await win.getByRole("link", { name: /^settings$/i }).first().click();
      await win
        .getByRole("heading", { name: /settings/i })
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      await win.waitForTimeout(600);
      await shoot(win, "settings.png");
    } finally {
      await app.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, because the same file has two paths
 * whenever a symlink is involved (`/var/...` from the OS, `/private/var/...`
 * once resolved) and a string compare then never matches — the capture would
 * silently not run, and the import in the unit test would launch the app.
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
