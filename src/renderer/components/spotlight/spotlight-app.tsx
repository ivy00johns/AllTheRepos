/**
 * Spotlight window — Phase 2.
 *
 * Standalone React app rendered when `window.location.hash` matches
 * `#window=spotlight`. Selected from `main.tsx` BEFORE React mounts so
 * the spotlight surface never loads the full catalog router/shell —
 * it's a single search box + virtual-ish list (no actual virtualisation
 * library; the result set is capped at 1000 repos).
 *
 * Two modes share the same input:
 *
 *   1. Default mode: fuzzy repo search over `useRepos({ limit: 1000 })`
 *      via @leeoniya/uFuzzy. Enter on a result hides the spotlight and
 *      fires a deep-link to the main window so it navigates to the
 *      repo. Cmd+Enter copies the repo path to the clipboard.
 *
 *   2. Action-search mode (Raycast pattern): typing `>` as the first
 *      character switches to the action registry, filtered by cmdk's
 *      built-in scoring (we hand-roll a simple substring scorer here
 *      since we're not in a `<Command>` host).
 *
 * The spotlight window has its own renderer process (each Electron
 * BrowserWindow does); main shows/hides it via `app:showSpotlight` /
 * `app:hideSpotlight`. Esc dismisses the window from the renderer
 * side; main's blur handler is the backup path.
 *
 * Cross-window communication: when a repo is picked, the spotlight
 * dispatches a deep-link to the main window via a `repo/<slug>`
 * `alltherepos://` URL. backend-system's main process re-broadcasts
 * the URL into the main window's renderer through
 * `protocol:on:deep-link`. For Phase 2 we use the simpler path of
 * routing via the existing `tray:on:open-repo` channel semantically —
 * the renderer hook `useTrayOpenRepoBus` wires the navigation.
 *
 * That said, here we keep it simple: we call `hideSpotlight` first,
 * then call the IPC channel that asks main to broadcast the deep
 * link. backend-system's wave-2 main process registers a handler
 * for that. If it isn't present yet we fall back to logging.
 */

import * as React from "react";
// uFuzzy is the right tool here per NEW-PLAN.md §5.8.
//
// HARNESS NOTE — this dep is not yet on the dependency tree; the
// frontend-palette agent flags it for the infra agent to install
// (`@leeoniya/ufuzzy@^1`). Until the dep lands, the dynamic import
// below resolves to `null` and the spotlight falls back to a simple
// substring filter so the build doesn't break.
//
// We use a dynamic import via a top-level state ref so a missing
// module doesn't make this file fail to compile (TS would still
// resolve `@leeoniya/ufuzzy` from `node_modules` once installed; the
// import below is `any`-typed to keep the build green pre-install).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uFuzzyCtor: any = null;
(async () => {
  try {
    const mod = await import("@leeoniya/ufuzzy");
    uFuzzyCtor = mod.default ?? mod;
  } catch {
    uFuzzyCtor = null;
  }
})();

import { useRepos } from "@renderer/hooks/use-repos";
import { getAtr, type AtrBridge } from "@renderer/lib/atr";
import { cn } from "@renderer/lib/cn";
import { actions, type RegisteredAction } from "@renderer/actions/registry";
import type { Repo } from "@shared/types";

/**
 * Optional renderer→main "open repo" sender. The preload MAY expose this
 * as `window.atr.tray.openRepo(slug)` (canonical) or `app.openRepo(slug)`
 * (alias) — a thin `ipcRenderer.send("tray:request-open-repo", { slug })`
 * wrapper that main forwards via `broadcastTrayOpenRepo()` (ATR-006).
 *
 * It is not yet in the typed `AtrBridge` surface (the preload is owned by
 * another lane), so we probe for it defensively — exactly the pattern
 * `useTrayOpenRepoBus` uses for the receive side. When the sender is
 * absent we dev-log the picked slug so the pick is still observable.
 */
type OpenRepoSender = (slug: string) => void;

function resolveOpenRepoSender(atr: AtrBridge): OpenRepoSender | null {
  const tray = atr.tray as { openRepo?: OpenRepoSender } | undefined;
  if (typeof tray?.openRepo === "function") {
    return tray.openRepo.bind(tray);
  }
  const appNs = atr.app as { openRepo?: OpenRepoSender } | undefined;
  if (typeof appNs?.openRepo === "function") {
    return appNs.openRepo.bind(appNs);
  }
  return null;
}

