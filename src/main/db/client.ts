/**
 * SQLite client singleton for the Electron main process.
 *
 * Mirrors `lib/db/client.ts` from the legacy app, with two differences:
 *   1. The data directory is `app.getPath('userData')` (per
 *      `contracts/data-layer.v1.md`) instead of `~/.alltherepos/`.
 *   2. WAL mode + `foreign_keys=ON` are still enforced.
 *
 * The DB is initialized lazily on first call to `getDb()` — that way
 * importing this module from a worker thread (which lacks `app`) does
 * not crash; the worker MUST pass an explicit data directory in via
 * `setDataDirOverride()` before calling `getDb()`.
 */

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

let cached: { db: Db; sqlite: Database.Database } | null = null;
let dataDirOverride: string | null = null;

const DEFAULT_SETTINGS = {
  scanPaths: [] as string[],
  ollamaBaseUrl: "http://localhost:11434",
  ollamaEmbedModel: "nomic-embed-text",
  openaiEmbedModel: null as string | null,
  defaultEditor: "vscode" as const,
  schemaVersion: 1,
};

/** FTS5 virtual table + sync triggers. Runs once per boot (IF NOT EXISTS keeps it idempotent). */
const FTS_SQL = `
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

/**
 * Override the data directory used for `getDb()`. Intended for:
 *   - the main process at startup (`app.getPath('userData')`)
 *   - worker threads (passed in via `workerData`)
 */
export function setDataDirOverride(dir: string): void {
  dataDirOverride = dir;
}

/**
 * Resolve the data directory. Priority:
 *   1. {@link setDataDirOverride} value (main passes `app.getPath('userData')`)
 *   2. `ATR_DATA_DIR` environment variable (legacy / test override)
 *   3. Throw — Electron contexts MUST set the override before first use.
 *
 * The directory is created if missing.
 */
export function getDataDir(): string {
  let dir: string | null = null;
  if (dataDirOverride && dataDirOverride.trim().length > 0) {
    dir = dataDirOverride;
  } else if (
    process.env.ATR_DATA_DIR &&
    process.env.ATR_DATA_DIR.trim().length > 0
  ) {
    dir = process.env.ATR_DATA_DIR;
  }
  if (!dir) {
    throw new Error(
      "[backend] data directory not set - call setDataDirOverride(app.getPath('userData')) before getDb()",
    );
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function migrationsFolder(): string {
  // In production the built bundle still has `drizzle/` co-located with the
  // project root via electron-builder packaging rules. In dev we resolve
  // relative to process.cwd() which is the repo root for `electron-vite dev`.
  // The `ATR_MIGRATIONS_DIR` env var lets QE / packaging override this.
  if (
    process.env.ATR_MIGRATIONS_DIR &&
    process.env.ATR_MIGRATIONS_DIR.trim().length > 0
  ) {
    return process.env.ATR_MIGRATIONS_DIR;
  }
  return path.join(process.cwd(), "drizzle");
}

export function getDb(): Db {
  if (cached) return cached.db;

  const dataDir = getDataDir();
  const dbPath = path.join(dataDir, "alltherepos.db");

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  try {
    const folder = migrationsFolder();
    if (fs.existsSync(folder)) {
      migrate(db, { migrationsFolder: folder });
    }
  } catch (err) {
    console.error("[backend] migrate error", err);
  }

  try {
    sqlite.exec(FTS_SQL);
  } catch (err) {
    console.error("[backend] fts setup error", err);
  }

  try {
    const existing = sqlite
      .prepare("SELECT id FROM settings WHERE id = 1")
      .get();
    if (!existing) {
      sqlite
        .prepare(
          "INSERT INTO settings (id, data_json, schema_version) VALUES (1, ?, 1)",
        )
        .run(JSON.stringify(DEFAULT_SETTINGS));
    }
  } catch (err) {
    console.error("[backend] settings seed error", err);
  }

  cached = { db, sqlite };
  return db;
}

export function getSqlite(): Database.Database {
  if (!cached) getDb();
  return cached!.sqlite;
}

/**
 * Close the cached connection. Intended for tests and graceful shutdown.
 * After close, the next `getDb()` will re-open with current `dataDirOverride`.
 */
export function closeDb(): void {
  if (cached) {
    try {
      cached.sqlite.close();
    } catch (err) {
      console.error("[backend] close db error", err);
    }
    cached = null;
  }
}
