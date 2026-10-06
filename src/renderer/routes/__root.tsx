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
  // Routes that don't want the three-column shell (settings, debug,
  // repo detail page) get a single-column layout. The index route keeps
  // the full shell so the catalog grid + detail panel render side by
  // side.
  const isFullShell = location.pathname === "/";

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopBar />
      <ScanStatusBar />
      <ActionNotice />
      <main className="flex-1 overflow-hidden">
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
  return <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>;
}

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center p-12 text-sm text-muted-foreground">
      Loading…
    </div>
  );
}
