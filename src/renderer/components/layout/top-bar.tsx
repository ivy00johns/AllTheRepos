/**
 * Top bar — global app header.
 *
 * Lives above every route. Provides:
 *   - app title + sidebar collapse toggle,
 *   - the global search bar (single source of truth — see below),
 *   - navigation affordances to /settings and /debug (Phase 1 only).
 *
 * Visual treatment is deliberately minimal — the frontend-components
 * agent will skin this with the real design language in a follow-up
 * pass. Keep this file focused on slots + behaviour.
 */

import * as React from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Activity,
  Brain,
  Menu,
  Settings as SettingsIcon,
  Terminal,
  ArrowDownToLine,
  RotateCw,
  Network,
} from "lucide-react";

import { Button } from "@renderer/components/ui/button";
import { SearchBar } from "@renderer/components/search/search-bar";
import { useProcessCount } from "@renderer/hooks/use-processes";
import { cn } from "@renderer/lib/cn";
import { useUiStore } from "@renderer/stores/ui";
import { useUpdate } from "@renderer/hooks/use-update";

/**
 * The main window uses `titleBarStyle: "hiddenInset"` on macOS, which
 * overlays the traffic-light buttons on top of the web content in the
 * top-left ~76px. Without reserved space the sidebar toggle (and, at
 * narrower widths, the title) sits *under* the OS window controls, so
 * clicks land on the close/minimise/zoom buttons instead of the app.
 *
 * Reserve that strip on darwin only — other platforms have a normal
 * title bar above the content and need the full width.
 */
const MAC_TRAFFIC_LIGHT_INSET = "pl-[76px]";
const IS_MAC =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

/**
 * Top-level destinations.
 *
 * Labels are shown alongside the icons from `lg` up. Icon-only
 * navigation is a discoverability trap — nobody guesses that a brain
 * glyph means "Claude usage" — so the label is the default and only
 * collapses away when the window is genuinely too narrow for it.
 */
const NAV_ITEMS = [
  { to: "/processes", label: "Running", Icon: Activity, badge: "processes" },
  { to: "/graph", label: "Map", Icon: Network, badge: null },
  { to: "/claude", label: "Claude", Icon: Brain, badge: null },
  { to: "/settings", label: "Settings", Icon: SettingsIcon, badge: null },
  { to: "/debug", label: "Debug", Icon: Terminal, badge: null },
] as const;

export function TopBar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const update = useUpdate();
  const processCount = useProcessCount();

  // ATR-012-search: ONE search source of truth. The catalog reads its
  // query from the TanStack Router `q` search param, so the global
  // top-bar SearchBar drives that SAME param (rather than the old dead
  // Zustand `activeFilter.q` slice). Typing here updates the URL `q`,
  // which the catalog shell adopts; typing in the catalog updates the
  // URL, which this bar reflects. Both read/write a single value.
  const navigate = useNavigate();
  // Route-agnostic read (`strict: false`) so this global bar works on
  // every route, not just `/`.
  const search = useSearch({ strict: false }) as { q?: string };
  const urlQuery = search.q ?? "";

  // Local input mirror for responsiveness; synced from the URL when it
  // changes externally (catalog typing, back/forward, deep links).
  const [value, setValue] = React.useState(urlQuery);
  React.useEffect(() => {
    setValue((prev) => (prev === urlQuery ? prev : urlQuery));
  }, [urlQuery]);

  // Debounced write to the URL `q` param. Navigating to "/" ensures a
  // query typed from another route surfaces results on the catalog.
  const handleDebouncedChange = React.useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (trimmed === urlQuery.trim()) return;
      void navigate({
        to: "/",
        search: ((prev: Record<string, unknown>) => ({
          ...prev,
          q: trimmed ? next : undefined,
        })) as unknown as never,
      });
    },
    [navigate, urlQuery],
  );

  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3",
        IS_MAC && MAC_TRAFFIC_LIGHT_INSET,
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
      >
        <Menu className="h-4 w-4" aria-hidden />
      </Button>

      <Link
        to="/"
        className="font-mono text-sm font-semibold tracking-tight text-foreground"
      >
        AllTheRepos
      </Link>

      <div className="ml-4 min-w-0 flex-1">
        <SearchBar
          value={value}
          onChange={setValue}
          onDebouncedChange={handleDebouncedChange}
        />
      </div>

      {/*
        Only shown when there is genuinely something to act on. An
        always-present "you're up to date" chip is pure noise.

        Which action the chip runs depends on whether this build can
        install an update at all — `canInstall` is read off the running
        bundle's own signature main-side, so an ad-hoc build gets the
        release page rather than a download that macOS would refuse.
      */}
      {update.status.state === "downloading" ? (
        <span
          title={`Downloading version ${update.status.newVersion} — ${Math.round(
            update.status.progress ?? 0,
          )}%`}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent/15 px-2 py-1 text-xs text-accent"
        >
          <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden lg:inline">
            Downloading {update.status.newVersion}
          </span>
          <span className="lg:hidden">Update</span>
          <span className="font-mono">
            {Math.round(update.status.progress ?? 0)}%
          </span>
        </span>
      ) : null}

      {update.status.state === "ready" ? (
        <button
          type="button"
          onClick={update.install}
          title={`Version ${update.status.newVersion} is downloaded — restarts the app to install it`}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-accent/15 px-2 py-1 text-xs text-accent transition-colors duration-150 hover:bg-accent/25"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden lg:inline">
            Restart to update {update.status.newVersion}
          </span>
          <span className="lg:hidden">Restart</span>
        </button>
      ) : null}

      {update.status.state === "available" ? (
        <button
          type="button"
          onClick={
            update.status.canInstall ? update.install : update.openRelease
          }
          title={
            update.status.canInstall
              ? `Version ${update.status.newVersion} is available — downloads and installs it, then asks you to restart`
              : `Version ${update.status.newVersion} is available — opens the release page`
          }
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-accent/15 px-2 py-1 text-xs text-accent transition-colors duration-150 hover:bg-accent/25"
        >
          <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden lg:inline">
            {update.status.canInstall
              ? `Install ${update.status.newVersion}`
              : `Update to ${update.status.newVersion}`}
          </span>
          <span className="lg:hidden">
            {update.status.canInstall ? "Install" : "Update"}
          </span>
        </button>
      ) : null}

      <nav className="flex items-center gap-0.5">
        {NAV_ITEMS.map(({ to, label, Icon, badge }) => (
          <Button
            key={to}
            asChild
            variant="ghost"
            size="sm"
            className="relative gap-1.5 px-2"
          >
            <Link to={to}>
              <Icon className="h-4 w-4" aria-hidden />
              {/*
                The label names the link at every width, so the collapsed
                state has to hide it *visually* rather than with
                `display: none` — which takes the text out of the accessible
                name and leaves an `aria-hidden` icon as the link's entire
                content. The window's minimum width is 800 and `lg` starts at
                1024, so below that every one of these destinations was an
                unnamed icon. `lg:not-sr-only` puts the label back in flow
                where there is room for it.
              */}
              <span className="sr-only text-xs lg:not-sr-only">{label}</span>
              {badge === "processes" && processCount > 0 ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-semibold leading-none text-accent-foreground"
                >
                  {processCount}
                </span>
              ) : null}
              {badge === "processes" ? (
                <span className="sr-only">
                  {processCount > 0
                    ? `${processCount} running ${processCount === 1 ? "process" : "processes"}`
                    : "No running processes"}
                </span>
              ) : null}
            </Link>
          </Button>
        ))}
      </nav>
    </header>
  );
}
