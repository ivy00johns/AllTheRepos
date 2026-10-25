#!/usr/bin/env node
/**
 * Capture a design-review packet: every screen and the UI elements on it.
 *
 * The README shots (`make-readme-shots.mjs`) answer "what does this app look
 * like" in four frames. This answers "here is the whole surface, element by
 * element, for somebody redesigning it" — full-window shots of every route and
 * view mode, cropped shots of the repeating elements (top bar, rail, toolbar,
 * card, table, detail panel, dialogs, palette, satellite windows), and a narrow
 * pass at the window's own minimum so a reference sheet does not imply the
 * layout only ever gets 1440px.
 *
 * Same privacy rule as the README shots, and for the same reason: the library
 * in these frames is **demo data in a throwaway profile**. The packet is meant
 * to leave the machine (it is handed to a design tool), so the app is launched
 * with `--user-data-dir` pointed at a temp directory, the rows are seeded there,
 * and the demo git repos are created and deleted under a path that was verified
 * absent first.
 *
 * The one thing `--user-data-dir` does not isolate is Claude usage: the app
 * reads `~/.claude.json` and `~/.claude/projects` from the real home, which
 * would put this developer's project paths in the pictures. So the Claude
 * screens are captured in a **second launch with `HOME` pointed at a temp
 * directory** holding invented sessions. Neither launch can see the other's
 * home.
 *
 * Usage:
 *   node scripts/ensure-native-abi.mjs electron
 *   pnpm electron:build
 *   node scripts/make-design-shots.mjs [--out docs/design-review] [--keep]
 *
 * Exit codes: 0 — packet written · 2 — bad usage, missing bundle, or a `--root`
 * that already exists.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { demoRows } from "./make-readme-shots.mjs";

const require = createRequire(import.meta.url);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN_ENTRY = resolve(REPO_ROOT, "out", "main", "index.js");
const SEED_SCRIPT = resolve(REPO_ROOT, "scripts", "make-readme-shots.mjs");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
};
const has = (name) => argv.includes(name);

const OUT_DIR = resolve(REPO_ROOT, flag("--out", "docs/design-review"));
const KEEP = has("--keep");

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 1280, height: 800 };
const MINIMUM = { width: 1024, height: 768 };

const log = (...args) => console.log("[design-shots]", ...args);

// ---------------------------------------------------------------------------
// Manifest — what was written, what was skipped, and why.
// ---------------------------------------------------------------------------

/** @type {Array<{file: string, kind: string, note: string, status: string, error?: string}>} */
const manifest = [];

