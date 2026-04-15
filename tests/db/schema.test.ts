import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { isolateDataDir } from "../helpers/test-db.js";

/**
 * Smoke test: mount lib/db/client.ts against a tmp ATR_DATA_DIR and confirm
 * every v1 table listed in contracts/schema.md exists + the settings row is
 * seeded.
 *
 * Depends on backend having:
 *   - committed `drizzle/` migrations generated from lib/db/schema.ts
 *   - OR lib/db/client.ts that applies the schema on boot
 */
describe("db/schema — contracts/schema.md v1", () => {
  let isolate: { dir: string; cleanup(): void } | null = null;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    isolate?.cleanup();
    isolate = null;
  });

  it("creates all required tables and the settings row on first boot", async () => {
    isolate = isolateDataDir({ seedSchema: false });
    // Fresh module graph each test so the cached db handle in lib/db/client.ts
    // is re-initialized against the new ATR_DATA_DIR.
    const { getDb, getSqlite } = await import("@/lib/db/client");
    getDb();
    const sqlite = getSqlite();

    const rows = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));

    for (const required of [
      "repos",
      "groups",
      "repo_groups",
      "scan_paths",
      "settings",
      "repos_fts",
    ]) {
      expect.soft(names.has(required), `missing table: ${required}`).toBe(true);
    }

    const seed = sqlite
      .prepare("SELECT id, schema_version FROM settings WHERE id = 1")
      .get() as { id: number; schema_version: number } | undefined;
    expect(seed).toBeDefined();
    expect(seed?.id).toBe(1);
    expect(seed?.schema_version).toBeGreaterThanOrEqual(1);
  });
});
