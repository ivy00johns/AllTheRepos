/**
 * Database query layer for the Electron main process.
 *
 * Port of `lib/db/queries.ts` from the legacy Next.js app. The exported
 * surface is preserved 1:1 so service code can be ported with minimal
 * touch-up. Two intentional differences:
 *
 *   1. The Settings-related helpers (`getSettings`, `upsertSettings`) are
 *      gone from this file — Phase 1's data-layer contract moves settings
 *      to `electron-store`. The SQLite `settings` table remains for the
 *      one-shot migration path (see `services/settings.ts`).
 *
 *   2. `mapRawRepoRow` is the critical snake_case→camelCase converter used
 *      everywhere we touch `better-sqlite3` raw rows (`.prepare().get()`
 *      doesn't apply Drizzle's column mapping). Memory observations 609–612
 *      flagged this; the MVP's `setRepoTags` failed without it.
 *
 *   3. `getSettingsFromTable` / `upsertSettingsInTable` are exposed for the
 *      one-shot migration from the legacy SQLite-backed settings to
 *      electron-store. They are NOT the runtime read/write API.
 */

import { and, desc, eq, sql, inArray } from "drizzle-orm";
import type {
  Group,
  LanguageBytes,
  Repo,
  RepoDetail,
  RepoListQuery,
  RepoListResult,
  Settings,
  SmartFilter,
  Tag,
} from "@shared/types";
import { getDb, getSqlite } from "./client";
import {
  groups as groupsTable,
  repoGroups,
  repos as reposTable,
  scanPaths as scanPathsTable,
  settings as settingsTable,
  type GroupRow,
  type RepoRow,
} from "./schema";

const REPO_PREVIEW_MAX = 2048;

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function previewOf(readme: string | null): string | null {
  if (!readme) return null;
  return readme.length <= REPO_PREVIEW_MAX
    ? readme
    : readme.slice(0, REPO_PREVIEW_MAX);
}

/**
 * Convert a raw better-sqlite3 row (snake_case columns) to a Drizzle-shaped
 * RepoRow (camelCase). Needed wherever we use `prepare().get()` instead of
 * `db.select()` — better-sqlite3 doesn't apply Drizzle's column mapping.
 */
export function mapRawRepoRow(raw: Record<string, unknown>): RepoRow {
  return {
    id: raw.id as number,
    slug: raw.slug as string,
    name: raw.name as string,
    fullPath: raw.full_path as string,
    remoteUrl: (raw.remote_url as string | null) ?? null,
    defaultBranch: (raw.default_branch as string | null) ?? null,
    currentBranch: (raw.current_branch as string | null) ?? null,
    lastCommitHash: (raw.last_commit_hash as string | null) ?? null,
    lastCommitDate: (raw.last_commit_date as string | null) ?? null,
    lastCommitMsg: (raw.last_commit_msg as string | null) ?? null,
    isDirty: Boolean(raw.is_dirty),
    primaryLanguage: (raw.primary_language as string | null) ?? null,
    languagesJson: (raw.languages_json as string) ?? "[]",
    tagsJson: (raw.tags_json as string) ?? "[]",
    description: (raw.description as string | null) ?? null,
    readmeContent: (raw.readme_content as string | null) ?? null,
    readmeHash: (raw.readme_hash as string | null) ?? null,
    sizeBytes: (raw.size_bytes as number | null) ?? null,
    lastScannedAt: (raw.last_scanned_at as string | null) ?? null,
    lastOpenedAt: (raw.last_opened_at as string | null) ?? null,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
    source: (raw.source as RepoRow["source"]) ?? "filesystem_scan",
  };
}

export function rowToRepo(row: RepoRow): Repo {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    fullPath: row.fullPath,
    remoteUrl: row.remoteUrl,
    defaultBranch: row.defaultBranch,
    currentBranch: row.currentBranch,
    lastCommitHash: row.lastCommitHash,
    lastCommitDate: row.lastCommitDate,
    lastCommitMsg: row.lastCommitMsg,
    isDirty: !!row.isDirty,
    primaryLanguage: row.primaryLanguage,
    languages: parseJson<LanguageBytes[]>(row.languagesJson, []),
    tags: parseJson<Tag[]>(row.tagsJson, []),
    description: row.description,
    readmePreview: previewOf(row.readmeContent),
    readmeHash: row.readmeHash,
    sizeBytes: row.sizeBytes,
    lastScannedAt: row.lastScannedAt,
    lastOpenedAt: row.lastOpenedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: (row.source as "manual" | "filesystem_scan") ?? "filesystem_scan",
  };
}