function record(file, kind, note, status, error) {
  manifest.push({
    file: path.relative(OUT_DIR, file).split(path.sep).join("/"),
    kind,
    note,
    status,
    ...(error ? { error } : {}),
  });
  const size = status === "ok" ? `${(fs.statSync(file).size / 1024).toFixed(0)} KB` : status;
  log(`${status === "ok" ? "" : `${status}: `}${path.relative(REPO_ROOT, file)} (${size})`);
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------
// Demo library
// ---------------------------------------------------------------------------

/**
 * Files that make one demo repo's Claude tab a real screen rather than four
 * empty states. Shapes are the app's own contract (`repo-claude.ts`):
 * `.claude/skills/<name>/SKILL.md`, `.claude/agents/<slug>.md`, `.mcp.json`.
 */
function claudeFixtures() {
  return {
    "CLAUDE.md":
      "# lighthouse-ui\n\nRead `design-system/alltherepos/MASTER.md` before\nchanging a surface. Type scale is closed: no raw font sizes.\n",
    ".claude/skills/ui-audit/SKILL.md":
      "---\nname: ui-audit\ndescription: Audit a screen against the type scale and the token palette, then file what it finds.\n---\n\n# ui-audit\n\nWalk the route, measure the type, name the token each colour came from.\n",
    ".claude/skills/rail-review/SKILL.md":
      "---\nname: rail-review\ndescription: Check the folder rail's rows against the scan roots and the group list.\n---\n\n# rail-review\n",
    ".claude/agents/design-critic.md":
      "---\nname: design-critic\ndescription: Reviews a rendered screen and names the generic parts.\nmodel: sonnet\n---\n\nYou look at screenshots and say which parts could belong to any app.\n",
    ".mcp.json": JSON.stringify(
      {
        mcpServers: {
          playwright: { command: "npx", args: ["-y", "@playwright/mcp"] },
          figma: { command: "npx", args: ["-y", "figma-developer-mcp"] },
        },
      },
      null,
      2,
    ),
  };
}

/** A real git repo, so the detail rail's branch and dirty reads have answers. */
function initRepo(dir, { dirty, files }) {
  mkdirSync(dir, { recursive: true });
  const git = (args) => spawnSync("git", args, { cwd: dir });
  git(["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(dir, "README.md"), `# ${path.basename(dir)}\n`);
  for (const [relative, contents] of Object.entries(files ?? {})) {
    const target = path.join(dir, relative);
    mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
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
 * Three invented listeners, bound to demo repos by cwd.
 *
 * `/processes` and the top bar's count both read a sweep of the *host* — the
 * developer's own dev servers would put their ports and PIDs in the packet and
 * make the count different on every run. `ATR_PROCESS_FIXTURE` replaces the
 * sweep with this declaration (see `src/main/services/process.ts`).
 */
function processFixture(reposRoot) {
  return {
    listen: [
      { pid: 48211, port: 5173, command: "node" },
      { pid: 48212, port: 3000, command: "next-server (v15.2.3)" },
      { pid: 48213, port: 8787, command: "workerd" },
      { pid: 48214, port: 4310, command: "python3.12" },
    ],
    ppid: { 48211: 48200, 48212: 48200, 48213: 48200, 48214: 48200 },
    cwd: {
      48211: path.join(reposRoot, "design", "lighthouse-ui"),
      48212: path.join(reposRoot, "web", "docs-site"),
      48213: path.join(reposRoot, "services", "mailroom"),
      48214: path.join(reposRoot, "labs", "weatherbot"),
    },
  };
}

/**
 * README bodies for three demo repos.
 *
 * The seeder writes `readme_content` as null, which the detail panel and the
 * repo page both draw as "No README detected" — a real state, but the wrong one
 * to hand a designer as the reference for the app's largest text surface. These
 * carry the markdown shapes the renderer has to style: headings, a list, a code
 * fence, a table, inline code and a link.
 */
const DEMO_READMES = {
  "lighthouse-ui": `# lighthouse-ui

The desktop surface for **AllTheRepos**: the catalog, the filter chips and the
detail rail, in one window.

## What it does

- Scans the folders you already keep code in, and nothing else
- Ranks repositories by the question you actually ask — *which repo was that?*
- Keeps the whole index in one SQLite file on your own disk

## Running it locally

\`\`\`bash
pnpm install
pnpm electron:dev
\`\`\`

## Layout

| Pane | Owns |
| --- | --- |
| Rail | Scan roots, folders, saved views |
| Grid | The repositories themselves |
| Detail | One repo, its tags, its links |

See \`design-system/alltherepos/MASTER.md\` for the token palette.
`,
  "ledger-core": `# ledger-core

Double-entry ledger with an append-only journal.

## Guarantees

1. Every entry balances to zero, or the write is refused
2. Nothing is ever mutated — corrections are new entries
3. The journal replays to the same balances, always

\`\`\`rust
let entry = Entry::balanced(debits, credits)?;
journal.append(entry)?;
\`\`\`

Built for a payments team that had been reconciling in a spreadsheet.
`,
  "voxel-engine": `# voxel-engine

Chunked voxel renderer: sparse octree storage, GPU-persistent buffers.

- 32³ chunks, streamed by distance
- One draw call per chunk, no per-voxel geometry
- Ships a debug view that paints the octree depth

## Status

Playable, not shipped. The upload path defers by one frame to hide the stall.
`,
};

/**
 * Write the README bodies into the seeded rows.
 *
 * The rows cannot be written from this (host Node) process: the native modules
 * are compiled against Electron's ABI, so the update borrows the app's own
 * runtime the same way the seeder does.
 */
function seedReadmes(electronBinary, dbPath, rows) {
  const payload = Object.entries(DEMO_READMES).flatMap(([name, content]) => {
    const row = rows.find((candidate) => candidate.name === name);
    if (!row) return [];
    return [
      {
        slug: row.slug,
        content,
        hash: crypto.createHash("sha256").update(content).digest("hex"),
      },
    ];
  });

  const script = `
    const Database = require("better-sqlite3");
    const db = new Database(process.env.ATR_SHOT_DB);
    const rows = JSON.parse(process.env.ATR_SHOT_READMES);
    const update = db.prepare(
      "UPDATE repos SET readme_content = ?, readme_hash = ? WHERE slug = ?"
    );
    for (const row of rows) update.run(row.content, row.hash, row.slug);
    db.close();
  `;

  const result = spawnSync(electronBinary, ["-e", script], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ATR_SHOT_DB: dbPath,
      ATR_SHOT_READMES: JSON.stringify(payload),
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `readme seed failed (${result.status})\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  log(`wrote ${payload.length} demo READMEs`);
}

/** The on-disk project hash Claude Code derives from an absolute path. */
const projectHash = (repoPath) => repoPath.replace(/[/.]/g, "-");

/**
 * Invented Claude Code history: a registry, session transcripts and a global
 * settings file, all inside a temp home.
 *
 * Tokens are spread over the last six weeks with gaps, so the heatmap has
 * texture and the "this week" card is not the same number as the total.
 */
function seedClaudeHome(home, reposRoot) {
  const projects = [
    { rel: "design/lighthouse-ui", sessions: 9, weight: 1 },
    { rel: "web/docs-site", sessions: 4, weight: 0.5 },
    { rel: "services/mailroom", sessions: 3, weight: 0.7 },
    { rel: "graphics/voxel-engine", sessions: 2, weight: 0.4 },
    { rel: "labs/orchestrator", sessions: 5, weight: 0.9 },
  ];

  const registry = { projects: {} };
  const now = Date.now();
  const day = 86_400_000;

  for (const project of projects) {
    const repoPath = path.join(reposRoot, project.rel);
    registry.projects[repoPath] = {
      allowedTools: ["Bash", "Read", "Edit", "Write"],
      mcpServers: {},
      context: {},
      ignorePatterns: [],
      history: [],
    };

    const hash = projectHash(repoPath);
    const dir = path.join(home, ".claude", "projects", hash);
    mkdirSync(dir, { recursive: true });

    for (let i = 0; i < project.sessions; i += 1) {
      // Spread sessions across the window, newest first, with a gap pattern so
      // no two projects share a shape.
      const daysAgo = (i * 5 + project.sessions) % 38;
      const start = now - daysAgo * day - i * 3_600_000;
      const turns = 3 + ((i + project.sessions) % 4);
      const lines = [];
      let cursor = start;

      lines.push(
        JSON.stringify({
          type: "user",
          sessionId: `${hash}-${i}`,
          timestamp: new Date(cursor).toISOString(),
          message: {
            role: "user",
            content: `Tighten the ${project.rel.split("/").pop()} detail panel — the metadata row reads as noise.`,
          },
        }),
      );

      for (let turn = 0; turn < turns; turn += 1) {
        cursor += 40_000;
        const scale = project.weight * (1 + (turn % 3) * 0.35);
        lines.push(
          JSON.stringify({
            type: "assistant",
            sessionId: `${hash}-${i}`,
            timestamp: new Date(cursor).toISOString(),
            message: {
              role: "assistant",
              model: "claude-sonnet-4-5",
              usage: {
                input_tokens: Math.round(1_400 * scale),
                output_tokens: Math.round(900 * scale),
                cache_creation_input_tokens: Math.round(2_100 * scale),
                cache_read_input_tokens: Math.round(28_000 * scale),
              },
              content: [{ type: "text", text: "Done." }],
            },
          }),
        );
      }

      fs.writeFileSync(
        path.join(dir, `${hash}-${i}.jsonl`),
        `${lines.join("\n")}\n`,
      );
    }
  }

  writeFileSync(
    path.join(home, ".claude.json"),
    `${JSON.stringify(registry, null, 2)}\n`,
  );
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  writeFileSync(
    path.join(home, ".claude", "settings.json"),
    `${JSON.stringify({ model: "claude-sonnet-4-5" }, null, 2)}\n`,
  );
}

// ---------------------------------------------------------------------------
// Capture helpers
// ---------------------------------------------------------------------------

/**
 * Screenshot at the window's own pixel size, not 2x Retina.
 *
 * The packet is read by a design tool and by people on non-Retina screens; CSS
 * pixels keep one screenshot one CSS pixel, which is what a spec sheet quotes.
 */
async function shot(page, relative, note) {
  const file = path.join(OUT_DIR, relative);
  mkdirSync(dirname(file), { recursive: true });
  try {
    await page.screenshot({ path: file, scale: "css" });
    record(file, "screen", note, "ok");
  } catch (error) {
    record(file, "screen", note, "failed", error.message);
  }
}

/**
 * Crop one element — never fatal.
 *
 * A crop is a convenience, and a redesign does not depend on any single one of
 * them; a locator that moved would otherwise abort a run that has already
 * captured thirty screens. Failures are recorded in the manifest instead.
 */
async function crop(page, relative, note, factory, { parent = false } = {}) {
  const file = path.join(OUT_DIR, relative);
  mkdirSync(dirname(file), { recursive: true });
  let locator;
  try {
    locator = factory(page).first();
    await locator.waitFor({ state: "visible", timeout: 10_000 });
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const target = parent ? locator.locator("xpath=..") : locator;
    try {
      await target.screenshot({ path: file, scale: "css" });
    } catch {
      await target.screenshot({ path: file });
    }
    record(file, "element", note, "ok");
  } catch (error) {
    record(file, "element", note, "skipped", error.message.split("\n")[0]);
  }
}

async function resize(app, size) {
  await app.evaluate(
    ({ BrowserWindow }, bounds) => {
      const windows = BrowserWindow.getAllWindows().filter(
        (win) => !win.isDestroyed() && win.isVisible(),
      );
      const main = windows[0] ?? BrowserWindow.getAllWindows()[0];
      main?.setContentSize(bounds.width, bounds.height);
    },
    size,
  );
  await pause(400);
}

/** Click a primary destination by its own title, then let the route settle. */
async function goTo(win, label, settle = 700) {
  await win.locator(`a[title="${label}"]`).first().click();
  await pause(settle);
}

/** Navigate by fragment, for routes the chrome does not link (`/debug`). */
async function goToHash(win, route, settle = 800) {
  await win.evaluate((hash) => {
    window.location.hash = `#${hash}`;
  }, route);
  await pause(settle);
}

async function waitForCatalog(win) {
  await win
    .locator("article[data-repo-slug], tr[data-repo-slug]")
    .first()
    .waitFor({ state: "visible", timeout: 45_000 });
}

async function openRepo(win, name) {
  await win
    .locator("article[data-repo-slug]")
    .filter({ hasText: name })
    .first()
    .click();
  await win
    .getByRole("complementary", { name: /repo detail/i })
    .waitFor({ state: "visible", timeout: 15_000 });
  await pause(700);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function launch(profileDir, extraEnv = {}) {
  const { _electron: electron } = await import("@playwright/test");
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      // Show the window without stealing focus, and let the capture read a
      // window the person at this machine never has to look at.
      ATR_E2E: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      ...extraEnv,
    },
  });
}

/**
 * Quit the app, and kill it if it will not go.
 *
 * `ElectronApplication.close()` waits for the process to exit and has no
 * timeout, and this app can decline to exit: the spotlight and tray popover are
 * hidden rather than closed (their `close` handler `preventDefault`s so a
 * re-summon is instant), so Playwright's request to close every window never
 * finishes and the capture would hang after its last screenshot — which is
 * exactly what the first run of this script did. Tearing those two down first
 * lets the app quit cleanly; the kill below is the backstop for anything that
 * still refuses, and `tests/e2e/_launch-app.ts` documents the same hazard.
 */
const CLOSE_GRACE_MS = 8_000;

async function closeApp(app) {
  const pid = app.process()?.pid;
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        const url = window.webContents.getURL();
        if (url.includes("window=spotlight") || url.includes("window=tray-popover")) {
          window.destroy();
        }
      }
    })
    .catch(() => {});

  const closed = app
    .close()
    .then(() => true)
    .catch(() => false);
  const finished = await Promise.race([
    closed,
    pause(CLOSE_GRACE_MS).then(() => false),
  ]);
  if (!finished && pid) {
    log(`app ${pid} did not quit within ${CLOSE_GRACE_MS}ms — killing it`);
    spawnSync("pkill", ["-9", "-P", String(pid)]);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
    await pause(500);
  }
}

