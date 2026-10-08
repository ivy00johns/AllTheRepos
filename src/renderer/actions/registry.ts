/**
 * Renderer-owned action registry — Phase 2.
 *
 * The single source of truth for the Phase 2 "feels like a real Mac app"
 * surface. Three consumers share this list:
 *
 *   1. The native macOS Application menu, built by main from the
 *      metadata pushed via `app:registerActions`. Handlers stay on the
 *      renderer side — main only ever sees the (id, label, scope,
 *      shortcut, …) bag.
 *   2. The in-app Cmd-K command palette (cmdk + Radix Dialog).
 *   3. The global Spotlight window, when the user prefixes the query
 *      with `>` to drop into action-search mode.
 *
 * The eight baseline actions enumerated in `contracts/actions.v1.md`
 * Phase-2 table are MANDATORY. Wave-2C may add more (open-in-finder,
 * theme-toggle, etc.).
 *
 * Handlers are intentionally tiny — they navigate via TanStack Router
 * or flip Zustand state. Heavy lifting (refetch, IPC, clipboard) lives
 * here only when it has no useful home elsewhere.
 *
 * IMPORTANT: this module is plain TS (no React hooks). The
 * `ActionContext` is constructed by the consumer (palette / menu bus /
 * deep-link bus) at dispatch time and passed in.
 */

import type { Action, RepoDetail } from "@shared/types";

import { queryClient, queryKeys } from "@renderer/lib/query-client";
import { getAtr } from "@renderer/lib/atr";

/**
 * Vite injects `import.meta.env.DEV` at build time. The renderer tsconfig
 * (`tsconfig.web.json`) pulls in the `vite/client` ambient types so
 * `import.meta.env` is typed there, but this module is ALSO transitively
 * compiled by the root tsconfig (via `@main/system/menu` importing the
 * registry for its metadata), which loads neither `vite/client` nor
 * `vite-env.d.ts`. Read the flag once through a locally-typed view so the
 * access type-checks under both programs without depending on the ambient
 * augmentation being in scope.
 */
const isDev: boolean | undefined = (
  import.meta as unknown as { env?: { DEV?: boolean } }
).env?.DEV;

/**
 * Whether this bundle was built in development mode.
 *
 * The top bar reads this to decide whether to draw its dev-only affordance
 * (ATR-074). Exported rather than recomputed there so the two answers cannot
 * drift: `electron-vite dev` sets it, `electron-vite build` does not, and a
 * packaged release is always the latter.
 */
export const isDevBuild: boolean = isDev === true;

/**
 * Strict subset of the TanStack Router `useNavigate` return type that
 * action handlers actually need.
 *
 * We type the parameter as `any` (rather than `unknown` or the
 * router's `NavigateOptions`) for two reasons:
 *
 *   1. TanStack's `useNavigate` return type is a heavily-generic
 *      function whose parameter is `NavigateOptions<Router, From, To>`
 *      — pinning the registry to those generics couples the action
 *      module to the route tree.
 *   2. Using `unknown` would make this incompatible with
 *      `UseNavigateResult` at the call site (since `unknown` cannot
 *      be assigned to a more constrained parameter type).
 *
 *      `any` here is a one-line escape hatch: handlers pass real
 *      `{ to, params }` objects through and TanStack types the result
 *      on its side; we don't lose any safety at the call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NavigateLike = (opts: any) => Promise<void> | void;

/**
 * Subset of the UI store actions that handlers reach for. Decoupled
 * from `useUiStore` directly so the registry is unit-testable without
 * a real Zustand instance.
 */
interface UiStoreActions {
  toggleSidebar(): void;
  openPalette(): void;
  closePalette(): void;
  togglePalette(): void;
}

/**
 * Per-call context. Built by the consumer right before dispatch.
 *
 * `currentRepoSlug` is the slug of the focused repo (catalog selection
 * or `/repos/$slug` route param). `repo.copy-path` uses it.
 *
 * `currentRepoFullPath` is the absolute filesystem path the action
 * `repo.copy-path` writes to the clipboard. The consumer reads it
 * from the cached `RepoDetail` ahead of time so the handler stays
 * synchronous.
 */
export interface ActionContext {
  navigate: NavigateLike;
  ui: UiStoreActions;
  /** Slug of the currently-focused repo, if any. */
  currentRepoSlug?: string | null;
  /** Absolute filesystem path of the currently-focused repo. */
  currentRepoFullPath?: string | null;
  /**
   * Surface a transient, user-visible message. Optional so the registry
   * stays framework-free and unit-testable; consumers (menu / palette /
   * deep-link buses) wire it to the UI store. Used by handlers that
   * cannot run in the current context — a silently no-op'd menu item is
   * indistinguishable from a broken one.
   */
  notify?: (message: string) => void;
}

export type ActionHandler = (ctx: ActionContext) => void | Promise<void>;

export interface RegisteredAction extends Action {
  handler: ActionHandler;
}

/**
 * Try to focus the catalog search input. The catalog SearchBar mounts
 * an `<input>` with `data-search-input="catalog"` (Phase-1 convention —
 * the keyboard-shortcuts module relies on the same attribute for the
 * `/` shortcut). We do a best-effort `querySelector` and skip silently
 * if the input isn't mounted (i.e. the user is on /settings).
 */
