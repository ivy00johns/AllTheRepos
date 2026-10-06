# AllTheRepos MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Claude Code session assert curated relationships between repositories, and show them on the relationship map alongside the derived ones.

**Architecture:** One new SQLite table (`repo_links`) holding directed, typed, human-asserted links. `graphService.build()` merges them into the derived graph as a sixth signal weighted above all others. A standalone stdio MCP server, living at `mcp/` with its own dependency tree, reuses the app's real query layer and graph engine to expose three read tools and three write tools. The MCP's entire write surface is `repo_links`.

**Tech Stack:** TypeScript 5.7, better-sqlite3 12.9, Drizzle 0.45, Zod 3.25, Vitest 2.1, `@modelcontextprotocol/sdk` (new dependency, `mcp/` only), esbuild (new dev dependency, `mcp/` only).

**Spec:** `docs/superpowers/specs/2026-08-24-alltherepos-mcp-design.md`

## Global Constraints

- **Never run `pnpm db:generate`.** `drizzle/meta/` has no snapshot file, so drizzle-kit emits a full `CREATE TABLE` for every table and breaks existing databases. Schema changes go in `ADDITIVE_STATEMENTS` in `src/main/db/client.ts`. This has already broken the repo once.
- **Link rows key on `repo_id`, never `slug`.** `slugFromNameAndPath` is `kebab(name)-sha1(fullPath)[0:6]` (`src/main/services/metadata.ts:350`), so a slug changes when a repo moves. `repo_id` survives via the existing rebind path.
- **MCP tools take filesystem paths, never slugs.** Same reason.
- **The MCP may write to `repo_links` and nothing else.** No command execution, no filesystem mutation, no git. `docs/COMMAND-DISCLOSURE.md` documents this guarantee and must stay true.
- **Native ABI:** `pnpm test` runs `scripts/ensure-native-abi.mjs host` first. Never run `pnpm electron:dev` and the unit suite back to back without letting those scripts re-flip the ABI.
- **Test style:** real SQLite against `isolateDataDir()` from `tests/helpers/test-db.js`, following `tests/unit/main/services/graph.spec.ts`. Vitest runs single-fork; do not add `test.concurrent`.
- **Link kinds, exactly:** `part-of`, `depends-on`, `supersedes`, `forked-from`, `related`.

---

## File Structure

**Created:**

| Path                                             | Responsibility                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `src/main/db/links.ts`                           | All `repo_links` reads/writes plus path→repo resolution. Separate from `queries.ts`, which is already 796 lines. |
| `tests/unit/main/db/links.spec.ts`               | Table behaviour, cascade, move survival, resolution, idempotence.                                                |
| `tests/unit/main/services/graph-curated.spec.ts` | Curated links in the merged graph.                                                                               |
| `mcp/package.json`                               | Own dependency tree — this is what avoids the dual-ABI collision.                                                |
| `mcp/tsconfig.json`                              | Path aliases pointing back into `../src`.                                                                        |
| `mcp/build.mjs`                                  | esbuild bundle to a single ESM file.                                                                             |
| `mcp/src/catalog.ts`                             | Resolve the data directory, open the catalog.                                                                    |
| `mcp/src/tools/read.ts`                          | `find_repos`, `get_repo`, `get_map`.                                                                             |
| `mcp/src/tools/write.ts`                         | `link`, `unlink`, `list_links`.                                                                                  |
| `mcp/src/index.ts`                               | Server bootstrap and stdio transport.                                                                            |
| `mcp/README.md`                                  | Install and usage.                                                                                               |

**Modified:**

| Path                                  | Change                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/main/db/schema.ts:106`           | Add the `repoLinks` Drizzle table after `repoGroups`.                                             |
| `src/main/db/client.ts:166-191`       | Generalise `ADDITIVE_COLUMNS` to `ADDITIVE_STATEMENTS`; add the `CREATE TABLE`.                   |
| `src/shared/schemas.ts:701`           | `RepoLinkKindSchema`; add `"curated"` to `GraphSignalSchema`; add `curated` to `GraphEdgeSchema`. |
| `src/main/services/graph.ts`          | `curated: 4` weight, curated pass, noise-filter bypass, direction metadata.                       |
| `src/renderer/routes/graph.tsx:36-42` | `SIGNAL_LABELS.curated`.                                                                          |
| `docs/COMMAND-DISCLOSURE.md`          | New §11 covering the MCP.                                                                         |
| `README.md`                           | Doc-map row for `mcp/README.md`.                                                                  |

---

## Task 1: `repo_links` table

**Files:**

- Modify: `src/main/db/schema.ts:106`
- Modify: `src/main/db/client.ts:160-191`
- Modify: `src/shared/schemas.ts:701`
- Test: `tests/unit/main/db/links.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: table `repo_links`; `RepoLinkKindSchema` and `type RepoLinkKind` from `@shared/schemas` / `@shared/types`; Drizzle table `repoLinks` from `@main/db/schema`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/db/links.spec.ts`:

```ts
/**
 * `repo_links` — schema behaviour.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

import { isolateDataDir } from "../../../helpers/test-db.js";
import type { UpsertRepoInput } from "@main/db/queries";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/atr-links-test" } }));

let isolate: { dir: string; cleanup(): void } | null = null;

function repoInput(overrides: Partial<UpsertRepoInput>): UpsertRepoInput {
  return {
    slug: "slug-000000",
    name: "repo",
    fullPath: "/nonexistent/repo",
    remoteUrl: null,
    defaultBranch: "main",
    currentBranch: "main",
    lastCommitHash: null,
    lastCommitDate: "2026-01-01T00:00:00.000Z",
    lastCommitMsg: "init",
    isDirty: false,
    primaryLanguage: "TypeScript",
    languages: [],
    heuristicTags: [],
    description: null,
    readmeContent: null,
    readmeHash: null,
    sizeBytes: 10,
    ...overrides,
  };
}

/** Insert a repo, return its numeric id. */
async function makeRepo(name: string, fullPath: string): Promise<number> {
  const { upsertRepo } = await import("@main/db/queries");
  const { getSqlite } = await import("@main/db/client");
  upsertRepo(repoInput({ slug: `${name}-aaaaaa`, name, fullPath }));
  const row = getSqlite()
    .prepare("SELECT id FROM repos WHERE full_path = ?")
    .get(fullPath) as { id: number };
  return row.id;
}

