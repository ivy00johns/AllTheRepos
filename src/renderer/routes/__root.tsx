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
import { Suspense } from "react";

import { useActionRegistration } from "@renderer/actions/use-action-registration";
import { useDeepLinkBus } from "@renderer/actions/use-deep-link-bus";
import { useMenuCommandBus } from "@renderer/actions/use-menu-command-bus";
import { useTrayOpenRepoBus } from "@renderer/actions/use-tray-open-repo-bus";
import { CommandPalette } from "@renderer/components/command-palette/command-palette";
import { ActionNotice } from "@renderer/components/layout/action-notice";
import { AdHocBuildNotice } from "@renderer/components/layout/adhoc-build-notice";
import { ScanStatusBar } from "@renderer/components/layout/scan-status-bar";
import { TopBar } from "@renderer/components/layout/top-bar";

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
  // Routes that own their own scrolling get the full-height shell: the catalog
  // (rail + grid + detail panel side by side) and the map, which wants the
  // viewport rather than the shell's prose measure. Everything else — settings,
  // claude, processes, a standalone repo page — renders inside `SimpleShell`,
  // the padded column that scrolls.
  //
  // `SimpleShell` scrolls rather than grows, so a route that is not listed here
  // still has to fit the window (see the height contract below).
  const isFullShell =
    location.pathname === "/" || location.pathname === "/graph";

  /*
   * The height contract, learned the hard way in the 2026-10-07 UI/UX review
   * (ATR-061/ATR-062): this column is exactly the window and `main` is the
   * only thing that flexes. Rooting it at `min-h-screen` instead let the
   * document grow to content height, so the window itself scrolled — which
   * clipped the catalog's own scroll region behind `main`'s
   * `overflow-hidden` (its `h-[100dvh]` then ran 48px past the bottom) and
   * pushed the map's bottom-anchored legend and control bar below the fold.
   * Both are asserted as numbers in `tests/e2e/layout-overflow.spec.ts`, so a
   * regression fails as "848 against 800" rather than as a screenshot nobody
   * looks at.
   *
   * Written here, above the `return`, on purpose: JSX children are verbatim
   * text, so a comment left *between* two elements is how code-looking prose
   * ends up on screen — and as a text child of this flex column it is also an
   * anonymous flex item, taking its own height out of `main`.
   * `tests/unit/renderer/jsx-text.spec.ts` fails on the forms that render, and
   * `layout-overflow.spec.ts` asserts the shell holds only elements before it
   * measures a height.
   */
  return (
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
      {/*
        `grid`, not `block`, and that is load-bearing: a route asks for
        `h-full`, and a percentage height only resolves against a *definite*
        parent height. `main` gets its height from `flex-1` — a resolved used
        height, but its `height` property is still `auto` — so as a block
        container it handed every route `auto` instead, and each one grew to
        content and pushed the window. A single `minmax(0, 1fr)` track makes
        the area definite, so `h-full` means the window and the route's own
        `overflow-y-auto` becomes the thing that scrolls.

        The braces are not decoration. Written as a bare block comment between
        two elements, this text is JSX *content*: it rendered — on every route —
        as a literal block of CSS-looking prose above the page, while explaining
        nothing to anybody. It also became an anonymous flex item with
        `min-height: auto`, so it could not shrink and it took its height out of
        `main`.
      */}
      <main className="relative grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden">
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
      <CommandPalette />
    </div>
  );
}

function SimpleShell({ children }: { children: React.ReactNode }) {
  /*
   * A scrolling column *inside* the window, not a page that grows: the outer
   * div is the scroll container, so the scrollbar sits at the window edge and
   * the inner one keeps the prose measure. `min-h-0` is what lets a child of
   * the flex column be shorter than its content instead of stretching the
   * document.
   */
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto min-h-0 w-full max-w-5xl px-6 py-8">
        {children}
      </div>
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