/** The wide pass: catalog, routes, dialogs, narrow widths, satellite windows. */
async function captureMainSurface(app, win, rows) {
  await resize(app, WIDE);
  await waitForCatalog(win);

  // ---- Catalog, nothing selected -----------------------------------------
  await shot(
    win,
    "screens/01-catalog-grid.png",
    "Catalog, grid view, no repo selected — rail, toolbar, card grid, empty detail column.",
  );
  await crop(win, "elements/top-bar.png", "Top bar: menu, wordmark, search, nav, Debug.", (w) =>
    w.locator("header"),
  );
  await crop(
    win,
    "elements/nav.png",
    "Primary navigation, including the running-processes badge.",
    (w) => w.locator("header nav").first(),
  );
  await crop(
    win,
    "elements/search-bar.png",
    "Repo search field with its keyboard hint.",
    (w) => w.getByRole("searchbox", { name: "Search repos" }),
    { parent: true },
  );
  await crop(
    win,
    "elements/catalog-toolbar.png",
    "Catalog toolbar: view-mode switch, group, sort, filter actions.",
    (w) => w.getByRole("group", { name: "View mode" }),
    { parent: true },
  );
  await crop(
    win,
    "elements/view-mode-switch.png",
    "The three-way view-mode control on its own.",
    (w) => w.getByRole("group", { name: "View mode" }),
  );
  await crop(
    win,
    "elements/folder-rail.png",
    "Folder rail: scan roots, folder tree, count and selection marks.",
    (w) => w.locator("#catalog-sidebar"),
  );
  await crop(win, "elements/repo-card.png", "One repo card in the grid.", (w) =>
    w.locator("article[data-repo-slug]").first(),
  );
  await crop(
    win,
    "elements/repo-card-dirty.png",
    "The card the demo library marks dirty and local-only.",
    (w) => w.locator("article[data-repo-slug]").filter({ hasText: "mailroom" }),
  );

  // ---- Catalog, one repo selected ----------------------------------------
  await openRepo(win, "lighthouse-ui");
  await shot(
    win,
    "screens/02-catalog-detail-open.png",
    "Catalog with a repo selected — the detail panel at its full width.",
  );
  await crop(win, "elements/detail-panel.png", "The repo detail panel, top to bottom.", (w) =>
    w.getByRole("complementary", { name: /repo detail/i }),
  );
  await crop(
    win,
    "elements/detail-tabs.png",
    "Detail panel tabs: details, notes, Claude.",
    (w) => w.getByRole("tablist", { name: /repo detail tabs/i }),
    { parent: true },
  );

  // ---- The other two view modes ------------------------------------------
  await win.getByRole("button", { name: "Gallery" }).first().click();
  await pause(900);
  await shot(
    win,
    "screens/03-catalog-gallery.png",
    "Catalog, gallery view — large covers, one row of readable cards.",
  );

  await win.getByRole("button", { name: "Table" }).first().click();
  await pause(900);
  await shot(
    win,
    "screens/04-catalog-table.png",
    "Catalog, table view — one line per repo, used for auditing.",
  );
  await crop(win, "elements/repo-table.png", "The table's header and rows.", (w) =>
    w.locator("table").first(),
  );

  await win.getByRole("button", { name: "Grid" }).first().click();
  await pause(700);

  // ---- Command palette ----------------------------------------------------
  await win.keyboard.press("Meta+k");
  const palette = win.getByRole("dialog", { name: /command palette/i });
  await palette.waitFor({ state: "visible", timeout: 10_000 });
  await pause(500);
  await shot(
    win,
    "screens/05-command-palette.png",
    "Command palette at rest — grouped commands, keyboard hints.",
  );
  await crop(win, "elements/command-palette.png", "The palette dialog on its own.", () => palette);

  await win.keyboard.type("graph");
  await pause(600);
  await shot(
    win,
    "screens/06-command-palette-filtered.png",
    "Command palette narrowed by a query.",
  );
  await win.keyboard.press("Escape");
  await pause(400);

  // ---- Search ------------------------------------------------------------
  const search = win.getByRole("searchbox", { name: "Search repos" });
  await search.fill("ledger");
  await pause(1100);
  await shot(
    win,
    "screens/07-catalog-search.png",
    "Search results across the library, with the active filter named.",
  );
  await search.fill("");
  await pause(800);

  // ---- Settings ----------------------------------------------------------
  await goTo(win, "Settings", 1200);
  await shot(
    win,
    "screens/08-settings.png",
    "Settings — scan paths, embeddings, updates, identities, scan now.",
  );
  for (const [heading, file, note] of [
    ["Scan paths", "settings-scan-paths.png", "Settings: scan paths card."],
    ["Embeddings", "settings-embeddings.png", "Settings: embeddings card, with its hardware note."],
    ["Updates", "settings-updates.png", "Settings: update check and the release channel."],
    ["Your identities", "settings-identities.png", "Settings: identity list — ownership marks come from here."],
    ["Scan now", "settings-scan-now.png", "Settings: the manual scan card and its progress state."],
  ]) {
    await crop(win, `elements/${file}`, note, (w) =>
      w.getByRole("heading", { name: heading }).locator("xpath=ancestor::section[1]"),
    );
  }

  // ---- Processes ---------------------------------------------------------
  await goTo(win, "Running", 1200);
  await shot(
    win,
    "screens/09-processes.png",
    "Running — every listening dev server, bound to the repo that owns its cwd.",
  );
  await crop(win, "elements/process-table.png", "The process table and its port chips.", (w) =>
    w.locator("table").first(),
  );

  // ---- Graph -------------------------------------------------------------
  await goTo(win, "Map", 1800);
  await shot(
    win,
    "screens/10-graph.png",
    "Map — the relationship graph beside the cluster list.",
  );
  await crop(
    win,
    "elements/graph-clusters.png",
    "The cluster list: ranked by how scattered a cluster is.",
    (w) => w.getByRole("listbox").first(),
  );
  await crop(
    win,
    "elements/graph-signals.png",
    "The signal filter — which relationships the map draws.",
    (w) => w.getByRole("group", { name: /relationship signals/i }),
    { parent: true },
  );

  // ---- Full-page repo detail --------------------------------------------
  await goTo(win, "Repos", 900);
  await waitForCatalog(win);
  await openRepo(win, "lighthouse-ui");
  await win.getByRole("link", { name: /open full detail page/i }).first().click();
  await pause(1200);
  await shot(
    win,
    "screens/11-repo-page-details.png",
    "Repo page — the full-width detail view, details tab.",
  );

  await win.getByRole("tab", { name: /notes/i }).click();
  await pause(700);
  await shot(win, "screens/12-repo-page-notes.png", "Repo page — notes tab.");

  // ---- Debug -------------------------------------------------------------
  await goToHash(win, "/debug", 1200);
  await shot(
    win,
    "screens/13-debug.png",
    "Debug — the bridge round-trip, reachable only from a development build.",
  );

  // ---- Dialogs -----------------------------------------------------------
  await goTo(win, "Repos", 1000);
  await waitForCatalog(win);

  await win.getByRole("button", { name: "New group" }).first().click();
  await pause(700);
  await shot(win, "screens/14-dialog-new-group.png", "New group dialog over the catalog.");
  await crop(win, "elements/dialog-new-group.png", "The new-group dialog.", (w) =>
    w.getByRole("dialog"),
  );
  await win.keyboard.press("Escape");
  await pause(500);

  await openRepo(win, "lighthouse-ui");
  await win
    .getByRole("button", { name: /assert a relationship/i })
    .first()
    .click();
  await pause(800);
  await shot(
    win,
    "screens/15-dialog-curate-link.png",
    "Curate-link dialog — assert that two repos belong together.",
  );
  await crop(win, "elements/dialog-curate-link.png", "The curate-link dialog.", (w) =>
    w.getByRole("dialog"),
  );
  await win.keyboard.press("Escape");
  await pause(500);

  await win.getByRole("button", { name: "Tag cleanup" }).first().click();
  await pause(900);
  await shot(
    win,
    "screens/16-dialog-tag-cleanup.png",
    "Tag cleanup — review a bulk tag rewrite before it is applied.",
  );
  await crop(win, "elements/dialog-tag-cleanup.png", "The tag-cleanup dialog.", (w) =>
    w.getByRole("dialog"),
  );
  await win.keyboard.press("Escape");
  await pause(500);

  // ---- Narrow widths -----------------------------------------------------
  await resize(app, NARROW);
  await openRepo(win, "lighthouse-ui");
  await shot(
    win,
    "screens/17-catalog-1280x800.png",
    "Catalog at 1280x800 — the layout contract's own height.",
  );
  await win.getByRole("button", { name: "Table" }).first().click();
  await pause(900);
  await shot(win, "screens/18-catalog-table-1280x800.png", "Table view at 1280x800.");
  await win.getByRole("button", { name: "Grid" }).first().click();
  await pause(600);

  await goTo(win, "Settings", 1000);
  await shot(win, "screens/19-settings-1280x800.png", "Settings at 1280x800.");

  await resize(app, MINIMUM);
  await goTo(win, "Repos", 1000);
  await waitForCatalog(win);
  await openRepo(win, "lighthouse-ui");
  await shot(
    win,
    "screens/20-catalog-1024x768.png",
    "Catalog at 1024x768 — nav labels collapse, toolbar starts to wrap.",
  );

  await goToHash(win, "/repos/" + rows.find((row) => row.name === "lighthouse-ui").slug, 1400);
  await shot(
    win,
    "screens/21-repo-page-1024x768.png",
    "Repo page at 1024x768.",
  );

  // ---- Satellite windows -------------------------------------------------
  await resize(app, WIDE);
  await goTo(win, "Repos", 900);

  const spotlightPage = app.waitForEvent("window");
  await win.evaluate(() => window.atr?.app?.showSpotlight?.());
  try {
    const page = await spotlightPage;
    await page.waitForLoadState("domcontentloaded");
    await pause(1800);
    await shot(
      page,
      "windows/spotlight.png",
      "Spotlight — the global quick-open panel, its own frameless window.",
    );
  } catch (error) {
    record(
      path.join(OUT_DIR, "windows/spotlight.png"),
      "window",
      "Spotlight window",
      "skipped",
      error.message.split("\n")[0],
    );
  }
  await win.evaluate(() => window.atr?.app?.hideSpotlight?.()).catch(() => {});

  const trayPage = app.waitForEvent("window");
  const opened = await app.evaluate(() => {
    const open = globalThis.__atrE2EOpenTrayPopover;
    if (typeof open === "function") {
      open();
      return true;
    }
    return false;
  });
  if (!opened) {
    record(
      path.join(OUT_DIR, "windows/tray-popover.png"),
      "window",
      "Tray popover",
      "skipped",
      "no __atrE2EOpenTrayPopover hook in this build",
    );
  } else {
    try {
      const page = await trayPage;
      await page.waitForLoadState("domcontentloaded");
      await pause(1800);
      await shot(
        page,
        "windows/tray-popover.png",
        "Menu-bar popover — the tray's own compact surface.",
      );
    } catch (error) {
      record(
        path.join(OUT_DIR, "windows/tray-popover.png"),
        "window",
        "Tray popover",
        "skipped",
        error.message.split("\n")[0],
      );
    }
  }
}

