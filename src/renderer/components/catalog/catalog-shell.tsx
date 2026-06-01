import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import type { Group, Repo, RepoDetail } from "@shared/types";

import { GroupSidebar } from "@renderer/components/groups/group-sidebar";
import { KeyboardShortcuts } from "@renderer/components/layout/keyboard-shortcuts";
import { SearchBar } from "@renderer/components/search/search-bar";
import { useSearch as useCatalogSearch } from "@renderer/hooks/use-search";
import { requireAtr } from "@renderer/lib/atr";

import { DetailPanel } from "./detail-panel";
import { FilterChips, type ActiveFilters } from "./filter-chips";
import { RepoGrid } from "./repo-grid";

interface CatalogShellProps {
  initialRepos: Repo[];
  groups: Group[];
  totalCount: number;
  loadRepoDetail: (slug: string) => Promise<RepoDetail | null>;
}

/**
 * URL search params understood by the catalog route. Mirrors the
 * Next.js `useSearchParams()` keys (`repo`, `q`, `lang`, `tag`,
 * `groupId`, `dirty`). The TanStack Router route owned by
 * frontend-shell declares these via its `validateSearch`.
 *
 * `tag` is repeatable — kept as `string[]` in TanStack Router.
 */
interface CatalogSearch {
  repo?: string;
  q?: string;
  lang?: string;
  tag?: string[];
  groupId?: string;
  dirty?: string;
}

/**
 * The renderer's catalog shell.
 *
 * Ported from `components/catalog/catalog-shell.tsx` with the following
 * adaptations:
 *
 *   1. `useRouter()` / `usePathname()` / `useSearchParams()` from
 *      `next/navigation` are replaced with `useNavigate()` and
 *      `useSearch()` from `@tanstack/react-router`. The legacy
 *      `router.replace(pathname?qs)` shape is replaced with
 *      `navigate({ search: ... , replace: true })`.
 *
 *   2. The infinite-loop fix from memory 644 (`updateParamsRef`
 *      pattern) is re-ported verbatim. `updateParams` depends on the
 *      current search state, which changes every time we navigate —
 *      the ref breaks the dependency cycle so the debounced-`q` effect
 *      doesn't keep re-firing.
 *
 *   3. "Open in editor" routes through `requireAtr().git.openInEditor`
 *      (pure-action callback — exempt from the "use hooks only" rule).
 *      If the bridge is unavailable (browser-only QE run) we fall back
 *      to the legacy `vscode://file/...` URL the Next.js app used.
 *
 *   4. Real search (ATR-003): a non-empty query drives the grid from the
 *      backend `catalog:search` (hybrid FTS + vector) via the
 *      `useCatalogSearch` hook; an empty query browses `initialRepos`
 *      with the facet filters applied client-side.
 *
 *   5. One search source of truth (ATR-012): the `q` URL search param is
 *      authoritative. The global top-bar SearchBar writes the same param,
 *      and the effect below adopts external `q` changes into the local
 *      input so both inputs stay in lockstep.
 */
