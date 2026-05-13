"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Group, Repo, RepoDetail } from "@/lib/types";
import { GroupSidebar } from "@/components/groups/group-sidebar";
import { KeyboardShortcuts } from "@/components/layout/keyboard-shortcuts";
import { SearchBar } from "@/components/search/search-bar";
import { DetailPanel } from "./detail-panel";
import { FilterChips, type ActiveFilters } from "./filter-chips";
import { RepoGrid } from "./repo-grid";

interface CatalogShellProps {
  initialRepos: Repo[];
  groups: Group[];
  totalCount: number;
  loadRepoDetail: (slug: string) => Promise<RepoDetail | null>;
}

export function CatalogShell({
  initialRepos,
  groups,
  totalCount,
  loadRepoDetail,
}: CatalogShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const querySlug = searchParams.get("repo");
  const queryQ = searchParams.get("q") ?? "";
  const queryLanguage = searchParams.get("lang");
  const queryTags = searchParams.getAll("tag");
  const queryGroupId = searchParams.get("groupId");
  const queryDirty = searchParams.get("dirty") === "1";

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
      const sp = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue; // undefined => leave alone
        sp.delete(key);
        if (value === null) continue; // null => remove
        if (Array.isArray(value)) {
          for (const v of value) sp.append(key, v);
        } else if (value !== "") {
          sp.set(key, value);
        }
      }
      const next = sp.toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Filter + search client-side against the initial server-rendered set.
  // Once backend `/api/search` is wired, replace `filteredRepos` with a fetch.
  const filteredRepos = React.useMemo(() => {
    const needle = debouncedQ.trim().toLowerCase();
    const groupMembership = (repo: Repo): boolean => {
      if (filters.groupId === null) return true;
      const g = groups.find((x) => x.id === filters.groupId);
      if (!g) return true;
      if (g.isSmart && g.smartFilter) {
        const f = g.smartFilter;
        if (f.language && repo.primaryLanguage !== f.language) return false;
        if (f.dirtyOnly && !repo.isDirty) return false;
        if (f.hasRemote !== undefined && !!repo.remoteUrl !== f.hasRemote) return false;
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
      if (filters.language && r.primaryLanguage !== filters.language) return false;
      if (filters.dirtyOnly && !r.isDirty) return false;
      if (filters.tags.length) {
        const have = new Set(r.tags.map((t) => t.value));
        if (!filters.tags.every((t) => have.has(t))) return false;
      }
      if (!groupMembership(r)) return false;
      if (needle) {
        const hay = [
          r.name,
          r.description ?? "",
          r.primaryLanguage ?? "",
          ...r.tags.map((t) => t.value),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [initialRepos, debouncedQ, filters, groups]);

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
  // updateParams depends on searchParams, which changes on every
  // router.replace, which would re-fire this effect infinitely.
  const updateParamsRef = React.useRef(updateParams);
  updateParamsRef.current = updateParams;
  React.useEffect(() => {
    updateParamsRef.current({ q: debouncedQ || null });
  }, [debouncedQ]);

  const selectRepo = React.useCallback(
    (slug: string | null) => {
      updateParams({ repo: slug });
    },
    [updateParams],
  );

  const openInEditor = React.useCallback((slug: string) => {
    const r = initialRepos.find((x) => x.slug === slug);
    if (!r) return;
    window.location.href = `vscode://file/${r.fullPath}`;
  }, [initialRepos]);

  const closeDetail = React.useCallback(() => selectRepo(null), [selectRepo]);

  const slugs = React.useMemo(
    () => filteredRepos.map((r) => r.slug),
    [filteredRepos],
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
            loading={searching}
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
              {filteredRepos.length} of {initialRepos.length} repo
              {initialRepos.length === 1 ? "" : "s"}
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
            repos={filteredRepos}
            selectedSlug={querySlug}
            onSelect={selectRepo}
            onOpenEditor={openInEditor}
            loading={searching && debouncedQ !== q}
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