function focusCatalogSearch(): void {
  const el = document.querySelector<HTMLInputElement>(
    'input[data-search-input="catalog"], input[type="search"]',
  );
  el?.focus();
  el?.select();
}

/**
 * Invalidate the cached repo-list queries so the catalog re-fetches.
 * This is the same refresh path the catalog page's "Refresh" button
 * uses; both routes are equivalent from a cache standpoint.
 */
async function refreshCatalog(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
}

/**
 * Copy text to the OS clipboard. Uses the browser Clipboard API which
 * works inside Electron's renderer; falls back to a hidden textarea
 * for the (paranoid) case where the API isn't available.
 */
async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(el);
  }
}

/**
 * Phase 2 baseline action registry. ORDER MATTERS — main uses the
 * array order as a stable sort within each `group` when rendering the
 * native menu. The grouping below mirrors the table in
 * `contracts/actions.v1.md`.
 */
export const actions: RegisteredAction[] = [
  // ---------------- App namespace (global) ----------------
  {
    id: "app.open-spotlight",
    label: "Open Spotlight",
    scope: "global",
    shortcut: "CmdOrCtrl+Shift+Space",
    group: "App",
    hint: "Search across all repos from anywhere",
    icon: "search",
    handler: async () => {
      const atr = getAtr();
      await atr?.app.showSpotlight();
    },
  },
  {
    id: "app.open-command-palette",
    label: "Open Command Palette",
    scope: "global",
    shortcut: "CmdOrCtrl+K",
    group: "App",
    hint: "Run any action from the keyboard",
    icon: "command",
    handler: (ctx) => {
      ctx.ui.openPalette();
    },
  },
  {
    id: "app.open-settings",
    label: "Open Settings",
    scope: "global",
    shortcut: "CmdOrCtrl+,",
    group: "App",
    icon: "settings",
    handler: (ctx) => {
      void ctx.navigate({ to: "/settings" });
    },
  },
  {
    id: "app.toggle-devtools",
    label: "Toggle DevTools",
    scope: "global",
    shortcut: "CmdOrCtrl+Alt+I",
    group: "App",
    devOnly: true,
    icon: "code",
    handler: async () => {
      const atr = getAtr();
      // Optional helper — preload only exposes it in dev builds.
      // If absent the action is a no-op.
      if (atr?.app.toggleDevtools) {
        await atr.app.toggleDevtools();
      }
    },
  },

  {
    id: "app.open-debug",
    label: "Open Debug Page",
    scope: "global",
    group: "App",
    devOnly: true,
    hint: "The Phase 0 bridge/ping smoke test",
    handler: (ctx) => {
      void ctx.navigate({ to: "/debug" });
    },
  },

  // ---------------- Catalog namespace ----------------
  {
    id: "catalog.refresh",
    label: "Refresh Catalog",
    scope: "catalog",
    shortcut: "CmdOrCtrl+R",
    group: "Catalog",
    icon: "refresh-cw",
    handler: async () => {
      await refreshCatalog();
    },
  },
  {
    id: "catalog.focus-search",
    label: "Focus Search",
    scope: "catalog",
    shortcut: "/",
    group: "Catalog",
    icon: "search",
    handler: () => {
      focusCatalogSearch();
    },
  },
  {
    id: "catalog.toggle-sidebar",
    label: "Toggle Sidebar",
    scope: "catalog",
    shortcut: "CmdOrCtrl+\\",
    group: "Catalog",
    icon: "panel-left",
    handler: (ctx) => {
      ctx.ui.toggleSidebar();
    },
  },

  // ---------------- Repo namespace ----------------
  {
    id: "repo.copy-path",
    label: "Copy Repo Path",
    scope: "repo-detail",
    shortcut: "CmdOrCtrl+Shift+C",
    group: "Repo",
    icon: "clipboard",
    handler: async (ctx) => {
      if (!ctx.currentRepoFullPath) {
        ctx.notify?.("Select a repo first to copy its path.");
        return;
      }
      await copyToClipboard(ctx.currentRepoFullPath);
    },
  },
  {
    id: "repo.open-in-editor",
    label: "Open in Editor",
    scope: "repo-detail",
    shortcut: "CmdOrCtrl+Shift+O",
    group: "Repo",
    icon: "external-link",
    handler: async (ctx) => {
      // No focused repo → nothing to launch. Say so rather than
      // no-op'ing silently, which reads as a broken menu item.
      if (!ctx.currentRepoSlug) {
        ctx.notify?.("Select a repo first to open it in your editor.");
        return;
      }
      const atr = getAtr();
      if (!atr) return;
      // Delegates to LauncherService in main, which picks the user's
      // Settings.defaultEditor. The result `{ ok, reason }` is ignored
      // at the dispatch site — the repo-card buttons own inline error
      // surfacing; from Cmd-K / the native menu a failure is logged.
      const result = await atr.launcher.openInEditor({
        slug: ctx.currentRepoSlug,
      });
      if (!result.ok && isDev) {
        console.warn(
          `[actions] repo.open-in-editor failed: ${result.reason ?? "unknown"}`,
        );
      }
    },
  },
  {
    id: "repo.open-in-finder",
    label: "Reveal in Finder",
    scope: "repo-detail",
    shortcut: "CmdOrCtrl+Shift+R",
    group: "Repo",
    icon: "folder-open",
    handler: async (ctx) => {
      if (!ctx.currentRepoSlug) {
        ctx.notify?.("Select a repo first to reveal it in Finder.");
        return;
      }
      const atr = getAtr();
      if (!atr) return;
      const result = await atr.launcher.openInFinder({
        slug: ctx.currentRepoSlug,
      });
      if (!result.ok && isDev) {
        console.warn(
          `[actions] repo.open-in-finder failed: ${result.reason ?? "unknown"}`,
        );
      }
    },
  },
];