export function CatalogShell({
  initialRepos,
  groups,
  totalCount,
  loadRepoDetail,
}: CatalogShellProps) {
  const navigate = useNavigate();
  // `strict: false` lets this shell render under whichever route the
  // frontend-shell wires it up to without forcing a route ID coupling.
  const search = useSearch({ strict: false }) as CatalogSearch;

  const querySlug = search.repo ?? null;
  const queryQ = search.q ?? "";
  const queryLanguage = search.lang ?? null;
  const queryTags = React.useMemo(
    () =>
      Array.isArray(search.tag) ? search.tag : search.tag ? [search.tag] : [],
    [search.tag],
  );
  const queryGroupId = search.groupId ?? null;
  const queryDirty = search.dirty === "1";

  const [q, setQ] = React.useState(queryQ);
  const [debouncedQ, setDebouncedQ] = React.useState(queryQ);
  const [searching, setSearching] = React.useState(false);
  const [detail, setDetail] = React.useState<RepoDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const filters: ActiveFilters = React.useMemo(
    () => ({
      language: queryLanguage,
      tags: queryTags,
      groupId: queryGroupId ? Number(queryGroupId) : null,
      dirtyOnly: queryDirty,
    }),
    [queryLanguage, queryTags, queryGroupId, queryDirty],
  );

  const updateParams = React.useCallback(
    (patch: Record<string, string | string[] | null | undefined>) => {
      // TanStack Router's `search` setter is typed per-route; this
      // shell is route-agnostic, so we cast to a loose object updater
      // and let the route's `validateSearch` enforce the schema.
      const searchUpdater = (prev: CatalogSearch): CatalogSearch => {
        const next: CatalogSearch = { ...prev };
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) continue; // undefined => leave alone
          if (value === null || value === "") {
            delete (next as Record<string, unknown>)[key];
            continue;
          }
          if (Array.isArray(value)) {
            if (value.length === 0) {
              delete (next as Record<string, unknown>)[key];
            } else {
              (next as Record<string, unknown>)[key] = value;
            }
            continue;
          }
          (next as Record<string, unknown>)[key] = value;
        }
        return next;
      };
      navigate({
        search: searchUpdater as unknown as never,
        replace: true,
      });
    },
    [navigate],
  );

  // Whether the user has an active text query. When set, the grid is
  // driven by the real backend `catalog:search` (hybrid FTS + vector);
  // when empty, we browse `initialRepos` with the facet filters applied
  // client-side. The hook owns its own debounce, so we hand it the raw
  // `q` and read the (debounced) result.
  const trimmedQuery = q.trim();
  const isSearching = trimmedQuery.length > 0;

  // Real catalog search. Forward the active facet filters so FTS/vector
  // results respect the same language/tag/dirty constraints as browsing.
  // `groupIds` is included when a group is selected so the backend can
  // scope hybrid results to a group's members. The contract caps `limit`
  // at 200; ask for the max so search isn't silently truncated.
  const searchQuery = useCatalogSearch(q, {
    mode: "hybrid",
    limit: 200,
    filters: {
      language: filters.language ?? undefined,
      tags: filters.tags.length ? filters.tags : undefined,
      groupIds: filters.groupId !== null ? [filters.groupId] : undefined,
      dirtyOnly: filters.dirtyOnly || undefined,
    },
  });

  // Browse path: client-side facet filter over the server-rendered set.
  const browseRepos = React.useMemo(() => {
    const groupMembership = (repo: Repo): boolean => {
      if (filters.groupId === null) return true;
      const g = groups.find((x) => x.id === filters.groupId);
      if (!g) return true;
      if (g.isSmart && g.smartFilter) {
        const f = g.smartFilter;
        if (f.language && repo.primaryLanguage !== f.language) return false;
        if (f.dirtyOnly && !repo.isDirty) return false;
        if (f.hasRemote !== undefined && !!repo.remoteUrl !== f.hasRemote)
          return false;
        if (f.tagsInclude?.length) {
          const have = new Set(repo.tags.map((t) => t.value));
          if (!f.tagsInclude.every((t) => have.has(t))) return false;
        }
        if (f.tagsExclude?.length) {
          const have = new Set(repo.tags.map((t) => t.value));
          if (f.tagsExclude.some((t) => have.has(t))) return false;
        }
        if (f.sinceDays !== undefined && repo.lastCommitDate) {
          const ageDays =
            (Date.now() - Date.parse(repo.lastCommitDate)) / (24 * 3600 * 1000);
          if (ageDays > f.sinceDays) return false;
        }
        return true;
      }
      // Manual membership isn't on Repo; assume matches for now.
      return true;
    };
    return initialRepos.filter((r) => {
      if (filters.language && r.primaryLanguage !== filters.language)
        return false;
      if (filters.dirtyOnly && !r.isDirty) return false;
      if (filters.tags.length) {
        const have = new Set(r.tags.map((t) => t.value));
        if (!filters.tags.every((t) => have.has(t))) return false;
      }
      if (!groupMembership(r)) return false;
      return true;
    });
  }, [initialRepos, filters, groups]);

  // The grid source: search hits (mapped to `Repo`, score order
  // preserved) when querying, else the browsed list.
  const displayedRepos = React.useMemo<Repo[]>(() => {
    if (!isSearching) return browseRepos;
    return (searchQuery.data ?? []).map((hit) => hit.repo);
  }, [isSearching, browseRepos, searchQuery.data]);

  // Load detail when URL param changes.
  React.useEffect(() => {
    let cancelled = false;
    if (!querySlug) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    loadRepoDetail(querySlug).then((d) => {
      if (cancelled) return;
      setDetail(d);
      setDetailLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [querySlug, loadRepoDetail]);

  // Fake "searching" indicator to match the 250ms debounce.
  React.useEffect(() => {
    if (q !== debouncedQ) {
      setSearching(true);
    } else {
      setSearching(false);
    }
  }, [q, debouncedQ]);

  // Reflect debounced query to URL for shareable links.
  // Use a ref for updateParams to break the dependency cycle:
  // updateParams depends on navigate, which is stable, but more
  // importantly we want this effect to ONLY re-fire when
  // `debouncedQ` actually changes — not when `updateParams`'
  // identity changes. The ref pattern from memory 644 keeps the
  // catalog free of infinite navigation loops.
  const updateParamsRef = React.useRef(updateParams);
  updateParamsRef.current = updateParams;
  React.useEffect(() => {
    updateParamsRef.current({ q: debouncedQ || null });
  }, [debouncedQ]);

  // Adopt external changes to the URL `q` param as the single source of
  // truth (ATR-012-search): the global top-bar SearchBar drives the same
  // `q` param, and back/forward + deep links can change it too. When the
  // URL diverges from the local input, sync the input (and its debounced
  // mirror) so search results follow. This converges — once they match,
  // neither this nor the debounce effect above re-fires — so there is no
  // ping-pong with the local→URL sync.
  React.useEffect(() => {
    setQ((prev) => (prev === queryQ ? prev : queryQ));
    setDebouncedQ((prev) => (prev === queryQ ? prev : queryQ));
  }, [queryQ]);

  const selectRepo = React.useCallback(
    (slug: string | null) => {
      updateParams({ repo: slug });
    },
    [updateParams],
  );

  const openInEditor = React.useCallback(
    (slug: string) => {
      const r = initialRepos.find((x) => x.slug === slug);
      if (!r) return;
      // Pure-action callback exception: dial straight through the
      // preload bridge. The `git:openInEditor` channel takes the slug
      // and looks up the path on the main side, so we don't have to
      // marshall `fullPath`.
      try {
        const atr = requireAtr();
        // Fire-and-forget — UI doesn't need to wait on the launcher.
        void atr.git.openInEditor({ slug });
      } catch {
        // Bridge unavailable (e.g. browser-only QE run). Fall back to
        // the legacy `vscode://file/...` URL the Next.js app used.
        window.location.href = `vscode://file/${r.fullPath}`;
      }
    },
    [initialRepos],
  );

  const closeDetail = React.useCallback(() => selectRepo(null), [selectRepo]);

  const slugs = React.useMemo(
    () => displayedRepos.map((r) => r.slug),
    [displayedRepos],
  );

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      <GroupSidebar
        groups={groups}
        totalCount={totalCount}
        selectedGroupId={filters.groupId}
        onSelectGroup={(id) =>
          updateParams({ groupId: id === null ? null : String(id) })
        }
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-background/95 px-6 py-4 backdrop-blur-sm">
          <SearchBar
            value={q}
            onChange={setQ}
            onDebouncedChange={setDebouncedQ}
            loading={isSearching && (searching || searchQuery.isFetching)}
          />
          <FilterChips
            filters={filters}
            groups={groups}
            onRemove={(patch) =>
              updateParams({
                lang: patch.language !== undefined ? patch.language : undefined,
                tag: patch.tags !== undefined ? patch.tags : undefined,
                groupId:
                  patch.groupId !== undefined
                    ? patch.groupId === null
                      ? null
                      : String(patch.groupId)
                    : undefined,
                dirty:
                  patch.dirtyOnly !== undefined
                    ? patch.dirtyOnly
                      ? "1"
                      : null
                    : undefined,
              })
            }
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex items-center justify-between pb-3 text-xs text-muted-foreground font-mono">
            <span>
              {isSearching ? (
                <>
                  {displayedRepos.length} result
                  {displayedRepos.length === 1 ? "" : "s"} for “{trimmedQuery}”
                </>
              ) : (
                <>
                  {displayedRepos.length} of {initialRepos.length} repo
                  {initialRepos.length === 1 ? "" : "s"}
                </>
              )}
            </span>
            <span className="hidden sm:inline">
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5">
                j
              </kbd>{" "}
              /{" "}
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5">
                k
              </kbd>{" "}
              nav ·{" "}
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5">
                ⏎
              </kbd>{" "}
              open
            </span>
          </div>
          <RepoGrid
            repos={displayedRepos}
            selectedSlug={querySlug}
            onSelect={selectRepo}
            onOpenEditor={openInEditor}
            loading={isSearching && (searching || searchQuery.isPending)}
          />
        </div>
      </main>

      <DetailPanel
        repo={detail}
        loading={detailLoading && !detail}
        onClose={closeDetail}
      />

      <KeyboardShortcuts
        slugs={slugs}
        selectedSlug={querySlug}
        onSelectSlug={selectRepo}
        onOpenSelected={() => querySlug && openInEditor(querySlug)}
        onCloseDetail={closeDetail}
      />
    </div>
  );
}
