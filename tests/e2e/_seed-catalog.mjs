#!/usr/bin/env node
/**
 * Seed catalog rows into an already-migrated Electron E2E database.
 *
 * Why a separate process, and why under Electron's Node: `pnpm
 * test:electron-e2e` leaves the natives (better-sqlite3) built for Electron's
 * ABI so the app can load them, which means the Playwright worker — host Node
 * — cannot load that module at all. `ELECTRON_RUN_AS_NODE=1` borrows the
 * app's own runtime, so the writer and the app agree on
 * NODE_MODULE_VERSION (135 for Electron 36) without a second rebuild.
 *
 * The row shape mirrors `tests/helpers/seed.ts`, the unit-test seeder, and
 * the slug rule mirrors its `makeSlug` there, because the catalog keys
 * selection on slugs.
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 <electron-binary> tests/e2e/_seed-catalog.mjs \
 *     <dbPath> <name> <fullPath> [<name> <fullPath> ...]
 *
 * Exit codes: 0 — rows written · 2 — bad arguments · anything else — the
 * underlying SQLite error, so a caller can surface it verbatim.
 */

import crypto from "node:crypto";
import Database from "better-sqlite3";

const [dbPath, ...repos] = process.argv.slice(2);

if (!dbPath || repos.length === 0 || repos.length % 2 !== 0) {
  console.error(
    "usage: _seed-catalog.mjs <dbPath> <name> <fullPath> [<name> <fullPath> ...]",
  );
  process.exit(2);
}

const kebab = (value) =>
  value
    .replace(/[A-Z]+/g, (m) => `-${m.toLowerCase()}`)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const shortHash = (value) =>
  crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);

const makeSlug = (name, fullPath) => `${kebab(name)}-${shortHash(fullPath)}`;

const sqlite = new Database(dbPath);

try {
  const insert = sqlite.prepare(`
    INSERT INTO repos (
      slug, name, full_path, remote_url, default_branch, current_branch,
      last_commit_hash, last_commit_date, last_commit_msg, is_dirty,
      primary_language, languages_json, tags_json, description,
      readme_content, readme_hash, size_bytes, last_scanned_at, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = sqlite.transaction(() => {
    for (let i = 0; i < repos.length; i += 2) {
      const name = repos[i];
      const fullPath = repos[i + 1];
      insert.run(
        makeSlug(name, fullPath),
        name,
        fullPath,
        null,
        null,
        null,
        null,
        null,
        null,
        0,
        null,
        "[]",
        "[]",
        `Seeded by the Electron E2E suite: ${name}`,
        null,
        null,
        null,
        new Date().toISOString(),
        "filesystem_scan",
      );
    }
  });

  seed();
  console.log(
    `[seed-catalog] wrote ${repos.length / 2} repos into ${dbPath}`,
  );
} finally {
  sqlite.close();
}
