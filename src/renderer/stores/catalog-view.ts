/**
 * Catalog view preferences — Zustand store.
 *
 * Separate from `stores/ui.ts` because these are catalog-shaped
 * decisions (how do I want to LOOK at my repos right now) rather than
 * app chrome, and because they persist under their own key so adding a
 * view mode never invalidates the app-level UI preferences.
 *
 * Everything here survives a reload: the way you last left the catalog
 * is almost always the way you want to find it.
 *
 * Server state (repos, groups) lives in TanStack Query, never here.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { Ownership } from "@renderer/lib/ownership";

/**
 * Density modes, each tuned for a different job:
 *
 * - `gallery` — large covers. For browsing and remembering: "which one
 *   was the voxel thing?" Fewest repos per screen, highest recall.
 * - `grid`    — a cover thumbnail plus full metadata. The default;
 *   balances recognition against how much you can see at once.
 * - `table`   — one line per repo, sortable columns. For working ON the
 *   catalog: auditing, comparing, bulk-selecting, reorganising.
 */
export type ViewMode = "gallery" | "grid" | "table";

/** Secondary axis: how rows are bucketed inside the current view. */
export type GroupBy = "none" | "folder" | "ownership" | "activity" | "language";

export type SortKey =
  | "favorite"
  | "touched"
  | "name"
  | "size"
  | "language"
  | "folder"
  | "owner";

interface CatalogViewState {
  mode: ViewMode;
  groupBy: GroupBy;
  sort: SortKey;
  order: "asc" | "desc";
  /** Directory paths currently expanded in the rail. */
  expandedDirs: string[];
  /** Selected directory subtree, or `null` for the whole catalog. */
  selectedDir: string | null;
  /**
   * Whether `selectedDir` means "exactly this folder" or "this folder and
   * everything under it". False for a folder selection, true for the
   * rail's "directly in this folder" row.
   */
  selectedDirExact: boolean;
  /** Ownership facet; empty means no ownership restriction. */
  ownershipFilter: Ownership[];
  /**
   * Whether archived folders (`_archive`, `old`, `duplicates`, …) are
   * included. Off by default — on a real machine those are a third of
   * the catalog and none of them are work you're doing today.
   */
  includeArchived: boolean;
  /** Show only pinned repos. */
  favoritesOnly: boolean;
  /** Slugs picked for a bulk operation (move, tag, group). */
  selection: string[];

  setMode(mode: ViewMode): void;
  setGroupBy(groupBy: GroupBy): void;
  setSort(sort: SortKey, order?: "asc" | "desc"): void;
  toggleDir(path: string): void;
  expandDirs(paths: string[]): void;
  setSelectedDir(path: string | null, exact?: boolean): void;
  toggleOwnership(kind: Ownership): void;
  clearOwnership(): void;
  setIncludeArchived(include: boolean): void;
  setFavoritesOnly(only: boolean): void;
  toggleSelected(slug: string, additive: boolean): void;
  setSelection(slugs: string[]): void;
  clearSelection(): void;
}

const PERSIST_KEY = "atr:catalog-view:v1";

export const useCatalogView = create<CatalogViewState>()(
  persist(
    (set) => ({
      mode: "grid",
      groupBy: "folder",
      sort: "touched",
      order: "desc",
      expandedDirs: [],
      selectedDir: null,
      selectedDirExact: false,
      ownershipFilter: [],
      includeArchived: false,
      favoritesOnly: false,
      selection: [],

      setMode: (mode) => set({ mode }),
      setGroupBy: (groupBy) => set({ groupBy }),
      setSort: (sort, order) =>
        set((s) => ({
          sort,
          // Re-picking the active column flips direction, which is what
          // every table in every app does; picking a new column starts
          // from that column's natural direction instead.
          order:
            order ??
            (s.sort === sort
              ? s.order === "asc"
                ? "desc"
                : "asc"
              : sort === "name" || sort === "folder" || sort === "owner"
                ? "asc"
                : "desc"),
        })),
      toggleDir: (path) =>
        set((s) => ({
          expandedDirs: s.expandedDirs.includes(path)
            ? s.expandedDirs.filter((p) => p !== path)
            : [...s.expandedDirs, path],
        })),
      expandDirs: (paths) =>
        set((s) => ({
          expandedDirs: [...new Set([...s.expandedDirs, ...paths])],
        })),
      setSelectedDir: (path, exact = false) =>
        set({ selectedDir: path, selectedDirExact: exact, selection: [] }),
      toggleOwnership: (kind) =>
        set((s) => ({
          ownershipFilter: s.ownershipFilter.includes(kind)
            ? s.ownershipFilter.filter((k) => k !== kind)
            : [...s.ownershipFilter, kind],
        })),
      clearOwnership: () => set({ ownershipFilter: [] }),
      setIncludeArchived: (includeArchived) => set({ includeArchived }),
      setFavoritesOnly: (favoritesOnly) => set({ favoritesOnly }),
      toggleSelected: (slug, additive) =>
        set((s) => {
          if (!additive) {
            // Plain click on an already-solo-selected row clears it, so
            // there's always a way out of selection mode without reaching
            // for a modifier key.
            return {
              selection:
                s.selection.length === 1 && s.selection[0] === slug
                  ? []
                  : [slug],
            };
          }
          return {
            selection: s.selection.includes(slug)
              ? s.selection.filter((x) => x !== slug)
              : [...s.selection, slug],
          };
        }),
      setSelection: (slugs) => set({ selection: slugs }),
      clearSelection: () => set({ selection: [] }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      // Selection is a transient working set, never restored on launch.
      partialize: (state) => ({
        mode: state.mode,
        groupBy: state.groupBy,
        sort: state.sort,
        order: state.order,
        expandedDirs: state.expandedDirs,
        selectedDir: state.selectedDir,
        selectedDirExact: state.selectedDirExact,
        ownershipFilter: state.ownershipFilter,
        includeArchived: state.includeArchived,
        favoritesOnly: state.favoritesOnly,
      }),
      version: 1,
    },
  ),
);