/** The Claude pass: a temp home, so no real project path reaches a picture. */
async function captureClaudeSurface(app, win, rows) {
  await resize(app, WIDE);
  // The window comes back on the route it was left on (`window-route-restore`),
  // so a second launch on one profile does not start at the catalog.
  await goToHash(win, "/", 900);
  await waitForCatalog(win);

  await goTo(win, "Claude", 2200);
  await shot(
    win,
    "screens/22-claude-usage.png",
    "Claude — stat cards, the usage heatmap and the per-project table. Data invented.",
  );
  await crop(
    win,
    "elements/claude-heatmap.png",
    "The usage heatmap, captioned by week.",
    (w) => w.getByRole("img", { name: /heatmap of claude usage/i }).locator("xpath=.."),
  );
  await crop(
    win,
    "elements/claude-range.png",
    "The date-range control (7d / 30d / 90d / all).",
    (w) => w.getByRole("radiogroup", { name: /date range/i }),
  );

  await goToHash(win, "/repos/" + rows.find((row) => row.name === "lighthouse-ui").slug, 1600);
  await win.getByRole("tab", { name: /claude/i }).click();
  await pause(1600);
  await shot(
    win,
    "screens/23-repo-page-claude.png",
    "Repo page, Claude tab — sessions, skills, agents and MCP servers for one repo.",
  );
  await crop(win, "elements/claude-tab.png", "The Claude tab's own cards and tables.", (w) =>
    w.getByRole("tabpanel").or(w.locator("main")),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(MAIN_ENTRY)) {
    console.error(
      `[design-shots] no bundle at ${MAIN_ENTRY} — run \`pnpm electron:build\` first.`,
    );
    process.exit(2);
  }

  const electronBinary = require("electron");

  // The native modules must match Electron's ABI, and the failure is
  // unrecognisable otherwise: the app dies loading better-sqlite3, Playwright
  // reports a closed page, and nothing mentions an ABI.
  const probe = spawnSync(
    electronBinary,
    ["-e", 'const D = require("better-sqlite3"); new D(":memory:").close();'],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    },
  );
  if (probe.status !== 0) {
    console.error(
      "[design-shots] the native modules are not built for Electron's ABI. Run:\n" +
        "[design-shots]   node scripts/ensure-native-abi.mjs electron",
    );
    process.exit(2);
  }

  const reposRoot = resolve(flag("--root", path.join(homedir(), "Code")));
  if (fs.existsSync(reposRoot)) {
    console.error(
      `[design-shots] ${reposRoot} already exists — refusing to write the demo library there.\n` +
        "[design-shots] move it aside, or pass --root <path to an empty directory>.",
    );
    process.exit(2);
  }

  const scratch = mkdtempSync(path.join(tmpdir(), "atr-design-shots-"));
  const profileDir = path.join(scratch, "profile");
  const fakeHome = path.join(scratch, "home");
  const rows = demoRows(reposRoot);
  const dbPath = path.join(profileDir, "alltherepos.db");
  const fixturePath = path.join(scratch, "processes.json");

  try {
    // ---- The demo library ------------------------------------------------
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(fakeHome, { recursive: true });

    for (const row of rows) {
      const isLighthouse = row.name === "lighthouse-ui";
      initRepo(row.fullPath, {
        dirty: Boolean(row.isDirty),
        files: isLighthouse ? claudeFixtures() : undefined,
      });
    }

    writeFileSync(fixturePath, `${JSON.stringify(processFixture(reposRoot), null, 2)}\n`);

    // Claim the one-shot legacy migration before the first boot, so the app
    // does NOT copy the developer's real catalog into this profile.
    writeFileSync(path.join(profileDir, "MIGRATED"), new Date().toISOString());
    writeFileSync(
      path.join(profileDir, "settings.json"),
      `${JSON.stringify(
        {
          scanPaths: [reposRoot],
          ollamaBaseUrl: "http://localhost:11434",
          ollamaEmbedModel: "nomic-embed-text",
          openaiEmbedModel: null,
          defaultEditor: "vscode",
          identities: ["ivy00johns"],
          schemaVersion: 1,
          // Load-bearing: without it the app treats the file as un-migrated and
          // overwrites it with the freshly seeded defaults, which point at this
          // machine's real library.
          __legacyPromoted: true,
        },
        null,
        2,
      )}\n`,
    );

    mkdirSync(OUT_DIR, { recursive: true });

    // ---- Boot once so the app creates and migrates the database ----------
    log("bootstrap boot (creates and migrates the database)");
    const bootstrap = await launch(profileDir);
    try {
      const win = await bootstrap.firstWindow();
      await win.waitForLoadState("domcontentloaded");
    } finally {
      await closeApp(bootstrap);
    }

    // ---- Seed the demo rows ----------------------------------------------
    const rowsPath = path.join(scratch, "rows.json");
    writeFileSync(rowsPath, JSON.stringify(rows));
    const seeded = spawnSync(
      electronBinary,
      [SEED_SCRIPT, "--seed", dbPath, rowsPath],
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
    log((seeded.stdout ?? "").trim());
    seedReadmes(electronBinary, dbPath, rows);

    // ---- The wide pass ---------------------------------------------------
    const app = await launch(profileDir, { ATR_PROCESS_FIXTURE: fixturePath });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForCatalog(win);

      // Prove the shots show the demo library and nothing else: a single row
      // from the developer's own catalog would be a private repo name, remote
      // and folder layout leaving the machine inside a design deck.
      const shown = await win.$$eval("[data-repo-slug]", (nodes) =>
        nodes.map((node) => node.getAttribute("data-repo-slug")),
      );
      const allowed = new Set(rows.map((row) => row.slug));
      const strays = shown.filter((slug) => !allowed.has(slug));
      if (strays.length > 0) {
        throw new Error(
          `refusing to write the packet: the catalog shows ${strays.length} repo(s) outside the demo library — ${strays.slice(0, 5).join(", ")}`,
        );
      }
      log(`catalog shows ${shown.length} demo repos, no strays`);

      await captureMainSurface(app, win, rows);
    } finally {
      await closeApp(app);
    }
    log("the wide pass is on disk");

    // ---- The Claude pass, in its own invented home -----------------------
    seedClaudeHome(fakeHome, reposRoot);
    const claudeApp = await launch(profileDir, {
      HOME: fakeHome,
      ATR_PROCESS_FIXTURE: fixturePath,
    });
    try {
      const win = await claudeApp.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await captureClaudeSurface(claudeApp, win, rows);
    } finally {
      await closeApp(claudeApp);
    }

    writeFileSync(
      path.join(OUT_DIR, "manifest.json"),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          app: "AllTheRepos",
          data: "synthetic demo library (scripts/make-design-shots.mjs)",
          viewports: [WIDE, NARROW, MINIMUM],
          shots: manifest,
        },
        null,
        2,
      )}\n`,
    );

    const ok = manifest.filter((entry) => entry.status === "ok").length;
    const skipped = manifest.filter((entry) => entry.status !== "ok");
    log(`${ok} images written to ${path.relative(REPO_ROOT, OUT_DIR)}, ${skipped.length} skipped`);
    for (const entry of skipped) {
      log(`  ${entry.status}: ${entry.file} — ${entry.error}`);
    }
  } finally {
    if (KEEP) {
      log(`kept the scratch profile at ${scratch}`);
    } else {
      rmSync(scratch, { recursive: true, force: true });
      // The demo library, and only the demo library: this path was verified
      // absent before anything was written to it.
      rmSync(reposRoot, { recursive: true, force: true });
      log(`removed the demo library from ${reposRoot}`);
    }
  }
}

await main();
