# Database Schema — v1 (frozen)

SQLite via `better-sqlite3` + Drizzle ORM. Data file: `{ATR_DATA_DIR}/alltherepos.db`. WAL mode. That one file holds everything: the tables below, the FTS5 index (`repos_fts`) and the vector table (`repo_embeddings`).

## Tables

### repos

```sql
CREATE TABLE repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  full_path TEXT NOT NULL UNIQUE,
  remote_url TEXT,
  default_branch TEXT,
  current_branch TEXT,
  last_commit_hash TEXT,
  last_commit_date TEXT, -- ISO-8601
  last_commit_msg TEXT,
  is_dirty INTEGER NOT NULL DEFAULT 0,
  primary_language TEXT,
  languages_json TEXT NOT NULL DEFAULT '[]', -- LanguageBytes[]
  tags_json TEXT NOT NULL DEFAULT '[]',       -- Tag[]
  description TEXT,
  readme_content TEXT,
  readme_hash TEXT,
  size_bytes INTEGER,
  last_scanned_at TEXT,
  last_opened_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL DEFAULT 'filesystem_scan' -- 'manual' | 'filesystem_scan'
);

CREATE INDEX repos_primary_language_idx ON repos(primary_language);
CREATE INDEX repos_last_commit_date_idx ON repos(last_commit_date DESC);
CREATE INDEX repos_last_scanned_at_idx ON repos(last_scanned_at DESC);

-- FTS5 virtual table for keyword search
CREATE VIRTUAL TABLE repos_fts USING fts5(
  slug UNINDEXED,
  name,
  description,
  readme_content,
  tags_text,  -- denormalized from tags_json
  tokenize = 'porter unicode61'
);
```

### groups

```sql
CREATE TABLE groups (
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

CREATE INDEX groups_parent_group_id_idx ON groups(parent_group_id);
```

### repo_groups

```sql
CREATE TABLE repo_groups (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (repo_id, group_id)
);

CREATE INDEX repo_groups_group_id_idx ON repo_groups(group_id);
```

### scan_paths

```sql
CREATE TABLE scan_paths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### settings

```sql
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed row on first boot
INSERT INTO settings (id, data_json, schema_version)
  VALUES (1, '{"scanPaths":[],"ollamaBaseUrl":"http://localhost:11434","ollamaEmbedModel":"nomic-embed-text","openaiEmbedModel":null,"defaultEditor":"vscode","schemaVersion":1}', 1);
```

## Triggers

FTS sync triggers MUST exist so keyword search stays current:

```sql
CREATE TRIGGER repos_fts_insert AFTER INSERT ON repos BEGIN
  INSERT INTO repos_fts(slug, name, description, readme_content, tags_text)
  VALUES (NEW.slug, NEW.name, COALESCE(NEW.description,''), COALESCE(NEW.readme_content,''), '');
END;

CREATE TRIGGER repos_fts_update AFTER UPDATE ON repos BEGIN
  UPDATE repos_fts SET
    name = NEW.name,
    description = COALESCE(NEW.description,''),
    readme_content = COALESCE(NEW.readme_content,''),
    tags_text = NEW.tags_json
  WHERE slug = NEW.slug;
END;

CREATE TRIGGER repos_fts_delete AFTER DELETE ON repos BEGIN
  DELETE FROM repos_fts WHERE slug = OLD.slug;
END;
```

## Vector store

`repo_embeddings` is a `vec0` virtual table **in the same database file as the
tables above**. It is created by the app on first use rather than by a Drizzle
migration — the `sqlite-vec` extension has to be loaded into the connection
before the DDL can run — and the app keeps working without it (keyword search
only, as `catalog:search` reports):

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS repo_embeddings USING vec0(
  repo_id INTEGER PRIMARY KEY,  -- repos.id
  slug TEXT,
  content_hash TEXT,            -- sha256 of name + description + readme
  updated_at TEXT,              -- ISO-8601
  embedding float[768]          -- nomic-embed-text
);
```

`vec0` enforces the declared width, so a provider that returns a different
number of floats fails the insert instead of writing incomparable rows. `slug`,
`content_hash` and `updated_at` are metadata columns beside the vector, so the
nearest-neighbour query and the content-hash gate read from the same row.
`contracts/data-layer.v1.md` covers how the extension is loaded and where its
platform binary comes from.
