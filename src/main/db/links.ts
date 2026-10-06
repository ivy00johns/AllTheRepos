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

interface RepoIdentityRow {
  id: number;
  slug: string;
  name: string;
  full_path: string;
}

interface LinkRow {
  id: number;
  kind: string;
  why: string | null;
  source: string;
  created_at: string;
  from_slug: string;
  to_slug: string;
}

function rowToIdentity(row: RepoIdentityRow): ResolveResult {
  return {
    ok: true,
    id: row.id,
    slug: row.slug,
    name: row.name,
    fullPath: row.full_path,
  };
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
    const resolved = path.resolve(trimmed).replace(/[/\\]+$/, "");
    const row = sqlite
      .prepare(
        "SELECT id, slug, name, full_path FROM repos WHERE full_path = ?",
      )
      .get(resolved) as RepoIdentityRow | undefined;
    if (row) return rowToIdentity(row);
  }

  const base = path.basename(trimmed);
  const matches = sqlite
    .prepare("SELECT id, slug, name, full_path FROM repos WHERE name = ?")
    .all(base) as RepoIdentityRow[];

  if (matches.length === 1) return rowToIdentity(matches[0]);
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
