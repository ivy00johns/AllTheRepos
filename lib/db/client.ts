import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

let cached: { db: Db; sqlite: Database.Database } | null = null;

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

export function getDataDir(): string {
  const fromEnv = process.env.ATR_DATA_DIR;
  const dir = fromEnv && fromEnv.trim().length > 0
    ? fromEnv
    : path.join(os.homedir(), ".alltherepos");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function migrationsFolder(): string {
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
