/**
 * Search service — hybrid FTS5 + vector search with Reciprocal Rank Fusion.
 *
 * Port of `lib/search/query.ts > hybridSearch()`. Exposed via the
 * `searchService` singleton consumed by `catalog:search` IPC handler.
 *
 * Graceful degradation, now said out loud:
 *   - If the vector store or the embedding service is unreachable, the result
 *     is FTS-only with `matchKind: "fts"` — and the response carries a
 *     {@link SemanticSearchStatus} saying which of the two was missing, so the
 *     UI can tell the user instead of quietly returning fewer kinds of match.
 *   - `mode` is honoured: `"fts"` skips the vector half entirely (and reports
 *     `reason: "requested"`, which is a choice rather than a failure),
 *     `"vector"` skips FTS, `"hybrid"` (the default) runs both.
 *   - If neither half yields anything, `hits` is empty and `semantic` still
 *     says what was tried.
 */

import type {
  SearchHit,
  SearchQuery,
  SearchReposInput,
  SearchReposResult,
  SemanticSearchStatus,
  Tag,
} from "@shared/types";
import type { RepoRow } from "@main/db/schema";

import { getSqlite } from "@main/db/client";
import { mapRawRepoRow, rowToRepo } from "@main/db/queries";

import { embed, EmbedUnavailableError } from "./embedding";
import { vectorSearch, vectorStoreStatus } from "./vector-store";

interface FtsMatch {
  slug: string;
  rank: number;
  snippet: string | null;
}

/** Which halves of the pipeline to run. `"hybrid"` runs both. */
type SearchMode = NonNullable<SearchReposInput["mode"]>;

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
  // Raw `.all()` returns snake_case; convert via `mapRawRepoRow` per memory
  // observations 609-612 (MVP `setRepoTags` bug).
  const rawRows = sqlite
    .prepare(`SELECT * FROM repos WHERE slug IN (${placeholders})`)
    .all(...slugs) as Array<Record<string, unknown>>;
  const out = new Map<string, RepoRow>();
  for (const raw of rawRows) {
    const row = mapRawRepoRow(raw);
    out.set(row.slug, row);
  }
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
 * Why the vector half did not run, as a status the UI can act on.
 *
 * `"vectors"` means it ran — not that it contributed: an empty store, or a
 * query whose nearest neighbours are all past `candidateLimit`, both leave the
 * ranking FTS-shaped while the store itself is working. The distinction the UI
 * needs is "this machine cannot do semantic search" versus "this query found
 * nothing semantically", and only the first one is worth interrupting a user
 * about.
 */
async function vectorHalf(
  q: string,
  candidateLimit: number,
): Promise<{ hits: { slug: string; score: number }[]; status: SemanticSearchStatus }> {
  const store = vectorStoreStatus();
  if (!store.available) {
    return {
      hits: [],
      status: {
        state: "off",
        reason: "no-vector-store",
        detail: store.reason,
      },
    };
  }
  try {
    const vec = await embed(q);
    return {
      hits: vectorSearch(vec, candidateLimit),
      status: { state: "vectors" },
    };
  } catch (err) {
    if (err instanceof EmbedUnavailableError) {
      console.warn("[backend] embedding unavailable; FTS-only", err.message);
      return {
        hits: [],
        status: {
          state: "off",
          reason: "no-embedding-provider",
          detail: err.message,
        },
      };
    }
    // Anything else is the vector path itself failing. It must not take the
    // search down — but it must not be silent either, which is the whole
    // point of this response shape.
    console.error("[backend] vector path error", err);
    return {
      hits: [],
      status: {
        state: "off",
        reason: "no-vector-store",
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Hybrid FTS5 + vector search with Reciprocal Rank Fusion (RRF, k=60).
 *
 * Exported for unit tests / direct calls. The IPC layer goes through
 * `searchService.search(input)`.
 */
export async function hybridSearch(
  q: SearchQuery,
  mode: SearchMode = "hybrid",
): Promise<SearchReposResult> {
  const limit = Math.min(q.limit ?? 50, 200);
  const candidateLimit = Math.max(limit * 3, 100);

  // 1. FTS — skipped only when the caller asked for vectors alone.
  const ftsBySlug = new Map<string, FtsMatch>();
  if (mode !== "vector") {
    const ftsResults = ftsSearch(q.query, candidateLimit);
    ftsResults.forEach((m, idx) => ftsBySlug.set(m.slug, { ...m, rank: idx }));
  }

  // 2. Vector — skipped when the caller asked for keywords alone, and otherwise
  //    attempted with the failure reported rather than swallowed. One call, not
  //    two: `embed()` is a network round trip and the status is a by-product of
  //    running it, not a second opinion about it.
  const vectorHalfResult: {
    hits: { slug: string; score: number }[];
    status: SemanticSearchStatus;
  } =
    mode === "fts"
      ? {
          hits: [],
          status: { state: "off", reason: "requested", detail: null },
        }
      : await vectorHalf(q.query, candidateLimit);
  const semantic: SemanticSearchStatus = vectorHalfResult.status;
  const vectorHits = vectorHalfResult.hits;

  const vectorRankBySlug = new Map<string, number>();
  vectorHits.forEach((v, idx) => vectorRankBySlug.set(v.slug, idx));

  // 3. RRF merge (k = 60 canonical)
  const K = 60;
  const scored = new Map<
    string,
    {
      score: number;
      matchKind: "fts" | "vector" | "hybrid";
      snippet: string | null;
    }
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

  if (scored.size === 0) return { hits: [], semantic };

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
  return { hits: hits.slice(0, limit), semantic };
}

class SearchService {
  /**
   * Run a hybrid search from the `catalog:search` IPC payload shape. Adapts
   * the IPC `SearchReposInput` (uses `q`) into the internal `SearchQuery`
   * shape (uses `query`).
   *
   * `mode` is honoured rather than ignored (it used to be accepted and
   * dropped): `"fts"` runs keywords only, `"vector"` runs the vector store
   * only, `"hybrid"` — the default when the field is absent — runs both and
   * fuses them with RRF.
   */
  search(input: SearchReposInput): Promise<SearchReposResult> {
    const query: SearchQuery = {
      query: input.q,
      filters: input.filters
        ? {
            language: input.filters.language ?? null,
            tags: input.filters.tags,
            groupIds: input.filters.groupIds,
            dirtyOnly: input.filters.dirtyOnly,
          }
        : undefined,
      limit: input.limit,
    };
    return hybridSearch(query, input.mode ?? "hybrid");
  }
}

export const searchService: SearchService = new SearchService();
