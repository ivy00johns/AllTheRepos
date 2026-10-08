/**
 * Root route — three-column shell layout.
 *
 * The actual sidebar / catalog grid / detail panel components live in
 * `@renderer/components/{catalog,groups,search,settings}/*` and are
 * authored by the frontend-components agent. This file owns only the
 * layout primitive that those components slot into.
 *
 * Layout:
 *   ┌────────────┬──────────────────────────────┬────────────┐
 *   │  Sidebar   │       Outlet (route)         │  Detail    │
 *   │ (groups +  │  (catalog grid / settings)   │  panel     │
 *   │ filters)   │                              │ (per-repo) │
 *   └────────────┴──────────────────────────────┴────────────┘
 *
 * The detail panel collapses to 0-width when no repo is selected; the
 * sidebar collapses via `useUiStore.sidebarCollapsed`. Both behaviours
 * are CSS-only so route changes don't unmount the shell.
 */

import { Outlet, createRootRoute, useLocation } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { useActionRegistration } from "@renderer/actions/use-action-registration";
import { useDeepLinkBus } from "@renderer/actions/use-deep-link-bus";
import { useMenuCommandBus } from "@renderer/actions/use-menu-command-bus";
import { useTrayOpenRepoBus } from "@renderer/actions/use-tray-open-repo-bus";
import { ActionNotice } from "@renderer/components/layout/action-notice";
import { AdHocBuildNotice } from "@renderer/components/layout/adhoc-build-notice";
import { ScanStatusBar } from "@renderer/components/layout/scan-status-bar";
import { TopBar } from "@renderer/components/layout/top-bar";

/*
 * The palette (cmdk + a Radix dialog) is not on the first-paint path — it
 * only appears on Cmd+K — so it is split into its own chunk. `defaultPreload`
 * does not cover it, but the first open reads the chunk off local disk, which
 * is the same trade the shell already makes for every route it does not paint.
 */
const CommandPalette = lazy(() =>
  import("@renderer/components/command-palette/command-palette").then((m) => ({
    default: m.CommandPalette,
  })),
);

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  // Phase 2 lifecycle hooks live INSIDE the router context (any
  // TanStack Router hook — useNavigate, useLocation — null-crashes
  // outside RouterProvider's tree).
  useActionRegistration();
  useMenuCommandBus();
  useDeepLinkBus();
  useTrayOpenRepoBus();

  const location = useLocation();
  // Routes that don't want the three-column shell (settings, debug,
  // repo detail page) get a single-column layout. The index route keeps
  // the full shell so the catalog grid + detail panel render side by
  // side.
  const isFullShell = location.pathname === "/";

  return (
    /*
      `h-screen` + `min-h-0`, not `min-h-screen`.

      The column has to be the height of the window and no more, or `main`
      never becomes the space that is actually left: with `min-height` the
      column is content-sized, so a tall page (a full catalog grid) grows
      `main` past the window and the body scrolls — and a short one leaves the
      column at its content height, which is what collapsed `/graph`'s map pane
      to a ribbon while the rest of the window sat empty below it. `min-h-0` on
      `main` is the other half: a flex item will not shrink below its content
      by default, so without it a tall page still pushes the column open.

      Both `/graph` and the catalog asked for `h-full` and were told the truth
      only sometimes, which is why this is fixed here rather than in either of
      them.
    */
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <ScanStatusBar />
      {/*
        Above the transient notices on purpose: this one explains a launch
        that already happened, and it is the only thing on screen a person who
        just clicked through a Gatekeeper dialog has not seen before.
      */}
      <AdHocBuildNotice />
      <ActionNotice />
      <main className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<RouteFallback />}>
          {isFullShell ? (
            <Outlet />
          ) : (
            <SimpleShell>
              <Outlet />
            </SimpleShell>
          )}
        </Suspense>
      </main>
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
    </div>
  );
}

/**
 * The single-column shell for every route that is not the catalog.
 *
 * `h-full` + a flex column is what lets a route fill the space rather than
 * guess at it. `main` is `flex-1` and therefore already knows its height, so a
 * child asking for `h-full` gets the truth — which is how `/graph` stopped
 * sizing itself to `100dvh` and coming out 64px taller than the window
 * (ATR-062).
 *
 * `overflow-y-auto` is what keeps that from turning into a new problem. `main`
 * clips, so a shell pinned to its height would have cut off any route whose
 * content is taller than the window — settings, a repo detail, the process
 * list — with no way to scroll to the rest. The shell is the scroll container
 * for those instead: content that fits stays put, content that does not can be
 * reached. `tests/e2e/viewport-fit.spec.ts` asserts both halves.
 */
function SimpleShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-y-auto px-6 py-8">
      {children}
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center p-12 text-sm text-muted-foreground">
      Loading…
    </div>
  );
}
