import Database from "better-sqlite3";
import crypto from "node:crypto";

export interface SeedRepoInput {
  slug?: string;
  name: string;
  fullPath: string;
  primaryLanguage?: string | null;
  languages?: Array<{ name: string; bytes: number; color: string }>;
  tags?: Array<{ value: string; source: "user" | "heuristic" | "smart" }>;
  description?: string | null;
  readmeContent?: string | null;
  currentBranch?: string | null;
  lastCommitHash?: string | null;
  lastCommitDate?: string | null;
  lastCommitMsg?: string | null;
  isDirty?: boolean;
  remoteUrl?: string | null;
  defaultBranch?: string | null;
  readmeHash?: string | null;
}

export function shortHash(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);
}

export function kebab(s: string): string {
  return s
    .replace(/[A-Z]+/g, (m) => `-${m.toLowerCase()}`)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function makeSlug(name: string, fullPath: string): string {
  return `${kebab(name)}-${shortHash(fullPath)}`;
}

/**
 * Seed a repo row directly. Returns the inserted id.
 * FTS triggers on the schema will index it automatically.
 */
export function seedRepo(
  sqlite: Database.Database,
  input: SeedRepoInput,
): { id: number; slug: string } {
  const slug = input.slug ?? makeSlug(input.name, input.fullPath);
  const info = sqlite
    .prepare(
      `INSERT INTO repos (
        slug, name, full_path, remote_url, default_branch, current_branch,
        last_commit_hash, last_commit_date, last_commit_msg, is_dirty,
        primary_language, languages_json, tags_json, description,
        readme_content, readme_hash, size_bytes, last_scanned_at,
        source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      slug,
      input.name,
      input.fullPath,
      input.remoteUrl ?? null,
      input.defaultBranch ?? null,
      input.currentBranch ?? null,
      input.lastCommitHash ?? null,
      input.lastCommitDate ?? null,
      input.lastCommitMsg ?? null,
      input.isDirty ? 1 : 0,
      input.primaryLanguage ?? null,
      JSON.stringify(input.languages ?? []),
      JSON.stringify(input.tags ?? []),
      input.description ?? null,
      input.readmeContent ?? null,
      input.readmeHash ?? null,
      null,
      new Date().toISOString(),
      "filesystem_scan",
    );
  return { id: Number(info.lastInsertRowid), slug };
}

export function seedGroup(
  sqlite: Database.Database,
  input: {
    name: string;
    description?: string | null;
    isSmart?: boolean;
    smartFilterJson?: string | null;
  },
): number {
  const info = sqlite
    .prepare(
      `INSERT INTO groups (name, description, is_smart, smart_filter_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.description ?? null,
      input.isSmart ? 1 : 0,
      input.smartFilterJson ?? null,
    );
  return Number(info.lastInsertRowid);
}

export function addRepoToGroup(
  sqlite: Database.Database,
  repoId: number,
  groupId: number,
): void {
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO repo_groups (repo_id, group_id) VALUES (?, ?)",
    )
    .run(repoId, groupId);
}