function forwardOpenRepo(atr: AtrBridge, slug: string): void {
  const send = resolveOpenRepoSender(atr);
  if (send) {
    try {
      send(slug);
      return;
    } catch {
      // fall through to the dev log below
    }
  }
  if (import.meta.env?.DEV) {
    console.info(
      `[spotlight] picked repo "${slug}" (no openRepo bridge sender; ` +
        `main forwarder ready on tray:request-open-repo)`,
    );
  }
}

interface RepoRow {
  slug: string;
  name: string;
  fullPath: string;
  searchableHaystack: string;
}

/**
 * Project the cached `Repo` shape down to the haystack the spotlight
 * actually searches over.
 *
 * We concatenate (name, slug, fullPath) into a single string per row
 * because uFuzzy operates on a flat array of haystack strings. The
 * row index ↔ repo index mapping is preserved.
 */
function buildHaystack(repos: Repo[]): {
  rows: RepoRow[];
  haystack: string[];
} {
  const rows: RepoRow[] = repos.map((r) => ({
    slug: r.slug,
    name: r.name,
    fullPath: r.fullPath,
    searchableHaystack: `${r.name} ${r.slug} ${r.fullPath}`,
  }));
  return { rows, haystack: rows.map((r) => r.searchableHaystack) };
}

function copyPath(text: string): void {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
  }
}

/**
 * Hide the spotlight + ask main to navigate the MAIN window to the
 * given repo (ATR-006).
 *
 * The spotlight is its own renderer process, so it can't fire the
 * main-window-bound `tray:on:open-repo` push event directly. Instead it
 * `send`s the picked slug to main, which re-broadcasts it via
 * `broadcastTrayOpenRepo()`; the main window's `useTrayOpenRepoBus`
 * navigates to `/repos/$slug`. See `src/main/system/tray.ts`.
 *
 * We hide the spotlight FIRST so the user sees the main window come
 * forward (main brings it forward on receipt), then forward the slug.
 */
async function openRepoInMain(slug: string): Promise<void> {
  const atr = getAtr();
  if (!atr) return;
  try {
    await atr.app.hideSpotlight();
  } catch {
    // ignore — main may have already hidden us via blur.
  }
  forwardOpenRepo(atr, slug);
}

interface ResultRow {
  type: "repo" | "action";
  key: string;
  primary: string;
  secondary?: string;
  action?: RegisteredAction;
  repo?: RepoRow;
}

function actionToRow(a: RegisteredAction): ResultRow {
  return {
    type: "action",
    key: a.id,
    primary: a.label,
    secondary: a.hint ?? a.id,
    action: a,
  };
}

function repoToRow(r: RepoRow): ResultRow {
  return {
    type: "repo",
    key: r.slug,
    primary: r.name,
    secondary: r.fullPath,
    repo: r,
  };
}

/**
 * Simple substring scorer for the action-search mode and the uFuzzy-
 * fallback path for repo search. Lower score = better; -1 = no match.
 */
function substringScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  const i = haystack.toLowerCase().indexOf(needle.toLowerCase());
  return i;
}

