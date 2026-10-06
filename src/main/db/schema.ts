/**
 * Drizzle schema for the Electron main-process SQLite catalog.
 *
 * MIRROR of `lib/db/schema.ts` from the legacy Next.js app — kept byte-for-byte
 * compatible so the existing `drizzle/0000_initial.sql` migration applies
 * unchanged. Phase 1 contract states the schema is frozen; do NOT redesign
 * here. See `contracts/schema.md` for the authoritative shape.
 */

import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const repos = sqliteTable(
  "repos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    fullPath: text("full_path").notNull().unique(),
    remoteUrl: text("remote_url"),
    defaultBranch: text("default_branch"),
    currentBranch: text("current_branch"),
    lastCommitHash: text("last_commit_hash"),
    lastCommitDate: text("last_commit_date"),
    lastCommitMsg: text("last_commit_msg"),
    isDirty: integer("is_dirty", { mode: "boolean" }).notNull().default(false),
    primaryLanguage: text("primary_language"),
    languagesJson: text("languages_json").notNull().default("[]"),
    tagsJson: text("tags_json").notNull().default("[]"),
    description: text("description"),
    readmeContent: text("readme_content"),
    readmeHash: text("readme_hash"),
    sizeBytes: integer("size_bytes"),
    lastScannedAt: text("last_scanned_at"),
    lastOpenedAt: text("last_opened_at"),
    /** Pinned by the user. Additive column — see `ensureAdditiveColumns`. */
    isFavorite: integer("is_favorite", { mode: "boolean" })
      .notNull()
      .default(false),
    favoritedAt: text("favorited_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    source: text("source", { enum: ["manual", "filesystem_scan"] })
      .notNull()
      .default("filesystem_scan"),
  },
  (t) => ({
    primaryLanguageIdx: index("repos_primary_language_idx").on(
      t.primaryLanguage,
    ),
    lastCommitDateIdx: index("repos_last_commit_date_idx").on(t.lastCommitDate),
    lastScannedAtIdx: index("repos_last_scanned_at_idx").on(t.lastScannedAt),
  }),
);

export const groups = sqliteTable(
  "groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    isSmart: integer("is_smart", { mode: "boolean" }).notNull().default(false),
    smartFilterJson: text("smart_filter_json"),
    parentGroupId: integer("parent_group_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    parentGroupIdIdx: index("groups_parent_group_id_idx").on(t.parentGroupId),
  }),
);

export const repoGroups = sqliteTable(
  "repo_groups",
  {
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    addedAt: text("added_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.repoId, t.groupId] }),
    groupIdIdx: index("repo_groups_group_id_idx").on(t.groupId),
  }),
);

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

export const scanPaths = sqliteTable("scan_paths", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull().unique(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastScannedAt: text("last_scanned_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  dataJson: text("data_json").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type RepoRow = typeof repos.$inferSelect;
export type InsertRepoRow = typeof repos.$inferInsert;
export type GroupRow = typeof groups.$inferSelect;
export type InsertGroupRow = typeof groups.$inferInsert;
export type RepoGroupRow = typeof repoGroups.$inferSelect;
export type ScanPathRow = typeof scanPaths.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