function rowToGroup(row: GroupRow, repoCount: number): Group {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSmart: !!row.isSmart,
    smartFilter: parseJson<SmartFilter | null>(row.smartFilterJson, null),
    parentGroupId: row.parentGroupId,
    sortOrder: row.sortOrder,
    repoCount,
  };
}

function escapeFtsQuery(q: string): string {
  // Wrap tokens in double quotes so FTS5 treats them literally.
  // Replace embedded quotes with space to avoid breaking the expression.
  const cleaned = q.replace(/"/g, " ").trim();
  if (!cleaned) return "";
  // Tokenize on whitespace, quote each non-empty token, join with AND.
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(" ");
}

export async function listRepos(query: RepoListQuery): Promise<RepoListResult> {
  const db = getDb();
  const sqlite = getSqlite();
  const limit = Math.min(query.limit ?? 50, 200);
  const offset = query.offset ?? 0;

  // If q is provided, use FTS5 to scope candidate slugs, then reuse main query.
  let ftsSlugs: string[] | null = null;
  if (query.q && query.q.trim().length > 0) {
    const expr = escapeFtsQuery(query.q);
    if (expr) {
      const matches = sqlite
        .prepare(
          "SELECT slug FROM repos_fts WHERE repos_fts MATCH ? ORDER BY rank LIMIT 1000",
        )
        .all(expr) as Array<{ slug: string }>;
      ftsSlugs = matches.map((m) => m.slug);
      if (ftsSlugs.length === 0) {
        return { items: [], total: 0, limit, offset };
      }
    }
  }

  const conditions = [] as ReturnType<typeof eq>[];
  if (query.language) {
    conditions.push(eq(reposTable.primaryLanguage, query.language));
  }
  if (query.dirtyOnly) {
    conditions.push(eq(reposTable.isDirty, true));
  }
  if (ftsSlugs) {
    conditions.push(inArray(reposTable.slug, ftsSlugs));
  }
  if (query.groupId != null) {
    const groupRepoRows = await db
      .select({ repoId: repoGroups.repoId })
      .from(repoGroups)
      .where(eq(repoGroups.groupId, query.groupId));
    const repoIds = groupRepoRows.map((r) => r.repoId);
    if (repoIds.length === 0) {
      return { items: [], total: 0, limit, offset };
    }
    conditions.push(inArray(reposTable.id, repoIds));
  }

  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  // Pull candidates (bounded) and apply tag JSON filter in JS.
  const sortField = query.sort ?? "lastCommit";
  const order = query.order ?? "desc";
  const sortColumn =
    sortField === "name"
      ? reposTable.name
      : sortField === "lastScanned"
        ? reposTable.lastScannedAt
        : sortField === "lastOpened"
          ? reposTable.lastOpenedAt
          : reposTable.lastCommitDate;

  const selectQ = db.select().from(reposTable);
  const withWhere = whereExpr ? selectQ.where(whereExpr) : selectQ;
  const ordered = withWhere.orderBy(order === "asc" ? sortColumn : desc(sortColumn));

  const rows = (await ordered) as RepoRow[];

  // Tag filter: require every requested tag to be present in tags_json.
  let filtered = rows;
  if (query.tags && query.tags.length > 0) {
    const needed = new Set(query.tags);
    filtered = rows.filter((row) => {
      const tags = parseJson<Tag[]>(row.tagsJson, []);
      const values = new Set(tags.map((t) => t.value));
      for (const n of needed) {
        if (!values.has(n)) return false;
      }
      return true;
    });
  }

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  return {
    items: page.map(rowToRepo),
    total,
    limit,
    offset,
  };
}

export async function getRepoBySlug(slug: string): Promise<RepoDetail | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(reposTable)
    .where(eq(reposTable.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const groupRows = await db
    .select({
      id: groupsTable.id,
      name: groupsTable.name,
    })
    .from(repoGroups)
    .innerJoin(groupsTable, eq(groupsTable.id, repoGroups.groupId))
    .where(eq(repoGroups.repoId, row.id));

  const base = rowToRepo(row);
  return {
    ...base,
    readmeContent: row.readmeContent,
    groups: groupRows.map((g) => ({ id: g.id, name: g.name })),
  };
}

export async function listGroups(): Promise<Group[]> {
  const db = getDb();
  const rows = (await db.select().from(groupsTable)) as GroupRow[];
  const counts = (await db
    .select({
      groupId: repoGroups.groupId,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(repoGroups)
    .groupBy(repoGroups.groupId)) as Array<{ groupId: number; count: number }>;
  const countByGroup = new Map<number, number>();
  for (const c of counts) countByGroup.set(c.groupId, Number(c.count) || 0);
  const sorted = [...rows].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
  return sorted.map((r) => rowToGroup(r, countByGroup.get(r.id) ?? 0));
}

/**
 * Read the legacy SQLite-backed settings row (id = 1).
 *
 * In Phase 1 this is ONLY used by `SettingsService` during the one-shot
 * migration from SQLite → electron-store. Runtime reads/writes go through
 * `services/settings.ts`. Returns `null` if no legacy row exists.
 */
export function getSettingsFromTable(): Settings | null {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare("SELECT data_json, schema_version FROM settings WHERE id = 1")
    .get() as { data_json: string; schema_version: number } | undefined;
  if (!row) return null;

  const parsed = parseJson<Partial<Settings>>(row.data_json, {});
  const scanRows = sqlite
    .prepare("SELECT path, enabled FROM scan_paths")
    .all() as Array<{ path: string; enabled: number }>;
  const tablePaths = scanRows.filter((r) => !!r.enabled).map((r) => r.path);

  return {
    scanPaths: parsed.scanPaths?.length ? parsed.scanPaths : tablePaths,
    ollamaBaseUrl: parsed.ollamaBaseUrl ?? "http://localhost:11434",
    ollamaEmbedModel: parsed.ollamaEmbedModel ?? "nomic-embed-text",
    openaiEmbedModel: parsed.openaiEmbedModel ?? null,
    defaultEditor: (parsed.defaultEditor ?? "vscode") as Settings["defaultEditor"],
    schemaVersion: parsed.schemaVersion ?? row.schema_version ?? 1,
  };
}

/** Merge user tags (manual) with existing heuristic/smart tags on a repo. */
export function mergeUserTags(existing: Tag[], userValues: string[]): Tag[] {
  const nonUser = existing.filter((t) => t.source !== "user");
  const user: Tag[] = userValues
    .map((v) => v.trim())
    .filter(Boolean)
    .map((value) => ({ value, source: "user" as const }));
  const seen = new Set<string>();
  const out: Tag[] = [];
  // user first (highest precedence)
  for (const t of user) {
    if (seen.has(t.value)) continue;
    seen.add(t.value);
    out.push(t);
  }
  for (const t of nonUser) {
    if (seen.has(t.value)) continue;
    seen.add(t.value);
    out.push(t);
  }
  return out;
}

export interface UpsertRepoInput {
  slug: string;
  name: string;
  fullPath: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  currentBranch: string | null;
  lastCommitHash: string | null;
  lastCommitDate: string | null;
  lastCommitMsg: string | null;
  isDirty: boolean;
  primaryLanguage: string | null;
  languages: LanguageBytes[];
  heuristicTags: Tag[];
  description: string | null;
  readmeContent: string | null;
  readmeHash: string | null;
  sizeBytes: number | null;
}

export interface UpsertRepoResult {
  row: RepoRow;
  created: boolean;
}

/**
 * Idempotent upsert by full_path. Preserves slug, user tags, notes (n/a here),
 * and group memberships (FK cascade handles groups).
 */
export function upsertRepo(input: UpsertRepoInput): UpsertRepoResult {
  const sqlite = getSqlite();
  const now = new Date().toISOString();

  const existingStmt = sqlite.prepare(
    "SELECT * FROM repos WHERE full_path = ?",
  );
  const existingRaw = existingStmt.get(input.fullPath) as Record<string, unknown> | undefined;
  const existing = existingRaw ? mapRawRepoRow(existingRaw) : undefined;

  if (!existing) {
    const allTags: Tag[] = input.heuristicTags.slice(0, 12);
    sqlite
      .prepare(
        `INSERT INTO repos (
          slug, name, full_path, remote_url, default_branch, current_branch,
          last_commit_hash, last_commit_date, last_commit_msg, is_dirty,
          primary_language, languages_json, tags_json, description,
          readme_content, readme_hash, size_bytes, last_scanned_at,
          created_at, updated_at, source
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.slug,
        input.name,
        input.fullPath,
        input.remoteUrl,
        input.defaultBranch,
        input.currentBranch,
        input.lastCommitHash,
        input.lastCommitDate,
        input.lastCommitMsg,
        input.isDirty ? 1 : 0,
        input.primaryLanguage,
        JSON.stringify(input.languages),
        JSON.stringify(allTags),
        input.description,
        input.readmeContent,
        input.readmeHash,
        input.sizeBytes,
        now,
        now,
        now,
        "filesystem_scan",
      );
    const created = mapRawRepoRow(existingStmt.get(input.fullPath) as Record<string, unknown>);
    return { row: created, created: true };
  }

  // Preserve slug + user tags; replace heuristic/smart with new heuristic tags.
  const existingTags = parseJson<Tag[]>(existing.tagsJson, []);
  const userTags = existingTags.filter((t) => t.source === "user");
  const mergedTags: Tag[] = [];
  const seen = new Set<string>();
  for (const t of userTags) {
    if (seen.has(t.value)) continue;
    seen.add(t.value);
    mergedTags.push(t);
  }
  for (const t of input.heuristicTags) {
    if (seen.has(t.value)) continue;
    seen.add(t.value);
    mergedTags.push(t);
  }
  const capped = mergedTags.slice(0, 12);

  sqlite
    .prepare(
      `UPDATE repos SET
        name = ?,
        remote_url = ?,
        default_branch = ?,
        current_branch = ?,
        last_commit_hash = ?,
        last_commit_date = ?,
        last_commit_msg = ?,
        is_dirty = ?,
        primary_language = ?,
        languages_json = ?,
        tags_json = ?,
        description = ?,
        readme_content = ?,
        readme_hash = ?,
        size_bytes = ?,
        last_scanned_at = ?,
        updated_at = ?
      WHERE id = ?`,
    )
    .run(
      input.name,
      input.remoteUrl,
      input.defaultBranch,
      input.currentBranch,
      input.lastCommitHash,
      input.lastCommitDate,
      input.lastCommitMsg,
      input.isDirty ? 1 : 0,
      input.primaryLanguage,
      JSON.stringify(input.languages),
      JSON.stringify(capped),
      input.description,
      input.readmeContent,
      input.readmeHash,
      input.sizeBytes,
      now,
      now,
      existing.id,
    );
  const updated = mapRawRepoRow(existingStmt.get(input.fullPath) as Record<string, unknown>);
  return { row: updated, created: false };
}

export async function setRepoGroups(repoId: number, groupIds: number[]): Promise<void> {
  const db = getDb();
  await db.delete(repoGroups).where(eq(repoGroups.repoId, repoId));
  if (groupIds.length === 0) return;
  await db.insert(repoGroups).values(
    groupIds.map((gid) => ({ repoId, groupId: gid })),
  );
}

export async function addRepoToGroupBySlug(
  slug: string,
  groupId: number,
): Promise<void> {
  const db = getDb();
  const r = await db
    .select({ id: reposTable.id })
    .from(reposTable)
    .where(eq(reposTable.slug, slug))
    .limit(1);
  const repoId = r[0]?.id;
  if (!repoId) throw new Error("repo not found");
  await db
    .insert(repoGroups)
    .values({ repoId, groupId })
    .onConflictDoNothing();
}

export async function removeRepoFromGroupBySlug(
  slug: string,
  groupId: number,
): Promise<void> {
  const db = getDb();
  const r = await db
    .select({ id: reposTable.id })
    .from(reposTable)
    .where(eq(reposTable.slug, slug))
    .limit(1);
  const repoId = r[0]?.id;
  if (!repoId) throw new Error("repo not found");
  await db
    .delete(repoGroups)
    .where(and(eq(repoGroups.repoId, repoId), eq(repoGroups.groupId, groupId)));
}

export async function setUserTagsBySlug(
  slug: string,
  values: string[],
): Promise<RepoRow | null> {
  const sqlite = getSqlite();
  const rawRow = sqlite
    .prepare("SELECT * FROM repos WHERE slug = ?")
    .get(slug) as Record<string, unknown> | undefined;
  if (!rawRow) return null;
  const row = mapRawRepoRow(rawRow);
  const existing = parseJson<Tag[]>(row.tagsJson, []);
  const merged = mergeUserTags(existing, values).slice(0, 12);
  sqlite
    .prepare(
      "UPDATE repos SET tags_json = ?, updated_at = ? WHERE id = ?",
    )
    .run(JSON.stringify(merged), new Date().toISOString(), row.id);
  const refreshedRaw = sqlite
    .prepare("SELECT * FROM repos WHERE id = ?")
    .get(row.id) as Record<string, unknown>;
  return mapRawRepoRow(refreshedRaw);
}

export async function markRepoOpened(slug: string): Promise<void> {
  const sqlite = getSqlite();
  sqlite
    .prepare(
      "UPDATE repos SET last_opened_at = ?, updated_at = ? WHERE slug = ?",
    )
    .run(new Date().toISOString(), new Date().toISOString(), slug);
}

export async function getRepoIdBySlug(slug: string): Promise<number | null> {
  const db = getDb();
  const r = await db
    .select({ id: reposTable.id })
    .from(reposTable)
    .where(eq(reposTable.slug, slug))
    .limit(1);
  return r[0]?.id ?? null;
}

export async function listScanPaths(): Promise<string[]> {
  const db = getDb();
  const rows = (await db.select().from(scanPathsTable)) as Array<{
    path: string;
    enabled: boolean;
  }>;
  return rows.filter((r) => r.enabled).map((r) => r.path);
}

export async function addScanPathRow(path: string): Promise<void> {
  const db = getDb();
  await db
    .insert(scanPathsTable)
    .values({ path, enabled: true })
    .onConflictDoNothing();
}

export async function removeScanPathRow(path: string): Promise<void> {
  const db = getDb();
  await db.delete(scanPathsTable).where(eq(scanPathsTable.path, path));
}

export async function insertGroup(input: {
  name: string;
  description?: string | null;
  isSmart?: boolean;
  smartFilter?: SmartFilter | null;
  parentGroupId?: number | null;
}): Promise<Group> {
  const db = getDb();
  const inserted = await db
    .insert(groupsTable)
    .values({
      name: input.name,
      description: input.description ?? null,
      isSmart: input.isSmart ?? false,
      smartFilterJson: input.smartFilter ? JSON.stringify(input.smartFilter) : null,
      parentGroupId: input.parentGroupId ?? null,
    })
    .returning();
  const row = inserted[0] as GroupRow;
  return rowToGroup(row, 0);
}

export async function updateGroupRow(
  id: number,
  patch: Partial<Group>,
): Promise<Group | null> {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.isSmart !== undefined) set.isSmart = patch.isSmart;
  if (patch.smartFilter !== undefined) {
    set.smartFilterJson = patch.smartFilter
      ? JSON.stringify(patch.smartFilter)
      : null;
  }
  if (patch.parentGroupId !== undefined) set.parentGroupId = patch.parentGroupId;
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
  await db.update(groupsTable).set(set).where(eq(groupsTable.id, id));
  const rows = await db
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.id, id))
    .limit(1);
  if (!rows[0]) return null;
  const countRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(repoGroups)
    .where(eq(repoGroups.groupId, id));
  const c = Number(countRows[0]?.c ?? 0);
  return rowToGroup(rows[0] as GroupRow, c);
}

export async function deleteGroupRow(id: number): Promise<void> {
  const db = getDb();
  await db.delete(groupsTable).where(eq(groupsTable.id, id));
}

/**
 * Replace the entire member set for a group. Computes the diff between the
 * current members and the requested slug list, then inserts/deletes the
 * difference. Returns the new member count.
 */
export async function setGroupMembersBySlugs(
  groupId: number,
  slugs: string[],
): Promise<number> {
  const db = getDb();
  // Resolve slugs → repo ids in one query.
  const repoRows = slugs.length
    ? ((await db
        .select({ id: reposTable.id, slug: reposTable.slug })
        .from(reposTable)
        .where(inArray(reposTable.slug, slugs))) as Array<{ id: number; slug: string }>)
    : [];
  const desiredIds = new Set(repoRows.map((r) => r.id));

  // Delete all current memberships for this group, then re-insert.
  await db.delete(repoGroups).where(eq(repoGroups.groupId, groupId));
  if (desiredIds.size > 0) {
    await db.insert(repoGroups).values(
      [...desiredIds].map((repoId) => ({ repoId, groupId })),
    );
  }
  return desiredIds.size;
}

/**
 * Fetch a single Repo by slug (without group hydration). Used by `catalog:rescan`
 * to return the freshly upserted row in the API shape.
 */
export async function getRepoSummaryBySlug(slug: string): Promise<Repo | null> {
  const sqlite = getSqlite();
  const raw = sqlite
    .prepare("SELECT * FROM repos WHERE slug = ?")
    .get(slug) as Record<string, unknown> | undefined;
  if (!raw) return null;
  return rowToRepo(mapRawRepoRow(raw));
}
