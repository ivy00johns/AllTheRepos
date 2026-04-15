import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Minimal DB seeder for Playwright tests. Writes directly to the SQLite file
 * under ATR_DATA_DIR so the running Next.js dev server picks it up on the next
 * request.
 */

function kebab(s: string): string {
  return s
    .replace(/[A-Z]+/g, (m) => `-${m.toLowerCase()}`)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function shortHash(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);
}

export interface SeedRepo {
  name: string;
  fullPath: string;
  primaryLanguage?: string | null;
  description?: string | null;
  tags?: string[];
  isDirty?: boolean;
}

export function dataDir(): string {
  return process.env.ATR_DATA_DIR || path.join(os.homedir(), ".alltherepos");
}

export function dbPath(): string {
  return path.join(dataDir(), "alltherepos.db");
}

export function resetDb(): void {
  const dir = dataDir();
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

const CONTRACT_SQL = [
  `CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    full_path TEXT NOT NULL UNIQUE,
    remote_url TEXT,
    default_branch TEXT,
    current_branch TEXT,
    last_commit_hash TEXT,
    last_commit_date TEXT,
    last_commit_msg TEXT,
    is_dirty INTEGER NOT NULL DEFAULT 0,
    primary_language TEXT,
    languages_json TEXT NOT NULL DEFAULT '[]',
    tags_json TEXT NOT NULL DEFAULT '[]',
    description TEXT,
    readme_content TEXT,
    readme_hash TEXT,
    size_bytes INTEGER,
    last_scanned_at TEXT,
    last_opened_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT NOT NULL DEFAULT 'filesystem_scan'
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS repos_fts USING fts5(
    slug UNINDEXED, name, description, readme_content, tags_text,
    tokenize = 'porter unicode61'
  )`,
  `CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    is_smart INTEGER NOT NULL DEFAULT 0,
    smart_filter_json TEXT,
    parent_group_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS repo_groups (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (repo_id, group_id)
  )`,
  `CREATE TABLE IF NOT EXISTS scan_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_scanned_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data_json TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
].join(";\n") + ";";

export function ensureSchemaAndSeed(repos: SeedRepo[]): string[] {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const sqlite = new Database(dbPath());
  sqlite.pragma("journal_mode = WAL");
  // better-sqlite3 exposes `.exec()` to run multiple statements at once.
  sqlite.exec(CONTRACT_SQL);
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO settings (id, data_json, schema_version) VALUES (1, ?, 1)",
    )
    .run(
      JSON.stringify({
        scanPaths: [],
        ollamaBaseUrl: "http://localhost:11434",
        ollamaEmbedModel: "nomic-embed-text",
        openaiEmbedModel: null,
        defaultEditor: "vscode",
        schemaVersion: 1,
      }),
    );

  const slugs: string[] = [];
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO repos (
       slug, name, full_path, primary_language, description, tags_json,
       is_dirty, source
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'filesystem_scan')`,
  );
  for (const r of repos) {
    const slug = `${kebab(r.name)}-${shortHash(r.fullPath)}`;
    slugs.push(slug);
    insert.run(
      slug,
      r.name,
      r.fullPath,
      r.primaryLanguage ?? null,
      r.description ?? null,
      JSON.stringify(
        (r.tags ?? []).map((value) => ({ value, source: "heuristic" })),
      ),
      r.isDirty ? 1 : 0,
    );
  }
  sqlite.close();
  return slugs;
}
