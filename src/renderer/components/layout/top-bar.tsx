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
} from "lucide-react";

import { Button } from "@renderer/components/ui/button";
import { SearchBar } from "@renderer/components/search/search-bar";
import { useProcessCount } from "@renderer/hooks/use-processes";
import { useUiStore } from "@renderer/stores/ui";

export function TopBar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
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
        <SearchBar
          value={value}
          onChange={setValue}
          onDebouncedChange={handleDebouncedChange}
        />
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
          <Link to="/claude" aria-label="Claude usage">
            <Brain className="h-4 w-4" aria-hidden />
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