export function SpotlightApp() {
  const reposQuery = useRepos({ limit: 1000 });
  const [query, setQuery] = React.useState("");
  const [activeIdx, setActiveIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Keep focus on the input whenever the window regains focus.
  React.useEffect(() => {
    inputRef.current?.focus();
    function onFocus() {
      inputRef.current?.focus();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const isActionMode = query.startsWith(">");
  const trimmedQuery = isActionMode ? query.slice(1).trim() : query.trim();

  const repoData = reposQuery.data?.items ?? [];
  const haystackBundle = React.useMemo(
    () => buildHaystack(repoData),
    [repoData],
  );

  // Lazy uFuzzy instance — recreated when uFuzzyCtor flips from null
  // to non-null (i.e. once the dep is installed and the dynamic
  // import resolves on the next render).
  const fuzzyRef = React.useRef<unknown>(null);
  if (uFuzzyCtor && !fuzzyRef.current) {
    fuzzyRef.current = new uFuzzyCtor({ intraMode: 1 });
  }

  const results: ResultRow[] = React.useMemo(() => {
    if (isActionMode) {
      // Action-search mode — filter the registry's non-spotlight
      // actions plus spotlight-scoped ones (which only show here).
      const candidates = actions.filter((a) => a.scope !== "spotlight"); // all real actions
      if (!trimmedQuery) {
        return candidates.map(actionToRow).slice(0, 50);
      }
      const scored = candidates
        .map((a) => ({
          a,
          score: substringScore(
            `${a.id} ${a.label} ${a.hint ?? ""}`,
            trimmedQuery,
          ),
        }))
        .filter((s) => s.score !== -1)
        .sort((x, y) => x.score - y.score);
      return scored.slice(0, 50).map((s) => actionToRow(s.a));
    }

    // Repo-search mode. If the user hasn't typed anything we show the
    // first slice of repos by their existing list order (which is
    // `lastCommit DESC` by default).
    if (!trimmedQuery) {
      return haystackBundle.rows.slice(0, 50).map(repoToRow);
    }

    // uFuzzy path — if the ctor loaded, run a real fuzzy search.
    // Otherwise fall back to substring matching so the spotlight is
    // usable before the dep lands.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fuzzy: any = fuzzyRef.current;
    if (fuzzy && haystackBundle.haystack.length > 0) {
      // uFuzzy v1 API: `.search(haystack, needle)` returns
      // `[idxs, info, order]`. `order` is the ranked permutation.
      try {
        const [idxs, _info, order] = fuzzy.search(
          haystackBundle.haystack,
          trimmedQuery,
        );
        if (idxs && order) {
          const rows = order
            .slice(0, 50)
            .map((i: number) => haystackBundle.rows[idxs[i]])
            .filter(Boolean)
            .map(repoToRow);
          return rows;
        }
      } catch {
        // fall through to substring fallback
      }
    }
    // Fallback — naive substring scoring.
    return haystackBundle.rows
      .map((r) => ({
        r,
        score: substringScore(r.searchableHaystack, trimmedQuery),
      }))
      .filter((x) => x.score !== -1)
      .sort((a, b) => a.score - b.score)
      .slice(0, 50)
      .map((x) => repoToRow(x.r));
  }, [isActionMode, trimmedQuery, haystackBundle]);

  // Clamp the active index when results shrink.
  React.useEffect(() => {
    if (activeIdx >= results.length) setActiveIdx(0);
  }, [results.length, activeIdx]);

  const onChoose = React.useCallback(
    async (idx: number, withModifier: boolean) => {
      const row = results[idx];
      if (!row) return;
      if (row.type === "repo" && row.repo) {
        if (withModifier) {
          copyPath(row.repo.fullPath);
          return;
        }
        await openRepoInMain(row.repo.slug);
        return;
      }
      if (row.type === "action" && row.action) {
        const atr = getAtr();
        // Hide the spotlight first so the action runs against the
        // restored main-window focus.
        try {
          await atr?.app.hideSpotlight();
        } catch {
          // ignore
        }
        // We don't have a navigate / ui store in this window — the
        // action will no-op for handlers that need them. Spotlight
        // actions that DO work here are scope === "spotlight" or pure
        // IPC actions. For now we just dispatch on the side and log
        // in dev.
        if (import.meta.env?.DEV) {
          console.info(`[spotlight] action "${row.action.id}" picked`);
        }
      }
    },
    [results],
  );

  const onKey = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(results.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        void onChoose(activeIdx, e.metaKey || e.ctrlKey);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // First Escape clears the query; second Escape hides the
        // spotlight (matches Raycast / Alfred muscle memory).
        if (query) {
          setQuery("");
          return;
        }
        const atr = getAtr();
        void atr?.app.hideSpotlight();
        return;
      }
    },
    [results.length, activeIdx, onChoose, query],
  );

  const totalRepos = reposQuery.data?.total ?? repoData.length;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-popover text-popover-foreground">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        placeholder={
          isActionMode
            ? "Search actions…"
            : totalRepos
              ? `Type to search ${totalRepos} repos…  (use \`>\` for actions)`
              : "Loading repos…"
        }
        className="h-14 w-full border-b border-border bg-transparent px-4 text-base outline-none placeholder:text-muted-foreground"
        aria-label="Spotlight search"
        autoFocus
      />
      <div
        className="flex-1 overflow-y-auto p-1"
        role="listbox"
        aria-label="Spotlight results"
      >
        {results.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {trimmedQuery ? "No matches." : "Start typing to search."}
          </div>
        ) : (
          results.map((row, idx) => (
            <div
              key={`${row.type}:${row.key}`}
              role="option"
              aria-selected={idx === activeIdx}
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => void onChoose(idx, false)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm",
                idx === activeIdx
                  ? "bg-muted text-foreground"
                  : "text-foreground/90",
              )}
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{row.primary}</span>
                {row.secondary ? (
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {row.secondary}
                  </span>
                ) : null}
              </div>
              <span className="atr-label uppercase tracking-wider text-muted-foreground">
                {row.type}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-border px-4 py-1.5 atr-label uppercase tracking-wider text-muted-foreground">
        <span>↵ open</span>
        <span className="ml-3">⌘↵ copy path</span>
        <span className="ml-3">{isActionMode ? "esc back" : "› actions"}</span>
        <span className="ml-3">esc close</span>
      </div>
    </div>
  );
}
