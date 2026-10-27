#!/usr/bin/env node
// Capture one still per beat of the demo film from the real Electron app.
//
// Same method as scripts/make-readme-shots.mjs: a throwaway --user-data-dir, the
// demo library seeded into its database, and nothing outside that directory
// touched. The demo library lives under ~/Code while it runs and is removed
// afterwards; this refuses to run if ~/Code already exists.
//
// Usage (from the repo root, after `pnpm electron:build`):
//   node demo/tools/capture-stills.mjs
// Output: demo/assets/stills/NN-<beat>.png at 1440x900 (the frame box's 16:10).

import { spawnSync } from "node:child_process";
import fs, { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const README_SCRIPT = path.join(REPO_ROOT, "scripts", "make-readme-shots.mjs");
const MAIN_ENTRY = path.join(REPO_ROOT, "out", "main", "index.js");
const OUT_DIR = path.join(HERE, "..", "assets", "stills");
const WIDTH = 1440;
const HEIGHT = 900;
// Same identity the README capture uses, so the demo library reads as "mine".
const DEMO_IDENTITY = "ivy00johns";

const { _electron: electron } = await import("@playwright/test");
const electronBinary = require("electron");
// Importing the README script runs nothing: its main is behind an isMainModule guard.
const { demoRows } = await import(pathToFileURL(README_SCRIPT).href);

function initRepo(dir, dirty) {
  mkdirSync(dir, { recursive: true });
  const git = (args) => spawnSync("git", args, { cwd: dir });
  git(["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(dir, "README.md"), `# ${path.basename(dir)}\n`);
  git(["add", "-A"]);
  git([
    "-c", "user.email=demo@example.com",
    "-c", "user.name=Demo",
    "commit", "-q", "-m", "Initial commit",
  ]);
  if (dirty) {
    fs.writeFileSync(path.join(dir, "work-in-progress.txt"), "scratch\n");
  }
}

function launch(profileDir) {
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profileDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ATR_E2E: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });
}

// Runs under Electron's Node, so better-sqlite3 matches the app's ABI.
const LINK_SCRIPT = `
const D = require("better-sqlite3");
const db = new D(process.env.ATR_DB);
const id = (name) => db.prepare("select id from repos where name = ?").get(name).id;
const ins = db.prepare("insert or ignore into repo_links (from_repo_id, to_repo_id, kind, why, source) values (?, ?, ?, ?, 'user')");
for (const [from, to, kind, why] of JSON.parse(process.env.ATR_LINKS)) ins.run(id(from), id(to), kind, why);
const count = db.prepare("select count(*) as n from repo_links").get().n;
db.close();
console.log("[stills] curated links: " + count);
`;

async function still(win, name) {
  const file = path.join(OUT_DIR, name);
  await win.screenshot({ path: file, scale: "css" });
  console.log(`[stills] ${path.relative(REPO_ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

async function main() {
  if (!fs.existsSync(MAIN_ENTRY)) {
    throw new Error(`no bundle at ${MAIN_ENTRY} — run \`pnpm electron:build\` first.`);
  }
  const reposRoot = path.join(homedir(), "Code");
  if (fs.existsSync(reposRoot)) {
    throw new Error(`${reposRoot} already exists — refusing to write the demo library there.`);
  }

  const root = mkdtempSync(path.join(tmpdir(), "atr-demo-stills-"));
  const profileDir = path.join(root, "profile");
  const rows = demoRows(reposRoot);
  const dbPath = path.join(profileDir, "alltherepos.db");
  mkdirSync(profileDir, { recursive: true });

  try {
    // Repos on disk for the detail rail's branch and dirty reads.
    for (const row of rows) {
      initRepo(row.fullPath, row.isDirty === 1);
    }
    // Claim the legacy migration so the developer's real database is not copied in.
    fs.writeFileSync(path.join(profileDir, "MIGRATED"), new Date().toISOString());
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

    // Boot once so the app creates the database, then seed it.
    const bootstrap = await launch(profileDir);
    try {
      const win = await bootstrap.firstWindow();
      await win.waitForLoadState("domcontentloaded");
    } finally {
      await bootstrap.close();
    }
    const rowsPath = path.join(root, "rows.json");
    fs.writeFileSync(rowsPath, JSON.stringify(rows));
    const seeded = spawnSync(electronBinary, [README_SCRIPT, "--seed", dbPath, rowsPath], {
      cwd: REPO_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    });
    if (seeded.status !== 0) {
      throw new Error(`seed failed (${seeded.status})\n${seeded.stdout ?? ""}\n${seeded.stderr ?? ""}`);
    }

    // Curated links, so the map has edges to draw. These are person-asserted links,
    // written the way the app stores them (source "user"), between demo repos only.
    const links = [
      ["edge-proxy", "mailroom", "depends-on", "Routes traffic for the mail tenant"],
      ["terraform-live", "edge-proxy", "depends-on", "Provisions the proxy fleet"],
      ["pixel-forge", "voxel-engine", "related", "Shared sprite and voxel pipeline"],
      ["docs-site", "lighthouse-ui", "related", "Documents the design system"],
    ];
    const linked = spawnSync(electronBinary, ["-e", LINK_SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ATR_DB: dbPath, ATR_LINKS: JSON.stringify(links) },
      encoding: "utf8",
    });
    if (linked.status !== 0) {
      throw new Error(`curating links failed (${linked.status})\n${linked.stdout ?? ""}\n${linked.stderr ?? ""}`);
    }
    console.log(linked.stdout.trim());

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

      const cards = win.locator("article[data-repo-slug], tr[data-repo-slug]");
      await cards.first().waitFor({ state: "visible", timeout: 30_000 });

      // Refuse to publish stills with a real repo in them.
      const shown = await win.$$eval("[data-repo-slug]", (nodes) =>
        nodes.map((node) => node.getAttribute("data-repo-slug")),
      );
      const allowed = new Set(rows.map((row) => row.slug));
      const strays = shown.filter((slug) => !allowed.has(slug));
      if (strays.length > 0) {
        throw new Error(`stills would show ${strays.length} repo(s) outside the demo library: ${strays.slice(0, 5).join(", ")}`);
      }

      // Beat 2 and beat 3 (catalog overview, and the scan filling the grid).
      await win.waitForTimeout(600);
      await still(win, "02-catalog.png");

      // Beat 4: search. A query that matches a real slice of the library.
      await win.getByPlaceholder(/search repos/i).fill("terraform");
      // The grid shows skeleton cards until the search IPC answers; wait for the match.
      await cards.filter({ hasText: "terraform-live" }).first().waitFor({ state: "visible", timeout: 15_000 });
      await win.waitForTimeout(600);
      await still(win, "04-search.png");
      await win.getByPlaceholder(/search repos/i).fill("");
      await win.waitForTimeout(400);

      // Beat 5: triage, in table view so the status columns read.
      await win.getByRole("button", { name: /^table$/i }).first().click();
      await win.waitForTimeout(700);
      await still(win, "05-triage.png");
      await win.getByRole("button", { name: /^posters$/i }).first().click();
      await win.waitForTimeout(400);

      // Beat 6: one repo's detail rail, with its tags and notes.
      await cards.filter({ hasText: "lighthouse-ui" }).first().click();
      await win
        .getByRole("complementary", { name: /repo detail/i })
        .waitFor({ state: "visible", timeout: 15_000 });
      await win.waitForTimeout(600);
      await still(win, "06-vocabulary.png");

      // Beat 10: the command palette, unfiltered.
      await win.keyboard.press("Meta+k");
      await win
        .getByRole("dialog", { name: /command palette/i })
        .waitFor({ state: "visible", timeout: 10_000 });
      await win.waitForTimeout(500);
      await still(win, "10-palette.png");
      await win.keyboard.press("Escape");
      await win.waitForTimeout(300);

      // Beat 7: the map.
      await win.getByRole("link", { name: /^map$/i }).first().click();
      // The force layout settles over several seconds; a still taken early has overlapping labels.
      await win.waitForTimeout(6000);
      await still(win, "07-graph.png");

      // Beat 9: settings.
      await win.getByRole("link", { name: /^settings$/i }).first().click();
      await win.getByRole("heading", { name: /settings/i }).first().waitFor({ state: "visible", timeout: 15_000 });
      await win.waitForTimeout(600);
      await still(win, "09-local-first.png");
    } finally {
      await app.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(reposRoot, { recursive: true, force: true });
    console.log(`[stills] removed the demo library from ${reposRoot}`);
  }
}

await main();