describe("repo_links schema", () => {
  beforeEach(async () => {
    isolate = isolateDataDir();
    const { closeDb, getDb } = await import("@main/db/client");
    closeDb();
    getDb();
  });

  afterEach(async () => {
    const { closeDb } = await import("@main/db/client");
    closeDb();
    isolate?.cleanup();
    isolate = null;
  });

  it("creates the table with the expected columns", async () => {
    const { getSqlite } = await import("@main/db/client");
    const columns = getSqlite()
      .prepare("PRAGMA table_info(repo_links)")
      .all() as Array<{ name: string }>;
    expect(columns.map((c) => c.name).sort()).toEqual([
      "created_at",
      "from_repo_id",
      "id",
      "kind",
      "source",
      "to_repo_id",
      "why",
    ]);
  });

  it("is idempotent — re-opening the DB does not error or duplicate", async () => {
    const { closeDb, getDb, getSqlite } = await import("@main/db/client");
    closeDb();
    getDb();
    const tables = getSqlite()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='repo_links'",
      )
      .all();
    expect(tables).toHaveLength(1);
  });

  it("rejects a duplicate (from, to, kind)", async () => {
    const { getSqlite } = await import("@main/db/client");
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    const insert = getSqlite().prepare(
      "INSERT INTO repo_links (from_repo_id, to_repo_id, kind, why, source) VALUES (?, ?, ?, ?, 'mcp')",
    );
    insert.run(a, b, "part-of", "first");
    expect(() => insert.run(a, b, "part-of", "again")).toThrow();
  });

  it("cascades — deleting a repo removes its links", async () => {
    const { getSqlite } = await import("@main/db/client");
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    getSqlite()
      .prepare(
        "INSERT INTO repo_links (from_repo_id, to_repo_id, kind, why, source) VALUES (?, ?, 'part-of', 'x', 'mcp')",
      )
      .run(a, b);
    getSqlite().prepare("DELETE FROM repos WHERE id = ?").run(b);
    const left = getSqlite().prepare("SELECT * FROM repo_links").all();
    expect(left).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/main/db/links.spec.ts`
Expected: FAIL — `PRAGMA table_info(repo_links)` returns `[]`, so the first assertion gets `[]` instead of the column list.

- [ ] **Step 3: Add the shared Zod enum**

In `src/shared/schemas.ts`, immediately above `GraphSignalSchema` (currently line 701):

```ts
/**
 * How one repo relates to another, as asserted by a human or an agent.
 *
 * `part-of` is the load-bearing one: it claims the source belongs under
 * the target, which is what makes a curated link actionable for reorg.
 */
export const RepoLinkKindSchema = z.enum([
  "part-of",
  "depends-on",
  "supersedes",
  "forked-from",
  "related",
]);

export const RepoLinkSchema = z.object({
  id: z.number().int().positive(),
  fromSlug: z.string(),
  toSlug: z.string(),
  kind: RepoLinkKindSchema,
  why: z.string().nullable(),
  source: z.enum(["mcp", "ui"]),
  createdAt: z.string(),
});
```

In `src/shared/types.ts`, alongside the other graph type re-exports (near line 300):

```ts
export type RepoLinkKind = import("zod").infer<typeof RepoLinkKindSchema>;
export type RepoLink = import("zod").infer<typeof RepoLinkSchema>;
```

Add `RepoLinkKindSchema` and `RepoLinkSchema` to the import list at `src/shared/types.ts:217`.

- [ ] **Step 4: Add the Drizzle table**

In `src/main/db/schema.ts`, after `repoGroups` ends (line 106):

```ts
/**
 * Curated relationships — asserted by a person or an agent, not derived.
 *
 * Keyed on `repo_id` rather than `slug` deliberately: a slug embeds the
 * repo's path hash, so it changes the moment a repo is moved. The row id
 * survives a move through the same rebind path that already preserves
 * tags and groups.
 */
export const repoLinks = sqliteTable(
  "repo_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fromRepoId: integer("from_repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    toRepoId: integer("to_repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    why: text("why"),
    source: text("source").notNull().default("mcp"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    fromIdx: index("repo_links_from_idx").on(t.fromRepoId),
    toIdx: index("repo_links_to_idx").on(t.toRepoId),
    uniq: uniqueIndex("repo_links_unique").on(t.fromRepoId, t.toRepoId, t.kind),
  }),
);
```

Add `uniqueIndex` to the drizzle-orm/sqlite-core import at `src/main/db/schema.ts:11`.

- [ ] **Step 5: Create the table at open time**

In `src/main/db/client.ts`, replace the `ADDITIVE_COLUMNS` array and `ensureAdditiveColumns` (lines 160-191) with:

```ts
/**
 * Columns introduced after the initial migration.
 *
 * `ALTER TABLE ... ADD COLUMN` is idempotent here because we check the
 * live table info first; SQLite has no `ADD COLUMN IF NOT EXISTS`.
 */
const ADDITIVE_COLUMNS: Array<{ table: string; column: string; ddl: string }> =
  [
    {
      table: "repos",
      column: "is_favorite",
      ddl: "ALTER TABLE repos ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
    },
    {
      table: "repos",
      column: "favorited_at",
      ddl: "ALTER TABLE repos ADD COLUMN favorited_at TEXT",
    },
  ];

/**
 * Tables introduced after the initial migration.
 *
 * Applied here rather than as a generated migration for the same reason
 * as the columns above: `drizzle/meta/` carries no snapshot, so
 * `drizzle-kit generate` has nothing to diff and emits a full CREATE for
 * every table — which fails against any existing catalog.
 */
const ADDITIVE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS repo_links (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     from_repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
     to_repo_id   INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
     kind         TEXT    NOT NULL,
     why          TEXT,
     source       TEXT    NOT NULL DEFAULT 'mcp',
     created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS repo_links_unique
     ON repo_links (from_repo_id, to_repo_id, kind)`,
  `CREATE INDEX IF NOT EXISTS repo_links_from_idx ON repo_links (from_repo_id)`,
  `CREATE INDEX IF NOT EXISTS repo_links_to_idx   ON repo_links (to_repo_id)`,
];

function ensureAdditiveColumns(sqlite: Database.Database): void {
  for (const { table, column, ddl } of ADDITIVE_COLUMNS) {
    try {
      const columns = sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{ name: string }>;
      if (columns.some((c) => c.name === column)) continue;
      sqlite.exec(ddl);
    } catch (err) {
      console.error(`[backend] add column ${table}.${column} failed`, err);
    }
  }
  for (const ddl of ADDITIVE_TABLES) {
    try {
      sqlite.exec(ddl);
    } catch (err) {
      console.error("[backend] additive table failed", err);
    }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/main/db/links.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Run the full suite for regressions**

Run: `pnpm test`
Expected: PASS. The `ADDITIVE_TABLES` loop runs on every DB open, so any test touching the catalog exercises it.

- [ ] **Step 8: Commit**

```bash
git add src/main/db/schema.ts src/main/db/client.ts src/shared/schemas.ts src/shared/types.ts tests/unit/main/db/links.spec.ts
git commit -m "feat(db): add repo_links table for curated relationships"
```

---

## Task 2: Link queries and path resolution

**Files:**

- Create: `src/main/db/links.ts`
- Test: `tests/unit/main/db/links.spec.ts` (append)

**Interfaces:**

- Consumes: `repo_links` table (Task 1); `RepoLinkKind` from `@shared/types`.
- Produces, all from `@main/db/links`:
  - `resolveRepo(pathOrName: string): ResolveResult` where `type ResolveResult = { ok: true; id: number; slug: string; name: string; fullPath: string } | { ok: false; reason: "not-found" | "ambiguous"; candidates: string[] }`
  - `createLink(input: { fromId: number; toId: number; kind: RepoLinkKind; why: string; source?: "mcp" | "ui" }): RepoLink`
  - `removeLink(fromId: number, toId: number, kind: RepoLinkKind): boolean`
  - `listLinks(repoId?: number): RepoLink[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/main/db/links.spec.ts`:

```ts
describe("link queries", () => {
  beforeEach(async () => {
    isolate = isolateDataDir();
    const { closeDb, getDb } = await import("@main/db/client");
    closeDb();
    getDb();
  });

  afterEach(async () => {
    const { closeDb } = await import("@main/db/client");
    closeDb();
    isolate?.cleanup();
    isolate = null;
  });

  it("resolves a repo by exact path", async () => {
    const { resolveRepo } = await import("@main/db/links");
    const p = path.join(isolate!.dir, "alpha");
    const id = await makeRepo("alpha", p);
    const got = resolveRepo(p);
    expect(got).toMatchObject({ ok: true, id, name: "alpha" });
  });

  it("resolves a repo by unique basename", async () => {
    const { resolveRepo } = await import("@main/db/links");
    const id = await makeRepo("alpha", path.join(isolate!.dir, "one/alpha"));
    expect(resolveRepo("alpha")).toMatchObject({ ok: true, id });
  });

  it("refuses an ambiguous basename and names the candidates", async () => {
    const { resolveRepo } = await import("@main/db/links");
    await makeRepo("alpha", path.join(isolate!.dir, "one/alpha"));
    await makeRepo("alpha", path.join(isolate!.dir, "two/alpha"));
    const got = resolveRepo("alpha");
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.reason).toBe("ambiguous");
      expect(got.candidates).toHaveLength(2);
    }
  });

  it("reports not-found rather than guessing", async () => {
    const { resolveRepo } = await import("@main/db/links");
    expect(resolveRepo("nothing-here")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
  });

  it("creates a link and lists it back", async () => {
    const { createLink, listLinks } = await import("@main/db/links");
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    createLink({ fromId: a, toId: b, kind: "part-of", why: "worker of beta" });
    const links = listLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      fromSlug: "alpha-aaaaaa",
      toSlug: "beta-aaaaaa",
      kind: "part-of",
      why: "worker of beta",
      source: "mcp",
    });
  });

  it("is idempotent — re-linking updates the reason instead of throwing", async () => {
    const { createLink, listLinks } = await import("@main/db/links");
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    createLink({ fromId: a, toId: b, kind: "part-of", why: "first" });
    createLink({ fromId: a, toId: b, kind: "part-of", why: "second" });
    const links = listLinks();
    expect(links).toHaveLength(1);
    expect(links[0].why).toBe("second");
  });

  it("removes a link and reports whether anything was removed", async () => {
    const { createLink, removeLink, listLinks } =
      await import("@main/db/links");
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    createLink({ fromId: a, toId: b, kind: "related", why: "x" });
    expect(removeLink(a, b, "related")).toBe(true);
    expect(removeLink(a, b, "related")).toBe(false);
    expect(listLinks()).toEqual([]);
  });

  it("filters by repo, in either direction", async () => {
    const { createLink, listLinks } = await import("@main/db/links");
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    const c = await makeRepo("gamma", path.join(isolate!.dir, "gamma"));
    createLink({ fromId: a, toId: b, kind: "part-of", why: "x" });
    createLink({ fromId: c, toId: a, kind: "related", why: "y" });
    expect(listLinks(a)).toHaveLength(2);
    expect(listLinks(b)).toHaveLength(1);
  });

  it("keeps a link when the repo moves — the whole reason we key on id", async () => {
    const { upsertRepo } = await import("@main/db/queries");
    const { createLink, listLinks } = await import("@main/db/links");
    const { getSqlite } = await import("@main/db/client");

    // A repo with a remote, so the catalog can rebind it after the move.
    const oldPath = path.join(isolate!.dir, "before/hive");
    upsertRepo(
      repoInput({
        slug: "hive-aaaaaa",
        name: "hive",
        fullPath: oldPath,
        remoteUrl: "https://github.com/acme/hive.git",
      }),
    );
    const b = await makeRepo("worker", path.join(isolate!.dir, "worker"));
    const hiveId = (
      getSqlite()
        .prepare("SELECT id FROM repos WHERE full_path = ?")
        .get(oldPath) as { id: number }
    ).id;
    createLink({ fromId: b, toId: hiveId, kind: "part-of", why: "worker" });

    // Same remote, new path — the catalog rebinds onto the same row.
    const newPath = path.join(isolate!.dir, "after/hive");
    upsertRepo(
      repoInput({
        slug: "hive-bbbbbb",
        name: "hive",
        fullPath: newPath,
        remoteUrl: "https://github.com/acme/hive.git",
      }),
    );

    const links = listLinks(b);
    expect(links).toHaveLength(1);
    expect(links[0].toSlug).toBe("hive-bbbbbb");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/main/db/links.spec.ts`
Expected: FAIL — `Cannot find module '@main/db/links'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/db/links.ts`:

```ts
/**
 * Curated repository links.
 *
 * Kept separate from `queries.ts` (796 lines and growing) because this
 * is one self-contained concern: the `repo_links` table plus the
 * identity resolution the MCP needs to address a repo without a slug.
 *
 * ## Why paths, not slugs
 *
 * A slug embeds a hash of the repo's path, so it changes whenever a repo
 * is moved — and moving repos is the app's central feature. An agent
 * that recorded a slug last week would silently address the wrong row.
 * Rows key on `repo_id`, and callers address repos by path.
 */

import path from "node:path";

import type { RepoLink, RepoLinkKind } from "@shared/types";

import { getSqlite } from "./client";

export type ResolveResult =
  | { ok: true; id: number; slug: string; name: string; fullPath: string }
  | { ok: false; reason: "not-found" | "ambiguous"; candidates: string[] };

interface LinkRow {
  id: number;
  kind: string;
  why: string | null;
  source: string;
  created_at: string;
  from_slug: string;
  to_slug: string;
}

function rowToLink(row: LinkRow): RepoLink {
  return {
    id: row.id,
    fromSlug: row.from_slug,
    toSlug: row.to_slug,
    kind: row.kind as RepoLinkKind,
    why: row.why,
    source: row.source === "ui" ? "ui" : "mcp",
    createdAt: row.created_at,
  };
}

/**
 * Find one repo from a path or a bare folder name.
 *
 * Never guesses. An ambiguous name returns the candidates so the caller
 * can ask a human — silently picking one would write a false assertion
 * that then outranks every derived signal on the map.
 */
export function resolveRepo(pathOrName: string): ResolveResult {
  const sqlite = getSqlite();
  const trimmed = pathOrName.trim();

  if (trimmed.includes(path.sep)) {
    const resolved = path.resolve(trimmed).replace(/\/+$/, "");
    const row = sqlite
      .prepare(
        "SELECT id, slug, name, full_path FROM repos WHERE full_path = ?",
      )
      .get(resolved) as
      | { id: number; slug: string; name: string; full_path: string }
      | undefined;
    if (row) {
      return {
        ok: true,
        id: row.id,
        slug: row.slug,
        name: row.name,
        fullPath: row.full_path,
      };
    }
  }

  const base = path.basename(trimmed);
  const matches = sqlite
    .prepare("SELECT id, slug, name, full_path FROM repos WHERE name = ?")
    .all(base) as Array<{
    id: number;
    slug: string;
    name: string;
    full_path: string;
  }>;

  if (matches.length === 1) {
    const row = matches[0];
    return {
      ok: true,
      id: row.id,
      slug: row.slug,
      name: row.name,
      fullPath: row.full_path,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      candidates: matches.map((m) => m.full_path),
    };
  }
  return { ok: false, reason: "not-found", candidates: [] };
}

const SELECT_LINKS = `
  SELECT l.id, l.kind, l.why, l.source, l.created_at,
         f.slug AS from_slug, t.slug AS to_slug
    FROM repo_links l
    JOIN repos f ON f.id = l.from_repo_id
    JOIN repos t ON t.id = l.to_repo_id
`;

/**
 * Assert a link. Idempotent on (from, to, kind): re-asserting updates the
 * reason rather than failing, so re-running the same session converges
 * instead of erroring halfway through.
 */
export function createLink(input: {
  fromId: number;
  toId: number;
  kind: RepoLinkKind;
  why: string;
  source?: "mcp" | "ui";
}): RepoLink {
  const sqlite = getSqlite();
  sqlite
    .prepare(
      `INSERT INTO repo_links (from_repo_id, to_repo_id, kind, why, source)
            VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (from_repo_id, to_repo_id, kind)
       DO UPDATE SET why = excluded.why, source = excluded.source`,
    )
    .run(
      input.fromId,
      input.toId,
      input.kind,
      input.why,
      input.source ?? "mcp",
    );

  const row = sqlite
    .prepare(
      `${SELECT_LINKS} WHERE l.from_repo_id = ? AND l.to_repo_id = ? AND l.kind = ?`,
    )
    .get(input.fromId, input.toId, input.kind) as LinkRow;
  return rowToLink(row);
}

/** Remove one link. Returns false when there was nothing to remove. */
export function removeLink(
  fromId: number,
  toId: number,
  kind: RepoLinkKind,
): boolean {
  const result = getSqlite()
    .prepare(
      "DELETE FROM repo_links WHERE from_repo_id = ? AND to_repo_id = ? AND kind = ?",
    )
    .run(fromId, toId, kind);
  return result.changes > 0;
}

/** Every curated link, or every link touching `repoId` in either direction. */
export function listLinks(repoId?: number): RepoLink[] {
  const sqlite = getSqlite();
  const rows =
    repoId === undefined
      ? (sqlite.prepare(`${SELECT_LINKS} ORDER BY l.id`).all() as LinkRow[])
      : (sqlite
          .prepare(
            `${SELECT_LINKS} WHERE l.from_repo_id = ? OR l.to_repo_id = ? ORDER BY l.id`,
          )
          .all(repoId, repoId) as LinkRow[]);
  return rows.map(rowToLink);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/main/db/links.spec.ts`
Expected: PASS, 13 tests.

If the move-survival test fails, do **not** change it to key on slug. Read `tests/unit/main/db/upsert-moved-repo.spec.ts:75` and check which rebind branch applies — the fixture may need a `lastCommitHash` for the remote-less path.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/links.ts tests/unit/main/db/links.spec.ts
git commit -m "feat(db): add curated link queries and path-based repo resolution"
```

---

## Task 3: Merge curated links into the graph

**Files:**

- Modify: `src/main/services/graph.ts`
- Modify: `src/shared/schemas.ts:701-727`
- Test: `tests/unit/main/services/graph-curated.spec.ts`

**Interfaces:**

- Consumes: `listLinks` from `@main/db/links` (Task 2).
- Produces: `GraphSignal` now includes `"curated"`; `GraphEdge` gains optional `curated: Array<{ from: string; to: string; kind: RepoLinkKind; why: string | null }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/services/graph-curated.spec.ts`:

```ts
/**
 * Curated links inside the derived graph.
 *
 * The three behaviours pinned here are the ones that would silently
 * regress: a human assertion must outrank derived signals, must survive
 * the noise filter that drops weak derived edges, and must keep its
 * direction even though the layout treats edges as undirected.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { isolateDataDir } from "../../../helpers/test-db.js";
import type { UpsertRepoInput } from "@main/db/queries";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/atr-curated-test" },
}));

let isolate: { dir: string; cleanup(): void } | null = null;
let root = "";

function repoInput(overrides: Partial<UpsertRepoInput>): UpsertRepoInput {
  return {
    slug: "slug-000000",
    name: "repo",
    fullPath: "/nonexistent/repo",
    remoteUrl: null,
    defaultBranch: "main",
    currentBranch: "main",
    lastCommitHash: null,
    lastCommitDate: "2026-01-01T00:00:00.000Z",
    lastCommitMsg: "init",
    isDirty: false,
    primaryLanguage: "TypeScript",
    languages: [],
    heuristicTags: [],
    description: null,
    readmeContent: null,
    readmeHash: null,
    sizeBytes: 10,
    ...overrides,
  };
}

async function makeRepo(name: string, deps?: string[]): Promise<number> {
  const { upsertRepo } = await import("@main/db/queries");
  const { getSqlite } = await import("@main/db/client");
  const fullPath = path.join(root, name);
  fs.mkdirSync(fullPath, { recursive: true });
  if (deps) {
    fs.writeFileSync(
      path.join(fullPath, "package.json"),
      JSON.stringify({
        name,
        dependencies: Object.fromEntries(deps.map((d) => [d, "1.0.0"])),
      }),
    );
  }
  upsertRepo(repoInput({ slug: `${name}-aaaaaa`, name, fullPath }));
  return (
    getSqlite()
      .prepare("SELECT id FROM repos WHERE full_path = ?")
      .get(fullPath) as { id: number }
  ).id;
}

function edgeBetween<T extends { source: string; target: string }>(
  edges: T[],
  a: string,
  b: string,
): T | undefined {
  return edges.find(
    (e) =>
      (e.source === a && e.target === b) || (e.source === b && e.target === a),
  );
}

describe("curated links in the graph", () => {
  beforeEach(async () => {
    isolate = isolateDataDir();
    root = path.join(isolate.dir, "Repos");
    fs.mkdirSync(root, { recursive: true });
    const { closeDb, getDb } = await import("@main/db/client");
    closeDb();
    getDb();
  });

  afterEach(async () => {
    const { closeDb } = await import("@main/db/client");
    closeDb();
    isolate?.cleanup();
    isolate = null;
  });

  it("draws an edge between repos with nothing else in common", async () => {
    const { createLink } = await import("@main/db/links");
    const { graphService } = await import("@main/services/graph");
    const a = await makeRepo("hive", ["only-hive"]);
    const b = await makeRepo("worker", ["only-worker"]);
    createLink({ fromId: b, toId: a, kind: "part-of", why: "worker of hive" });

    const graph = await graphService.build();
    const edge = edgeBetween(graph.edges, "hive-aaaaaa", "worker-aaaaaa");
    expect(edge).toBeDefined();
    expect(edge!.signals).toContain("curated");
  });

  it("outranks a derived edge between a different pair", async () => {
    const { createLink } = await import("@main/db/links");
    const { graphService } = await import("@main/services/graph");
    const hive = await makeRepo("hive", []);
    const worker = await makeRepo("worker", []);
    await makeRepo("shared-one", ["crewai"]);
    await makeRepo("shared-two", ["crewai"]);
    createLink({
      fromId: worker,
      toId: hive,
      kind: "part-of",
      why: "worker of hive",
    });

    const graph = await graphService.build();
    const curated = edgeBetween(graph.edges, "hive-aaaaaa", "worker-aaaaaa");
    const derived = edgeBetween(
      graph.edges,
      "shared-one-aaaaaa",
      "shared-two-aaaaaa",
    );
    expect(curated).toBeDefined();
    expect(derived).toBeDefined();
    expect(curated!.weight).toBeGreaterThan(derived!.weight);
  });

  it("preserves direction and reason as edge metadata", async () => {
    const { createLink } = await import("@main/db/links");
    const { graphService } = await import("@main/services/graph");
    const a = await makeRepo("hive", []);
    const b = await makeRepo("worker", []);
    createLink({ fromId: b, toId: a, kind: "part-of", why: "worker of hive" });

    const graph = await graphService.build();
    const edge = edgeBetween(graph.edges, "hive-aaaaaa", "worker-aaaaaa")!;
    expect(edge.curated).toEqual([
      {
        from: "worker-aaaaaa",
        to: "hive-aaaaaa",
        kind: "part-of",
        why: "worker of hive",
      },
    ]);
  });

  it("leaves the graph unchanged when there are no curated links", async () => {
    const { graphService } = await import("@main/services/graph");
    await makeRepo("a", ["crewai"]);
    await makeRepo("b", ["crewai"]);
    const graph = await graphService.build();
    expect(graph.edges.every((e) => !e.signals.includes("curated"))).toBe(true);
    expect(graph.edges.every((e) => e.curated === undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/main/services/graph-curated.spec.ts`
Expected: FAIL — the first test's `edge` is `undefined`, because nothing reads `repo_links`.

- [ ] **Step 3: Extend the shared schemas**

In `src/shared/schemas.ts`, change `GraphSignalSchema` (line 701) to:

```ts
export const GraphSignalSchema = z.enum([
  "dependency",
  "reference",
  "submodule",
  "owner",
  "naming",
  "curated",
]);
```

And add to `GraphEdgeSchema`, after the `why` field (line 726):

```ts
  /**
   * Directed detail for curated links on this edge.
   *
   * The edge itself stays undirected — the force layout and cluster
   * detection both depend on that — so direction rides along as
   * metadata the UI renders.
   */
  curated: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        kind: RepoLinkKindSchema,
        why: z.string().nullable(),
      }),
    )
    .optional(),
```

- [ ] **Step 4: Add the weight and the curated pass**

In `src/main/services/graph.ts`:

Add the import beneath the existing `getSqlite` import (line 53):

```ts
import { listLinks } from "@main/db/links";
```

Change `SIGNAL_WEIGHT` (line 115) to:

```ts
/** Per-signal base weights, before rarity scaling. */
const SIGNAL_WEIGHT: Record<GraphSignal, number> = {
  // A curated link is an assertion, not an inference. It outranks
  // everything the graph works out for itself.
  curated: 4,
  submodule: 3,
  reference: 2.5,
  dependency: 1,
  owner: 1.2,
  naming: 1,
};
```

Extend the `pairs` map's value type (line 340-349) with a `curated` array:

```ts
const pairs = new Map<
  string,
  {
    source: string;
    target: string;
    weight: number;
    signals: Set<GraphSignal>;
    why: string[];
    curated: Array<{
      from: string;
      to: string;
      kind: RepoLinkKind;
      why: string | null;
    }>;
  }
>();
```

Initialise it in `add` (line 363):

```ts
entry = {
  source,
  target,
  weight: 0,
  signals: new Set(),
  why: [],
  curated: [],
};
```

Add `RepoLinkKind` to the type import at line 46.

After the name-family loop ends (line 479), insert:

```ts
// Curated links — asserted by a person or an agent, never derived.
// `listLinks` joins through to slugs already, so no id mapping is
// needed here and `readRepos` is left exactly as it is.
for (const link of listLinks()) {
  const from = link.fromSlug;
  const to = link.toSlug;
  if (!bySlug.has(from) || !bySlug.has(to)) continue;
  add(from, to, "curated", 1, link.why ?? link.kind);
  pairs.get(pairKey(from, to))?.curated.push({
    from,
    to,
    kind: link.kind,
    why: link.why,
  });
}
```

- [ ] **Step 5: Bypass the noise filter and emit the metadata**

Replace the assemble block (lines 482-492) with:

```ts
const edges: GraphEdge[] = [...pairs.values()]
  // A curated link is a human assertion and must never be discarded
  // as noise, however weak the derived signals between the pair are.
  .filter(
    (entry) => entry.signals.has("curated") || entry.weight >= MIN_EDGE_WEIGHT,
  )
  .map((entry) => ({
    source: entry.source,
    target: entry.target,
    weight: Math.round(entry.weight * 100) / 100,
    signals: [...entry.signals].sort(),
    why: entry.why,
    ...(entry.curated.length > 0 ? { curated: entry.curated } : {}),
  }))
  // Strongest first, so a UI cap keeps the meaningful edges.
  .sort((a, b) => b.weight - a.weight);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/main/services/graph-curated.spec.ts tests/unit/main/services/graph.spec.ts`
Expected: PASS — 4 new tests plus the 10 existing graph tests, which must be untouched.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. `GraphSignal` gaining a member makes `SIGNAL_WEIGHT` and `SIGNAL_LABELS` exhaustive-check; `SIGNAL_LABELS` in the renderer is fixed in Task 4, so a single error there is expected at this point.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/graph.ts src/shared/schemas.ts tests/unit/main/services/graph-curated.spec.ts
git commit -m "feat(graph): merge curated links as a weighted sixth signal"
```

---

## Task 4: Show curated links in the UI

**Files:**

- Modify: `src/renderer/routes/graph.tsx:36-42`, `:229-256`

**Interfaces:**

- Consumes: `GraphEdge.curated` (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the label**

In `src/renderer/routes/graph.tsx`, extend `SIGNAL_LABELS` (line 36):

```ts
const SIGNAL_LABELS: Record<GraphSignal, string> = {
  curated: "Curated",
  dependency: "Shared libraries",
  reference: "Links to",
  submodule: "Submodule",
  owner: "Same owner",
  naming: "Name family",
};
```

The filter row at line 142 maps over `ALL_SIGNALS`, which derives from this record, so the toggle appears with no further change.

- [ ] **Step 2: Render direction in the detail panel**

In the "Strongest links" list, replace the reason line (line 248-250):

```tsx
<span className="atr-truncate block text-[10px] text-muted-foreground">
  {edge.why.join(", ") || edge.signals.join(", ")}
</span>
```

with:

```tsx
{
  edge.curated?.length ? (
    <span className="atr-truncate block text-[10px] text-accent">
      {edge.curated
        .map((c) =>
          c.from === selectedSlug
            ? `${c.kind} → ${nameOf(c.to)}`
            : `${nameOf(c.from)} ${c.kind} → this`,
        )
        .join(", ")}
    </span>
  ) : null;
}
<span className="atr-truncate block text-[10px] text-muted-foreground">
  {edge.why.join(", ") || edge.signals.join(", ")}
</span>;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, including the `SIGNAL_LABELS` error from Task 3.

- [ ] **Step 4: Verify in the running app**

Run: `pnpm electron:dev`, click **Map**. Confirm a "Curated" toggle appears in the signal row. With no links in the catalog yet, toggling it changes nothing — that is the correct empty state.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/routes/graph.tsx
git commit -m "feat(graph): surface curated links and their direction in the map"
```

---

## Task 5: MCP package scaffold

**Files:**

- Create: `mcp/package.json`, `mcp/tsconfig.json`, `mcp/build.mjs`, `mcp/src/catalog.ts`, `mcp/src/index.ts`, `mcp/.gitignore`

**Interfaces:**

- Consumes: `@main/db/client`, `@main/db/links`, `@main/db/queries`, `@main/services/graph` from `../src`.
- Produces: `openCatalog(): void` from `mcp/src/catalog.ts`; a runnable `mcp/dist/index.js`.

**Why its own dependency tree:** the root `node_modules` carries `better-sqlite3` built for either host Node or Electron, never both (`scripts/ensure-native-abi.mjs`). A server run on system Node against an Electron-ABI build fails to load. Separate trees, no collision.

- [ ] **Step 1: Create the package manifest**

`mcp/package.json`:

```json
{
  "name": "@alltherepos/mcp",
  "version": "0.1.0",
  "description": "MCP server for the AllTheRepos catalog — read repositories, assert curated relationships",
  "type": "module",
  "bin": { "alltherepos-mcp": "./dist/index.js" },
  "files": ["dist"],
  "scripts": {
    "build": "node build.mjs",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^12.9.0",
    "drizzle-orm": "^0.45.2",
    "zod": "^3.25.67"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.10.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.3"
  }
}
```

`mcp/.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 2: Create the tsconfig**

`mcp/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "paths": {
      "@shared/*": ["../src/shared/*"],
      "@main/*": ["../src/main/*"]
    }
  },
  "include": ["src/**/*.ts", "../src/shared/**/*.ts", "../src/main/db/**/*.ts"]
}
```

- [ ] **Step 3: Create the build script**

`mcp/build.mjs`:

```js
/**
 * Bundle the server to a single ESM file.
 *
 * `better-sqlite3` stays external — it is a native module and cannot be
 * bundled. It resolves from this package's own node_modules at runtime,
 * which is the whole point of the separate dependency tree.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["better-sqlite3"],
  banner: { js: "#!/usr/bin/env node" },
  alias: {
    "@shared": "../src/shared",
    "@main": "../src/main",
  },
});
console.log("built dist/index.js");
```

- [ ] **Step 4: Write the catalog opener**

`mcp/src/catalog.ts`:

```ts
/**
 * Open the same catalog the desktop app uses.
 *
 * `db/client.ts` deliberately does not import Electron — it resolves the
 * data directory from an override or the `ATR_DATA_DIR` environment
 * variable — so this process can reuse the app's real query layer
 * unmodified.
 *
 * SQLite runs in WAL mode, which permits one writer plus concurrent
 * readers across processes. Running alongside the open app is safe.
 */

import os from "node:os";
import path from "node:path";

import { getDb, setDataDirOverride } from "@main/db/client";

/** Where Electron's `app.getPath('userData')` resolves on macOS. */
function defaultDataDir(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "alltherepos",
  );
}

let opened = false;

export function openCatalog(): void {
  if (opened) return;
  if (!process.env.ATR_DATA_DIR) {
    setDataDirOverride(defaultDataDir());
  }
  // Runs migrations and the additive-table DDL as a side effect, so the
  // MCP works against a catalog created by an older app build.
  getDb();
  opened = true;
}
```

- [ ] **Step 5: Write the server bootstrap with no tools yet**

`mcp/src/index.ts`:

```ts
/**
 * AllTheRepos MCP server.
 *
 * Read the catalog; assert curated relationships. That is the entire
 * surface — no command execution, no filesystem mutation, no git. See
 * `docs/COMMAND-DISCLOSURE.md`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { openCatalog } from "./catalog.js";

const server = new McpServer({
  name: "alltherepos",
  version: "0.1.0",
});

openCatalog();

await server.connect(new StdioServerTransport());
```

- [ ] **Step 6: Install and build**

```bash
cd mcp && npm install && npm run build
```

Expected: `dist/index.js` written. If `better-sqlite3` fails to compile, the host toolchain is missing — that is the ABI risk from the spec surfacing early, and it must be resolved here rather than in a later task.

- [ ] **Step 7: Verify it boots and speaks MCP**

```bash
cd mcp && echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' | node dist/index.js
```

Expected: a JSON-RPC response containing `"serverInfo"` with `"name":"alltherepos"`.

- [ ] **Step 8: Commit**

```bash
git add mcp/package.json mcp/tsconfig.json mcp/build.mjs mcp/.gitignore mcp/src/catalog.ts mcp/src/index.ts
git commit -m "feat(mcp): scaffold the stdio server against the shared catalog"
```

---

## Task 6: Read tools

**Files:**

- Create: `mcp/src/tools/read.ts`
- Modify: `mcp/src/index.ts`

**Interfaces:**

- Consumes: `openCatalog` (Task 5); `resolveRepo`, `listLinks` (Task 2); `graphService` (Task 3).
- Produces: `registerReadTools(server: McpServer): void`.

- [ ] **Step 1: Write the read tools**

`mcp/src/tools/read.ts`:

```ts
/**
 * Read tools.
 *
 * Everything here is a query. The catalog is never modified.
 *
 * Repos are addressed by filesystem path, never by slug: a slug embeds a
 * hash of the repo's path, so it changes whenever the repo is moved.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getSqlite } from "@main/db/client";
import { listLinks, resolveRepo } from "@main/db/links";
import { graphService } from "@main/services/graph";

function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/** Turn a failed resolution into a message that tells the agent what to do. */
function resolveOrExplain(pathOrName: string) {
  const found = resolveRepo(pathOrName);
  if (found.ok) return { ok: true as const, repo: found };
  if (found.reason === "ambiguous") {
    return {
      ok: false as const,
      message: `"${pathOrName}" matches more than one repository. Pass a full path instead. Candidates:\n${found.candidates.join("\n")}`,
    };
  }
  return {
    ok: false as const,
    message: `No repository matches "${pathOrName}". Use find_repos to search the catalog.`,
  };
}

export function registerReadTools(server: McpServer): void {
  server.tool(
    "find_repos",
    "Search the catalog by name, description, or path. Returns matching repositories with the path you need for the other tools.",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ query, limit }) => {
      const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      const rows = getSqlite()
        .prepare(
          `SELECT name, full_path, description, primary_language, last_commit_date
             FROM repos
            WHERE name LIKE ? ESCAPE '\\' OR full_path LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
         ORDER BY last_commit_date DESC
            LIMIT ?`,
        )
        .all(like, like, like, limit ?? 25);
      return json(rows);
    },
  );

  server.tool(
    "get_repo",
    "Full detail for one repository, including every relationship the map currently shows for it — both derived and curated.",
    { path: z.string().min(1) },
    async ({ path: pathOrName }) => {
      const found = resolveOrExplain(pathOrName);
      if (!found.ok) return json({ error: found.message });

      const row = getSqlite()
        .prepare("SELECT * FROM repos WHERE id = ?")
        .get(found.repo.id);

      const graph = await graphService.build();
      const edges = graph.edges.filter(
        (e) => e.source === found.repo.slug || e.target === found.repo.slug,
      );

      return json({
        repo: row,
        curatedLinks: listLinks(found.repo.id),
        edges,
      });
    },
  );

  server.tool(
    "get_map",
    "The relationship map: clusters of related repositories, how far each cluster is scattered across folders, and which members sit outside their cluster's main home.",
    { cluster: z.number().int().optional() },
    async ({ cluster }) => {
      const graph = await graphService.build();
      if (cluster === undefined) {
        return json({
          builtAt: graph.builtAt,
          repoCount: graph.nodes.length,
          edgeCount: graph.edges.length,
          clusters: graph.clusters,
        });
      }
      const nodes = graph.nodes.filter((n) => n.cluster === cluster);
      const slugs = new Set(nodes.map((n) => n.slug));
      return json({
        cluster: graph.clusters.find((c) => c.id === cluster) ?? null,
        nodes,
        edges: graph.edges.filter(
          (e) => slugs.has(e.source) && slugs.has(e.target),
        ),
      });
    },
  );
}
```

- [ ] **Step 2: Register them**

In `mcp/src/index.ts`, add the import and the call before `server.connect`:

```ts
import { registerReadTools } from "./tools/read.js";
```

```ts
openCatalog();
registerReadTools(server);
```

- [ ] **Step 3: Build and typecheck**

```bash
cd mcp && npm run typecheck && npm run build
```

Expected: both clean.

- [ ] **Step 4: Verify the tools are listed**

```bash
cd mcp && printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node dist/index.js
```

Expected: the response to id 2 lists `find_repos`, `get_repo`, `get_map`.

- [ ] **Step 5: Verify against the real catalog**

```bash
cd mcp && printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"find_repos","arguments":{"query":"hive"}}}' | node dist/index.js
```

Expected: real rows from the catalog. If empty, confirm the app has scanned at least once.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/tools/read.ts mcp/src/index.ts
git commit -m "feat(mcp): add find_repos, get_repo and get_map read tools"
```

---

## Task 7: Write tools

**Files:**

- Create: `mcp/src/tools/write.ts`
- Modify: `mcp/src/index.ts`
- Create: `mcp/README.md`

**Interfaces:**

- Consumes: `createLink`, `removeLink`, `listLinks`, `resolveRepo` (Task 2).
- Produces: `registerWriteTools(server: McpServer): void`.

- [ ] **Step 1: Write the write tools**

`mcp/src/tools/write.ts`:

```ts
/**
 * Write tools.
 *
 * The entire write surface of this server: rows in `repo_links`. No
 * command execution, no filesystem mutation, no git. The app's move,
 * folder and task operations stay behind their preflight rails and are
 * deliberately unreachable from here.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { RepoLinkKindSchema } from "@shared/schemas";
import { createLink, listLinks, removeLink, resolveRepo } from "@main/db/links";

function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * Resolve both ends, or explain why not.
 *
 * An ambiguous name is refused rather than guessed: a wrong assertion
 * outranks every derived signal on the map, so a silent mis-pick is
 * worse than an error.
 */
function resolvePair(from: string, to: string) {
  for (const [label, value] of [
    ["from", from],
    ["to", to],
  ] as const) {
    const found = resolveRepo(value);
    if (!found.ok) {
      return {
        ok: false as const,
        message:
          found.reason === "ambiguous"
            ? `"${value}" (${label}) matches more than one repository. Pass a full path. Candidates:\n${found.candidates.join("\n")}`
            : `No repository matches "${value}" (${label}). Use find_repos to search.`,
      };
    }
  }
  const a = resolveRepo(from);
  const b = resolveRepo(to);
  if (!a.ok || !b.ok)
    return { ok: false as const, message: "resolution failed" };
  if (a.id === b.id) {
    return {
      ok: false as const,
      message: "A repository cannot link to itself.",
    };
  }
  return { ok: true as const, from: a, to: b };
}

export function registerWriteTools(server: McpServer): void {
  server.tool(
    "link",
    "Assert that one repository relates to another. Use 'part-of' when the source belongs under the target — that is the link that makes the map actionable for reorganising folders. Re-asserting the same link updates its reason.",
    {
      from: z.string().min(1),
      to: z.string().min(1),
      kind: RepoLinkKindSchema,
      why: z.string().min(1),
    },
    async ({ from, to, kind, why }) => {
      const pair = resolvePair(from, to);
      if (!pair.ok) return json({ error: pair.message });
      const link = createLink({
        fromId: pair.from.id,
        toId: pair.to.id,
        kind,
        why,
        source: "mcp",
      });
      return json({ created: link });
    },
  );

  server.tool(
    "unlink",
    "Remove a curated relationship. Only affects asserted links — relationships the app derives from dependencies, READMEs and naming cannot be removed this way.",
    {
      from: z.string().min(1),
      to: z.string().min(1),
      kind: RepoLinkKindSchema,
    },
    async ({ from, to, kind }) => {
      const pair = resolvePair(from, to);
      if (!pair.ok) return json({ error: pair.message });
      const removed = removeLink(pair.from.id, pair.to.id, kind);
      return json({ removed });
    },
  );

  server.tool(
    "list_links",
    "Read back curated relationships — all of them, or just those touching one repository.",
    { path: z.string().optional() },
    async ({ path: pathOrName }) => {
      if (!pathOrName) return json({ links: listLinks() });
      const found = resolveRepo(pathOrName);
      if (!found.ok) {
        return json({
          error:
            found.reason === "ambiguous"
              ? `"${pathOrName}" matches more than one repository. Candidates:\n${found.candidates.join("\n")}`
              : `No repository matches "${pathOrName}".`,
        });
      }
      return json({ links: listLinks(found.id) });
    },
  );
}
```

- [ ] **Step 2: Register them**

In `mcp/src/index.ts`:

```ts
import { registerWriteTools } from "./tools/write.js";
```

```ts
openCatalog();
registerReadTools(server);
registerWriteTools(server);
```

- [ ] **Step 3: Build and typecheck**

```bash
cd mcp && npm run typecheck && npm run build
```

Expected: both clean.

- [ ] **Step 4: Verify a round trip against the real catalog**

Pick two real repo paths from `find_repos`, then:

```bash
cd mcp && printf '%s\n%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"link","arguments":{"from":"<REPO_A_PATH>","to":"<REPO_B_PATH>","kind":"part-of","why":"smoke test"}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_links","arguments":{}}}' | node dist/index.js
```

Expected: id 2 returns the created link; id 3 lists it.

Then open the app (`pnpm electron:dev`), click **Map**, and confirm the edge appears with the Curated signal. Remove it afterwards with `unlink` so the real catalog is left as it was.

- [ ] **Step 5: Write the package README**

`mcp/README.md`:

````markdown
# @alltherepos/mcp

MCP server for the AllTheRepos catalog. Lets a Claude Code session read
your repositories and record how they relate to one another.

## Why

The relationship map derives edges from what it can read on disk —
shared dependencies, README links, remote owner, name families. That
misses intent. A repo is "part of The-Hive" because of a decision
someone made, and no file records it. This server gives a session
somewhere to put what it works out.

## Install

```sh
cd mcp && npm install && npm run build
claude mcp add alltherepos -- node /absolute/path/to/mcp/dist/index.js
```
````

Set `ATR_DATA_DIR` to override the catalog location; it defaults to
`~/Library/Application Support/alltherepos`.

## Tools

| Tool         | Purpose                               |
| ------------ | ------------------------------------- |
| `find_repos` | Search the catalog                    |
| `get_repo`   | One repository plus its relationships |
| `get_map`    | Clusters, folder spread, strays       |
| `link`       | Assert a relationship                 |
| `unlink`     | Remove an asserted relationship       |
| `list_links` | Read asserted relationships           |

## What it cannot do

It writes to exactly one table, `repo_links`. It cannot move a
repository, create or rename a folder, run a project task, kill a
process, fetch, pull, or open anything. Those stay in the desktop app
behind their preflight rails. See `../docs/COMMAND-DISCLOSURE.md`.

````

- [ ] **Step 6: Commit**

```bash
git add mcp/src/tools/write.ts mcp/src/index.ts mcp/README.md
git commit -m "feat(mcp): add link, unlink and list_links write tools"
````

---

## Task 8: Disclosure and documentation

**Files:**

- Modify: `docs/COMMAND-DISCLOSURE.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing.

**Why this is a task and not a footnote:** `docs/COMMAND-DISCLOSURE.md` claims a complete inventory of what reaches a user's machine. Shipping a second process that can open the catalog without updating it makes that document false, which is worse than never having written it.

- [ ] **Step 1: Add the MCP section**

Append to `docs/COMMAND-DISCLOSURE.md`, before the final "Last verified" line:

````markdown
---

## 11. The MCP server

`mcp/` ships a Model Context Protocol server so a Claude Code session
can read the catalog and record relationships between repositories. It
runs as a separate process, started by your MCP client, not by the app.

**What it reads:** the catalog database, and — through the same graph
engine the app uses — each repository's `package.json` and `.gitmodules`.

**What it writes:** rows in `repo_links`, and nothing else. Six tools
total: `find_repos`, `get_repo`, `get_map` are queries; `link`,
`unlink`, `list_links` operate on curated relationships.

**What it cannot do.** There is no tool for moving a repository,
creating or renaming a folder, running a project task, killing a
process, fetching, pulling, or opening a URL. The server imports the
database layer and the graph engine only — `services/move.ts`,
`services/folder.ts`, `services/tasks.ts`, `services/git-sync.ts` and
`services/launcher.ts` are not reachable from it. Every guarantee in
§1–§8 therefore still holds with the MCP installed.

Verify with:

```sh
grep -rn "services/" mcp/src
```
````

Expected: only `@main/services/graph`.

**Concurrency.** The catalog runs in WAL mode (§4), which permits one
writer plus concurrent readers across processes, so the server is safe
to use while the app is open. Curated links appear on the map the next
time the graph is rebuilt — press refresh on the Map view.

````

- [ ] **Step 2: Verify the claim you just made**

Run: `grep -rn "services/" mcp/src`
Expected: only matches for `@main/services/graph`. If anything else appears, either remove the import or correct the disclosure — do not leave the document overstating the guarantee.

- [ ] **Step 3: Add the doc-map row**

In `README.md`, in the Documentation map table, after the `docs/COMMAND-DISCLOSURE.md` row:

```markdown
| [`mcp/README.md`](./mcp/README.md)                                                                                 | **MCP server** — curated repo relationships from a Claude session |
````

- [ ] **Step 4: Full verification**

```bash
pnpm test && npx tsc --noEmit && cd mcp && npm run typecheck
```

Expected: unit suite green, both typechecks clean.

- [ ] **Step 5: Commit**

```bash
git add docs/COMMAND-DISCLOSURE.md README.md
git commit -m "docs: disclose the MCP server's read and write surface"
```

---

## Self-review notes

**Spec coverage:** §4 data model → Task 1. §3.3 slug/id → Tasks 1–2, pinned by the move-survival test. §3.4 migration path → Task 1 Step 5. §5.1–5.3 graph merge → Task 3. §5.4 downstream → Task 4. §6 server and tools → Tasks 5–7. §7 safety → Task 8, with a verification step rather than a claim. §8 ABI → Task 5, surfaced at first install rather than late. §9 testing → Tasks 1–3.

**Deferred, per spec §10:** edge suppression, reorganisation tools, scheduled re-curation. No task implements them.

**Fixed during review:** an unused `idToSlug` map in Task 3 (and the `readRepos` change that only existed to feed it) — `listLinks` already returns slugs, so neither was needed. Also untangled Task 3's second test, which resolved `worker` through a doubled `resolveRepo` call when `makeRepo` already returns the id.
