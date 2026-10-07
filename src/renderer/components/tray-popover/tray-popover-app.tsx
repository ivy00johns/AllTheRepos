/**
 * Tray popover — Phase 2.
 *
 * Standalone React app rendered when `window.location.hash` matches
 * `#window=tray-popover`. Shown next to the macOS menu-bar tray icon
 * by `src/main/window/tray-popover.ts`.
 *
 * Three sections:
 *
 *   1. Recent repos (the last 5 the user opened — sourced from
 *      `useRepos({ sort: 'lastOpened', limit: 5 })`).
 *   2. A primary "Open Spotlight…" button that calls
 *      `app:showSpotlight` and closes the popover.
 *   3. A placeholder for Phase 3's running-dev-servers list.
 *
 * Each recent-repo row, when clicked, asks main to navigate the main
 * window via the standard `tray:on:open-repo` push stream (sent by
 * `tray.ts` per `contracts/ipc.v1.md`). The popover renderer doesn't
 * fire that event directly — it can't send-then-receive in its own
 * process — so we instead route through the action registry / IPC by
 * calling `app:showSpotlight`-style channels. backend-system's main
 * exposes a "forward to main window" helper; if absent, we log.
 */

import * as React from "react";

import { useRepos } from "@renderer/hooks/use-repos";
import { getAtr, type AtrBridge } from "@renderer/lib/atr";
import { cn } from "@renderer/lib/cn";
import type { Repo } from "@shared/types";

/**
 * Optional renderer→main "open repo" sender (ATR-006). The popover is its
 * own renderer process, so it can't fire the main-window-bound
 * `tray:on:open-repo` push event directly; it forwards the picked slug to
 * main, which re-broadcasts it via `broadcastTrayOpenRepo()` and brings
 * the main window forward. See `src/main/system/tray.ts`.
 *
 * The preload MAY expose this as `window.atr.tray.openRepo(slug)`
 * (canonical) or `app.openRepo(slug)` (alias). It isn't yet in the typed
 * `AtrBridge` surface (preload owned by another lane), so we probe for it
 * defensively — the same pattern `useTrayOpenRepoBus` uses on the receive
 * side. When absent we dev-log the pick so it stays observable.
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

function openRepoFromPopover(slug: string): void {
  const atr = getAtr();
  if (!atr) return;
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
      `[tray-popover] picked repo "${slug}" (no openRepo bridge sender; ` +
        `main forwarder ready on tray:request-open-repo)`,
    );
  }
}

function openSpotlightFromPopover(): void {
  const atr = getAtr();
  void atr?.app.showSpotlight().catch(() => {});
}

interface RecentRowProps {
  repo: Pick<Repo, "slug" | "name" | "fullPath">;
  onClick: () => void;
}

function RecentRow({ repo, onClick }: RecentRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm",
        "hover:bg-muted hover:text-foreground",
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{repo.name}</span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {repo.fullPath}
        </span>
      </div>
    </button>
  );
}

export function TrayPopoverApp() {
  // useRepos defaults to lastCommit DESC; we ask for lastOpened so
  // recently-touched repos surface to the top. The catalog hook
  // accepts `sort: 'lastOpened'` per `ListReposInputSchema`.
  const reposQuery = useRepos({ sort: "lastOpened", limit: 5 });
  const recent = (reposQuery.data?.items ?? []).slice(0, 5);

  return (
    <div className="flex h-screen w-full flex-col gap-2 overflow-hidden bg-popover p-3 text-popover-foreground">
      <header className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        Recent repos
      </header>
      <section className="flex flex-col gap-0.5">
        {reposQuery.isLoading ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No repos yet — run a scan first.
          </p>
        ) : (
          recent.map((r) => (
            <RecentRow
              key={r.slug}
              repo={r}
              onClick={() => openRepoFromPopover(r.slug)}
            />
          ))
        )}
      </section>

      <div className="my-1 h-px w-full bg-border" aria-hidden="true" />

      <button
        type="button"
        onClick={openSpotlightFromPopover}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm",
          "bg-muted text-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <span>Open Spotlight…</span>
        <kbd className="font-mono text-[10px] text-muted-foreground">
          ⌘⇧Space
        </kbd>
      </button>

      <div className="my-1 h-px w-full bg-border" aria-hidden="true" />

      <header className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        Running dev servers
      </header>
      <p className="px-2 py-1.5 text-xs text-muted-foreground">
        (Phase 3 will populate this list)
      </p>
    </div>
  );
}