/**
 * The slice of `ActionContext` that identifies the currently-focused
 * repo. Built by `resolveFocusedRepo` and spread into the full context
 * at each dispatch site.
 */
export interface FocusedRepo {
  currentRepoSlug: string | null;
  currentRepoFullPath: string | null;
}

const EMPTY_FOCUSED_REPO: FocusedRepo = {
  currentRepoSlug: null,
  currentRepoFullPath: null,
};

/**
 * Extract the focused repo slug from a memory-history location.
 *
 * Two surfaces carry the focused repo:
 *   - the `/repos/$slug` route → the slug is the second path segment,
 *   - the catalog `/` page → the `repo` URL search param (the catalog
 *     shell mirrors its selected card into `?repo=<slug>`).
 *
 * Returns `null` when neither is present (settings, processes, claude,
 * an empty catalog selection, …).
 */
export function focusedSlugFromLocation(loc: {
  pathname: string;
  search?: Record<string, unknown> | null;
}): string | null {
  const { pathname } = loc;
  if (pathname.startsWith("/repos/")) {
    const rest = pathname.slice("/repos/".length);
    // Guard against trailing segments / slashes — the slug is the first
    // path component after `/repos/`.
    const slug = rest.split("/")[0]?.trim();
    return slug ? slug : null;
  }
  if (pathname === "/" || pathname.startsWith("/?")) {
    const repo = loc.search?.repo;
    return typeof repo === "string" && repo.length > 0 ? repo : null;
  }
  return null;
}

/**
 * Resolve the absolute filesystem path for a focused slug from the
 * TanStack Query cache.
 *
 * `repo.copy-path` needs a synchronous `fullPath`, so we read the
 * already-cached `RepoDetail` written by `useRepo` rather than issuing
 * a fresh IPC round-trip at dispatch time. If the repo hasn't been
 * fetched yet (cache miss) we return `null` and `repo.copy-path`
 * degrades to a safe no-op — the slug-only launch actions still work.
 *
 * The cache reader is injected so the registry stays unit-testable
 * without a live `QueryClient`; the default reads the singleton.
 */
export function resolveFocusedRepo(
  slug: string | null,
  getCachedRepo: (slug: string) => RepoDetail | null | undefined = (s) =>
    queryClient.getQueryData<RepoDetail | null>(queryKeys.repos.detail(s)),
): FocusedRepo {
  if (!slug) return EMPTY_FOCUSED_REPO;
  const cached = getCachedRepo(slug);
  return {
    currentRepoSlug: slug,
    currentRepoFullPath: cached?.fullPath ?? null,
  };
}

/**
 * Lookup an action by id. Returns `undefined` for unknown ids.
 *
 * Kept separate from `dispatchAction` so consumers that need to
 * inspect an action's metadata (e.g. the palette renderer) don't pay
 * for an unnecessary handler call.
 */
export function findAction(id: string): RegisteredAction | undefined {
  return actions.find((a) => a.id === id);
}

/**
 * Run the handler registered for the given action id with the supplied
 * context. Unknown ids log a dev warning and otherwise no-op —
 * we follow the contract guidance that registry drift between the
 * renderer and a stale main-process registration MUST NOT crash the
 * renderer.
 */
export function dispatchAction(id: string, ctx: ActionContext): void {
  const action = findAction(id);
  if (!action) {
    if (isDev) {
      console.warn(
        `dispatchAction: unknown action id "${id}". Has the registry drifted?`,
      );
    }
    return;
  }
  // Fire-and-forget — handlers return void or Promise<void>; we don't
  // wait on them at the dispatch site so a slow handler can't block
  // the menu / palette UI.
  void Promise.resolve(action.handler(ctx)).catch((err) => {
    console.error(`action "${id}" handler threw:`, err);
  });
}

/**
 * Strip the renderer-only `handler` field before sending the registry
 * over IPC. Main only needs the metadata to build the native menu and
 * bind accelerators.
 *
 * Also filters out `devOnly: true` actions in production builds per
 * `contracts/actions.v1.md` (the renderer is the source of truth for
 * which actions are dev-only).
 */
export function serializeActionsForIpc(isProd = !isDev): Action[] {
  return actions
    .filter((a) => !isProd || !a.devOnly)
    .map(({ handler: _handler, ...meta }) => meta);
}
