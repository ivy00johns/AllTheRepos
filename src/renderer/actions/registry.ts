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

import type { Action } from "@shared/types";

import { queryClient, queryKeys } from "@renderer/lib/query-client";
import { getAtr } from "@renderer/lib/atr";

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
      if (!ctx.currentRepoFullPath) return;
      await copyToClipboard(ctx.currentRepoFullPath);
    },
  },
];

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
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
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
export function serializeActionsForIpc(
  isProd = !import.meta.env?.DEV,
): Action[] {
  return actions
    .filter((a) => !isProd || !a.devOnly)
    .map(({ handler: _handler, ...meta }) => meta);
}
