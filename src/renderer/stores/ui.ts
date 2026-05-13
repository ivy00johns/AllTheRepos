/**
 * Global UI state — Zustand store.
 *
 * Holds *only* presentational state that should survive route changes:
 *   - sidebar collapsed/expanded,
 *   - density preference (comfortable | compact),
 *   - active filter shorthand (the catalog grid mirrors this to URL
 *     query params via TanStack Router; the store is the source of
 *     truth for hover-only "did the user just twiddle this filter?"),
 *   - active repo slug (the currently-selected card in the catalog;
 *     synced with the detail panel + keyboard navigation),
 *
 * Persistence: anything that should outlive a window reload is mirrored
 * to `localStorage` via the `persist` middleware. Selection state
 * (`activeRepoSlug`) is intentionally NOT persisted — it would feel
 * stale on next launch.
 *
 * Server state (repos, groups, settings) lives in TanStack Query — not
 * here. Hooks call `window.atr.*` via dedicated `use-*` files and
 * cache the result with React Query. Mixing the two is a bug.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Density = "comfortable" | "compact";

export interface ActiveFilter {
  q: string;
  language: string | null;
  tags: string[];
  groupId: number | null;
  dirtyOnly: boolean;
  sort: "lastCommit" | "name" | "lastScanned" | "lastOpened";
  order: "asc" | "desc";
}

export const DEFAULT_FILTER: ActiveFilter = {
  q: "",
  language: null,
  tags: [],
  groupId: null,
  dirtyOnly: false,
  sort: "lastCommit",
  order: "desc",
};

interface PersistedUiState {
  sidebarCollapsed: boolean;
  density: Density;
  activeFilter: ActiveFilter;
}

interface TransientUiState {
  /** Currently-selected repo slug in the catalog grid (not persisted). */
  activeRepoSlug: string | null;
  /**
   * Whether the in-app Cmd-K command palette overlay is open.
   *
   * Lives in Zustand (not local component state) so the action
   * `app.open-command-palette` — which is dispatched from outside the
   * palette component (e.g. via a native-menu accelerator) — can flip
   * the flag without needing a ref. Transient: a fresh window starts
   * closed every time.
   */
  paletteOpen: boolean;
}

interface UiActions {
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSidebar(): void;
  setDensity(density: Density): void;
  setActiveFilter(filter: Partial<ActiveFilter>): void;
  resetFilter(): void;
  setActiveRepoSlug(slug: string | null): void;
  /** Open the in-app command palette. Idempotent. */
  openPalette(): void;
  /** Close the in-app command palette. Idempotent. */
  closePalette(): void;
  /** Toggle the in-app command palette. */
  togglePalette(): void;
}

export type UiState = PersistedUiState & TransientUiState & UiActions;

const PERSIST_KEY = "atr:ui:v1";

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      density: "comfortable",
      activeFilter: DEFAULT_FILTER,
      activeRepoSlug: null,
      paletteOpen: false,

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setDensity: (density) => set({ density }),
      setActiveFilter: (filter) =>
        set((s) => ({ activeFilter: { ...s.activeFilter, ...filter } })),
      resetFilter: () => set({ activeFilter: DEFAULT_FILTER }),
      setActiveRepoSlug: (slug) => set({ activeRepoSlug: slug }),
      openPalette: () => set({ paletteOpen: true }),
      closePalette: () => set({ paletteOpen: false }),
      togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist visual prefs + the filter — selection is transient.
      partialize: (state): PersistedUiState => ({
        sidebarCollapsed: state.sidebarCollapsed,
        density: state.density,
        activeFilter: state.activeFilter,
      }),
      version: 1,
    },
  ),
);
