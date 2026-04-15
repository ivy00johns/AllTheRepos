import type { RepoRow } from "@/lib/db/schema";
import type { SearchHit, SearchQuery, Tag } from "@/lib/types";
import { getSqlite } from "@/lib/db/client";
import { rowToRepo } from "@/lib/db/queries";
import { embed, EmbedUnavailableError } from "@/lib/embed/client";
import { vectorSearch } from "./lance";

interface FtsMatch {
  slug: string;
  rank: number;
  snippet: string | null;
}

function escapeFtsQuery(q: string): string {
  const cleaned = q.replace(/"/g, " ").trim();
  if (!cleaned) return "";
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(" ");
}

function ftsSearch(query: string, limit: number): FtsMatch[] {
  const expr = escapeFtsQuery(query);
  if (!expr) return [];
  const sqlite = getSqlite();
  try {
    const rows = sqlite
      .prepare(
        `SELECT slug, rank, snippet(repos_fts, 3, '[', ']', '...', 16) AS snippet
         FROM repos_fts
         WHERE repos_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(expr, limit) as Array<{
      slug: string;
      rank: number;
      snippet: string | null;
    }>;
    return rows;
  } catch (err) {
    console.error("[backend] fts query error", err);
    return [];
  }
}

function fetchReposBySlugs(slugs: string[]): Map<string, RepoRow> {
  if (slugs.length === 0) return new Map();
  const sqlite = getSqlite();
  const placeholders = slugs.map(() => "?").join(",");
  const rows = sqlite
    .prepare(`SELECT * FROM repos WHERE slug IN (${placeholders})`)
    .all(...slugs) as RepoRow[];
  const out = new Map<string, RepoRow>();
  for (const r of rows) out.set(r.slug, r);
  return out;
}

function applyPostFilters(
  rows: RepoRow[],
  filters: NonNullable<SearchQuery["filters"]>,
): RepoRow[] {
  return rows.filter((row) => {
    if (filters.language && row.primaryLanguage !== filters.language) {
      return false;
    }
    if (filters.dirtyOnly && !row.isDirty) return false;
    if (filters.tags && filters.tags.length > 0) {
      let tags: Tag[] = [];
      try {
        tags = JSON.parse(row.tagsJson) as Tag[];
      } catch {
        tags = [];
      }
      const values = new Set(tags.map((t) => t.value));
      for (const need of filters.tags) {
        if (!values.has(need)) return false;
      }
    }
    return true;
  });
}

async function filterByGroupIds(
  rows: RepoRow[],
  groupIds: number[],
): Promise<RepoRow[]> {
  if (groupIds.length === 0) return rows;
  const sqlite = getSqlite();
  const repoIds = rows.map((r) => r.id);
  if (repoIds.length === 0) return [];
  const placeholders = repoIds.map(() => "?").join(",");
  const gPlace = groupIds.map(() => "?").join(",");
  const matched = sqlite
    .prepare(
      `SELECT DISTINCT repo_id FROM repo_groups
       WHERE repo_id IN (${placeholders}) AND group_id IN (${gPlace})`,
    )
    .all(...repoIds, ...groupIds) as Array<{ repo_id: number }>;
  const allowed = new Set(matched.map((m) => m.repo_id));
  return rows.filter((r) => allowed.has(r.id));
}

/**
 * Hybrid FTS5 + vector search with Reciprocal Rank Fusion (RRF, k=60).
 */
export async function hybridSearch(q: SearchQuery): Promise<SearchHit[]> {
  const limit = Math.min(q.limit ?? 50, 200);
  const candidateLimit = Math.max(limit * 3, 100);

  // 1. FTS
  const ftsResults = ftsSearch(q.query, candidateLimit);
  const ftsBySlug = new Map<string, FtsMatch>();
  ftsResults.forEach((m, idx) => ftsBySlug.set(m.slug, { ...m, rank: idx }));

  // 2. Vector (parallel-ish: issue after fts to allow a local path where Ollama is slow)
  let vectorHits: { slug: string; score: number }[] = [];
  try {
    const vec = await embed(q.query);
    vectorHits = await vectorSearch(vec, candidateLimit);
  } catch (err) {
    if (err instanceof EmbedUnavailableError) {
      console.warn("[backend] embedding unavailable; FTS-only", err.message);
    } else {
      console.error("[backend] vector path error", err);
    }
  }
  const vectorRankBySlug = new Map<string, number>();
  vectorHits.forEach((v, idx) => vectorRankBySlug.set(v.slug, idx));

  // 3. RRF merge (k = 60 canonical)
  const K = 60;
  const scored = new Map<
    string,
    { score: number; matchKind: "fts" | "vector" | "hybrid"; snippet: string | null }
  >();

  for (const [slug, m] of ftsBySlug) {
    const rrf = 1 / (K + m.rank + 1);
    scored.set(slug, {
      score: rrf,
      matchKind: "fts",
      snippet: m.snippet,
    });
  }
  for (const [slug, rank] of vectorRankBySlug) {
    const rrf = 1 / (K + rank + 1);
    const existing = scored.get(slug);
    if (existing) {
      existing.score += rrf;
      existing.matchKind = "hybrid";
    } else {
      scored.set(slug, { score: rrf, matchKind: "vector", snippet: null });
    }
  }

  if (scored.size === 0) return [];

  const slugs = [...scored.keys()];
  const rowBySlug = fetchReposBySlugs(slugs);
  let rows = slugs
    .map((s) => rowBySlug.get(s))
    .filter((r): r is RepoRow => !!r);

  // Filters
  const filters = q.filters ?? {};
  rows = applyPostFilters(rows, filters);
  if (filters.groupIds && filters.groupIds.length > 0) {
    rows = await filterByGroupIds(rows, filters.groupIds);
  }

  // Build hits with fallback snippet from readme
  const hits: SearchHit[] = rows.map((row) => {
    const entry = scored.get(row.slug)!;
    let snippet = entry.snippet;
    if (!snippet && row.readmeContent) {
      snippet = row.readmeContent.slice(0, 200);
    }
    return {
      repo: rowToRepo(row),
      score: entry.score,
      matchKind: entry.matchKind,
      snippet: snippet ?? null,
    };
  });

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
