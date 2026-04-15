import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { makeTmpDir } from "./tmp-dir.js";

/**
 * SQL conforming to contracts/schema.md v1. Used by test helpers so the test
 * suite has a known-good starting DB shape even before backend migrations land.
 */
export const CONTRACT_SQL = `
CREATE TABLE IF NOT EXISTS repos (
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
);

CREATE INDEX IF NOT EXISTS repos_primary_language_idx ON repos(primary_language);
CREATE INDEX IF NOT EXISTS repos_last_commit_date_idx ON repos(last_commit_date DESC);
CREATE INDEX IF NOT EXISTS repos_last_scanned_at_idx ON repos(last_scanned_at DESC);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  is_smart INTEGER NOT NULL DEFAULT 0,
  smart_filter_json TEXT,
  parent_group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS groups_parent_group_id_idx ON groups(parent_group_id);

CREATE TABLE IF NOT EXISTS repo_groups (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (repo_id, group_id)
);

CREATE INDEX IF NOT EXISTS repo_groups_group_id_idx ON repo_groups(group_id);

CREATE TABLE IF NOT EXISTS scan_paths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS repos_fts USING fts5(
  slug UNINDEXED,
  name,
  description,
  readme_content,
  tags_text,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS repos_fts_insert AFTER INSERT ON repos BEGIN
  INSERT INTO repos_fts(slug, name, description, readme_content, tags_text)
  VALUES (NEW.slug, NEW.name, COALESCE(NEW.description,''), COALESCE(NEW.readme_content,''), '');
END;

CREATE TRIGGER IF NOT EXISTS repos_fts_update AFTER UPDATE ON repos BEGIN
  UPDATE repos_fts SET
    name = NEW.name,
    description = COALESCE(NEW.description,''),
    readme_content = COALESCE(NEW.readme_content,''),
    tags_text = NEW.tags_json
  WHERE slug = NEW.slug;
END;

CREATE TRIGGER IF NOT EXISTS repos_fts_delete AFTER DELETE ON repos BEGIN
  DELETE FROM repos_fts WHERE slug = OLD.slug;
END;
`;

const DEFAULT_SETTINGS_JSON = JSON.stringify({
  scanPaths: [],
  ollamaBaseUrl: "http://localhost:11434",
  ollamaEmbedModel: "nomic-embed-text",
  openaiEmbedModel: null,
  defaultEditor: "vscode",
  schemaVersion: 1,
});

export interface TestDbHandle {
  dir: string;
  dbPath: string;
  sqlite: Database.Database;
  close(): void;
}

/**
 * Create an isolated SQLite DB in a tmp dir with the full v1 schema applied
 * and a seeded settings row.
 */
export function createTestDb(): TestDbHandle {
  const dir = makeTmpDir("atr-testdb");
  const dbPath = path.join(dir, "alltherepos.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CONTRACT_SQL);
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO settings (id, data_json, schema_version) VALUES (1, ?, 1)",
    )
    .run(DEFAULT_SETTINGS_JSON);
  return {
    dir,
    dbPath,
    sqlite,
    close() {
      try {
        sqlite.close();
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Point ATR_DATA_DIR at a fresh tmp dir so lib/db/client.ts writes there.
 *
 * When `seedSchema` is true (default), the contract schema is applied to a
 * pre-existing SQLite file before lib/db/client.ts opens it. This keeps tests
 * independent of whether backend has generated drizzle migration files yet.
 */
export function isolateDataDir(
  opts: { seedSchema?: boolean } = {},
): { dir: string; cleanup(): void } {
  const dir = makeTmpDir("atr-datadir");
  const prev = process.env.ATR_DATA_DIR;
  process.env.ATR_DATA_DIR = dir;

  if (opts.seedSchema !== false) {
    const dbPath = path.join(dir, "alltherepos.db");
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(CONTRACT_SQL);
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO settings (id, data_json, schema_version) VALUES (1, ?, 1)",
      )
      .run(DEFAULT_SETTINGS_JSON);
    sqlite.close();
  }

  return {
    dir,
    cleanup() {
      if (prev === undefined) {
        delete process.env.ATR_DATA_DIR;
      } else {
        process.env.ATR_DATA_DIR = prev;
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}
