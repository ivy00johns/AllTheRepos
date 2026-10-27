/**
 * Top bar — the handoff's 48px, three-column shell header.
 *
 *   ┌──────────┬───────────────────────────────┬──────────────────┐
 *   │ wordmark │ search                        │ destinations     │
 *   │ 232px    │ max 560px                     │ 12px text        │
 *   └──────────┴───────────────────────────────┴──────────────────┘
 *
 * The layout is the redesign, not decoration: a 232px wordmark cell on the
 * surface colour, with a hairline under the whole bar and a right hairline
 * closing the cell, is what makes the rail below it read as the same column.
 * The destinations are text at `text-label` with a 2px ink underline on the
 * active one — the accent is the app mark and the live dot, never a nav state.
 *
 * Behaviour is unchanged from the previous bar: one search source of truth
 * (the URL's `q` param), the update affordances, the demo-data badge, the
 * sidebar toggle, and the dev-only door to `/debug`.
 */

import * as React from "react";
import { Link, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Menu,
  Terminal,
  ArrowDownToLine,
  RotateCw,
} from "lucide-react";

import { DemoDataBadge } from "@renderer/components/layout/demo-data-badge";
import { SearchBar } from "@renderer/components/search/search-bar";
import { isPackagedBuild } from "@renderer/lib/atr";
import { useProcessCount } from "@renderer/hooks/use-processes";
import { cn } from "@renderer/lib/cn";
import { useUiStore } from "@renderer/stores/ui";
import { useUpdate } from "@renderer/hooks/use-update";

/**
 * The main window uses `titleBarStyle: "hiddenInset"` on macOS, which
 * overlays the traffic-light buttons on the top-left ~76px. Reserve that
 * strip on darwin only; the wordmark cell is 232px, which leaves room for
 * the mark and the name beside it.
 */
const MAC_TRAFFIC_LIGHT_INSET = "pl-[76px]";
const IS_MAC =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

/**
 * Top-level destinations.
 *
 * Labels only. The handoff's nav is a one-line row of 12px text with the
 * active destination in ink and underlined; icons are gone because a brain
 * glyph never meant "Claude usage" to anybody and the row is five words wide.
 */
const NAV_ITEMS = [
  { to: "/", label: "Repos", badge: null },
  { to: "/processes", label: "Running", badge: "processes" },
  { to: "/graph", label: "Map", badge: null },
  { to: "/claude", label: "Claude", badge: null },
  { to: "/settings", label: "Settings", badge: null },
] as const;

export function TopBar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const pathname = useLocation({ select: (location) => location.pathname });
  const update = useUpdate();
  const processCount = useProcessCount();
  // Stable for the life of the process — main states it once per window.
  const packaged = React.useMemo(() => isPackagedBuild(), []);

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
        "grid h-12 shrink-0 grid-cols-[232px_minmax(0,1fr)_auto] items-stretch",
        "border-b border-border bg-background",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2.5 border-r border-border bg-surface pr-3",
          IS_MAC ? MAC_TRAFFIC_LIGHT_INSET : "pl-4",
        )}
      >
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px] bg-accent" />
        <Link
          to="/"
          className="min-w-0 truncate text-body font-semibold text-foreground"
        >
          AllTheRepos
        </Link>
        {/*
          The handoff's rail is always present, so the toggle has no home in
          its layout. It stays — the collapse is a real feature and the
          element is what `aria-controls="catalog-sidebar"` describes — but as
          a 24px quiet control at the end of the cell rather than a leading
          button that competes with the wordmark.
        */}
        <button
          type="button"
          onClick={() => {
            if (pathname !== "/") void navigate({ to: "/" });
            else toggleSidebar();
          }}
          aria-label="Toggle sidebar"
          aria-expanded={pathname === "/" && !sidebarCollapsed}
          aria-controls="catalog-sidebar"
          className="ml-auto grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground transition-colors duration-150 hover:bg-surface-raised hover:text-foreground"
        >
          <Menu className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-4 px-6">
        <div className="w-full max-w-[560px]">
          <SearchBar
            value={value}
            onChange={setValue}
            onDebouncedChange={handleDebouncedChange}
          />
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-4 pl-2 pr-6">
        {/*
          Update affordances: kept, demoted. They used to be accent-tinted
          chips, which made "an update exists" the loudest thing in the chrome
          on every route; they are a quiet bordered control now, and the accent
          stays with the app mark and the live dot.
        */}
        {update.status.state === "downloading" ? (
          <span
            title={`Downloading version ${update.status.newVersion} — ${Math.round(
              update.status.progress ?? 0,
            )}%`}
            className="flex shrink-0 items-center gap-1.5 rounded border border-border px-2 py-1 text-label text-muted-foreground"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden lg:inline">
              Downloading {update.status.newVersion}
            </span>
            <span className="lg:hidden">Update</span>
            <span className="font-mono atr-micro">
              {Math.round(update.status.progress ?? 0)}%
            </span>
          </span>
        ) : null}

        {update.status.state === "ready" ? (
          <button
            type="button"
            onClick={update.install}
            title={`Version ${update.status.newVersion} is downloaded — restarts the app to install it`}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded border border-border px-2 py-1 text-label text-foreground transition-colors duration-150 hover:bg-surface-raised"
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
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded border border-border px-2 py-1 text-label text-foreground transition-colors duration-150 hover:bg-surface-raised"
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

        {/* The invented library announces itself beside the update it invents. */}
        <DemoDataBadge />

        <nav className="flex items-stretch gap-5">
          {NAV_ITEMS.map(({ to, label, badge }) => (
            <Link
              key={to}
              to={to}
              title={label}
              activeOptions={{ exact: to === "/" }}
              activeProps={{
                className:
                  "text-foreground shadow-[inset_0_-2px_0_var(--color-foreground)]",
                "aria-current": "page",
              }}
              className="flex items-center gap-1.5 text-label font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              <span>{label}</span>
              {badge === "processes" && processCount > 0 ? (
                <span
                  aria-hidden
                  className="flex items-center gap-1 font-mono atr-micro text-status-live"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-status-live" />
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
          ))}
        </nav>

        {/*
          The dev-only door to `/debug` (ATR-074) — outside the `<nav>` on
          purpose, so the primary navigation is exactly its destinations and
          this cannot be mistaken for a sixth.
        */}
        {packaged ? null : (
          <>
            <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
            <Link
              to="/debug"
              className="flex shrink-0 items-center gap-1 text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              <Terminal className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only lg:not-sr-only lg:inline atr-label">
                Debug
              </span>
              <span className="sr-only"> (development build)</span>
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
