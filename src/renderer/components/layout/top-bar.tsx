/**
 * Top bar — global app header.
 *
 * Lives above every route. Provides:
 *   - app title + sidebar collapse toggle,
 *   - a slot for the search bar (frontend-components mounts `SearchBar`
 *     here once it exists),
 *   - navigation affordances to /settings and /debug (Phase 1 only).
 *
 * Visual treatment is deliberately minimal — the frontend-components
 * agent will skin this with the real design language in a follow-up
 * pass. Keep this file focused on slots + behaviour.
 */

import { Link } from "@tanstack/react-router";
import {
  Activity,
  Menu,
  Settings as SettingsIcon,
  Terminal,
} from "lucide-react";

import { Button } from "@renderer/components/ui/button";
import { SearchBar } from "@renderer/components/search/search-bar";
import { useProcessCount } from "@renderer/hooks/use-processes";
import { useUiStore } from "@renderer/stores/ui";

export function TopBar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  // SearchBar requires `value` + `onChange`. Wave-gate fix: bind to the
  // Zustand `activeFilter.q` slice rather than local state so the
  // top-bar query persists across route changes. On the catalog route
  // (`/`) the `CatalogShell` renders its own SearchBar wired to URL
  // search params — the two are independent and that's intentional for
  // Phase 1. A later pass can unify them once we lift filter state to
  // a single source of truth.
  const query = useUiStore((s) => s.activeFilter.q);
  const setActiveFilter = useUiStore((s) => s.setActiveFilter);
  const processCount = useProcessCount();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
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
        <SearchBar value={query} onChange={(q) => setActiveFilter({ q })} />
      </div>

      <nav className="flex items-center gap-1">
        <Button asChild variant="ghost" size="sm">
          <Link to="/debug" aria-label="Debug">
            <Terminal className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="relative">
          <Link to="/processes" aria-label="Running processes">
            <Activity className="h-4 w-4" aria-hidden />
            {processCount > 0 ? (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-semibold leading-none text-accent-foreground"
              >
                {processCount}
              </span>
            ) : null}
            <span className="sr-only">
              {processCount > 0
                ? `${processCount} running ${processCount === 1 ? "process" : "processes"}`
                : "No running processes"}
            </span>
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/settings" aria-label="Settings">
            <SettingsIcon className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </nav>
    </header>
  );
}
