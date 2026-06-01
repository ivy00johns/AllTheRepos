/**
 * ATR-019 Integration Test (REAL DB) — `repos_fts_insert` populates `tags_text`.
 *
 * Regression: the INSERT trigger used to write `tags_text=''`, so a
 * freshly-scanned repo was NOT findable by a tag token until a later UPDATE
 * fired (which mirrored `tags_text = NEW.tags_json`). The fix mirrors the
 * UPDATE trigger on INSERT: `tags_text = COALESCE(NEW.tags_json,'')`.
 *
 * !!! REAL better-sqlite3 DB !!!
 * This boots the actual `@main/db/client` (drizzle migrations + the fixed
 * FTS_SQL), so it opens a native better-sqlite3 handle. Per the lane rules it
 * is written here but the INTEGRATOR runs it after a host-ABI rebuild — under
 * the current Electron ABI it will fail to load the native module. It is NOT
 * part of Lane A's native-free vitest run.
 *
 * NOTE on idempotency: the client now DROPs + recreates the triggers every
 * boot (NOT `CREATE ... IF NOT EXISTS`), so an OLD DB self-heals to the fixed
 * INSERT/UPDATE definitions, and a one-time backfill re-syncs `tags_text` from
 * `tags_json` for rows the old buggy trigger left at `''`. The final test here
 * exercises that backfill across a client reboot on the same data dir.
 *
 * Owner: Lane A.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isolateDataDir } from "../../../helpers/test-db.js";

describe("repos_fts_insert trigger indexes tags_text (ATR-019)", () => {
  let isolate: { dir: string; cleanup(): void } | null = null;

  beforeEach(async () => {
    isolate = isolateDataDir();
    const { closeDb, getDb } = await import("@main/db/client");
    // Drop any cached connection from a prior test, then boot against the fresh
    // ATR_DATA_DIR so migrations + the fixed FTS triggers are applied.
    closeDb();
    getDb();
  });

  afterEach(async () => {
    const { closeDb } = await import("@main/db/client");
    closeDb();
    isolate?.cleanup();
    isolate = null;
  });

  it("makes a freshly-INSERTed repo findable by one of its tag tokens", async () => {
    const { getSqlite } = await import("@main/db/client");
    const sqlite = getSqlite();

    // A repo whose tag tokens ("rust", "tauri") appear ONLY in tags_json —
    // not in name/description/readme — so a hit can only come from tags_text.
    const tagsJson = JSON.stringify([
      { value: "rust", source: "heuristic" },
      { value: "tauri", source: "heuristic" },
    ]);

    sqlite
      .prepare(
        `INSERT INTO repos (slug, name, full_path, tags_json, description, readme_content)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "widget-app",
        "Widget App",
        "/tmp/widget-app",
        tagsJson,
        "A desktop widget",
        "# Widget App\n\nNo ecosystem words here.",
      );

    // The INSERT trigger should have populated tags_text from tags_json, so a
    // search for the tag token "tauri" matches immediately (no UPDATE needed).
    const hit = sqlite
      .prepare(`SELECT slug FROM repos_fts WHERE repos_fts MATCH ? LIMIT 1`)
      .get('"tauri"*') as { slug: string } | undefined;

    expect(hit?.slug).toBe("widget-app");

    // And the raw indexed column carries the JSON tag text.
    const ftsRow = sqlite
      .prepare(`SELECT tags_text FROM repos_fts WHERE slug = ?`)
      .get("widget-app") as { tags_text: string } | undefined;
    expect(ftsRow?.tags_text).toContain("tauri");
    expect(ftsRow?.tags_text).toContain("rust");
  });

  it("still finds the repo by a tag token via the search service path expression", async () => {
    const { getSqlite } = await import("@main/db/client");
    const sqlite = getSqlite();

    sqlite
      .prepare(
        `INSERT INTO repos (slug, name, full_path, tags_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        "go-svc",
        "Go Service",
        "/tmp/go-svc",
        JSON.stringify([{ value: "kubernetes", source: "heuristic" }]),
      );

    const hit = sqlite
      .prepare(`SELECT slug FROM repos_fts WHERE repos_fts MATCH ? LIMIT 1`)
      .get('"kubernetes"*') as { slug: string } | undefined;

    expect(hit?.slug).toBe("go-svc");
  });

  it("the UPDATE trigger keeps tags_text in sync when tags change", async () => {
    const { getSqlite } = await import("@main/db/client");
    const sqlite = getSqlite();

    sqlite
      .prepare(
        `INSERT INTO repos (slug, name, full_path, tags_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        "edit-me",
        "Edit Me",
        "/tmp/edit-me",
        JSON.stringify([{ value: "rust", source: "heuristic" }]),
      );

    // `repos.tags_json` is NOT NULL at the column level, so the trigger's
    // COALESCE is belt-and-suspenders; the real "cleared" state is an
    // empty-array JSON. After clearing, the old "rust" token must no longer
    // match via the UPDATE trigger's tags_text resync.
    sqlite
      .prepare(`UPDATE repos SET tags_json = ? WHERE slug = ?`)
      .run(JSON.stringify([]), "edit-me");
    const clearedHit = sqlite
      .prepare(`SELECT slug FROM repos_fts WHERE repos_fts MATCH ? LIMIT 1`)
      .get('"rust"*') as { slug: string } | undefined;
    expect(clearedHit).toBeUndefined();

    // Re-tagging makes the new token searchable.
    sqlite
      .prepare(`UPDATE repos SET tags_json = ? WHERE slug = ?`)
      .run(JSON.stringify([{ value: "wasm", source: "heuristic" }]), "edit-me");
    const hit = sqlite
      .prepare(`SELECT slug FROM repos_fts WHERE repos_fts MATCH ? LIMIT 1`)
      .get('"wasm"*') as { slug: string } | undefined;
    expect(hit?.slug).toBe("edit-me");
  });

  it("ATR-019 backfill: an existing row with stale tags_text='' becomes searchable on next boot", async () => {
    const { getSqlite, closeDb, getDb } = await import("@main/db/client");
    let sqlite = getSqlite();

    // Insert a repo, then SIMULATE the OLD buggy-trigger state: a repos_fts row
    // whose tags_text is '' even though tags_json carries tokens. (We force the
    // stale value directly so we don't depend on the old trigger existing.)
    sqlite
      .prepare(
        `INSERT INTO repos (slug, name, full_path, tags_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        "legacy-repo",
        "Legacy Repo",
        "/tmp/legacy-repo",
        JSON.stringify([{ value: "elixir", source: "heuristic" }]),
      );
    sqlite
      .prepare(`UPDATE repos_fts SET tags_text = '' WHERE slug = ?`)
      .run("legacy-repo");

    // Sanity: while stale, the tag token is NOT findable.
    const beforeBackfill = sqlite
      .prepare(`SELECT slug FROM repos_fts WHERE repos_fts MATCH ? LIMIT 1`)
      .get('"elixir"*') as { slug: string } | undefined;
    expect(beforeBackfill).toBeUndefined();

    // Reboot the client against the SAME data dir — the backfill pass should
    // re-sync tags_text from tags_json.
    closeDb();
    getDb();
    sqlite = getSqlite();

    const afterBackfill = sqlite
      .prepare(`SELECT slug FROM repos_fts WHERE repos_fts MATCH ? LIMIT 1`)
      .get('"elixir"*') as { slug: string } | undefined;
    expect(afterBackfill?.slug).toBe("legacy-repo");
  });
});
