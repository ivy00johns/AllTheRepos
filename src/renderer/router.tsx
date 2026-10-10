/**
 * TanStack Router setup.
 *
 * Routing approach: **object-based** (a.k.a. "code-based") route tree.
 *
 * Rationale: file-based routing would require either Vite's
 * `@tanstack/router-vite-plugin` or running `tsr generate` — that adds
 * build-time codegen + a generated `routeTree.gen.ts` artifact that
 * would conflict with the contract-only files-list owned by this
 * agent. Object-based routing trades a tiny bit of boilerplate for:
 *   - zero codegen, no generated files in the tree,
 *   - explicit imports = easy to reason about which files own which
 *     routes when multiple agents are editing the renderer,
 *   - works untouched if the project later flips to file-based
 *     routing (the route objects are the same).
 *
 * If we ever want to switch to file-based, the migration is mechanical
 * — each `routes/*.tsx` already exports a `Route` const in the shape
 * the file-based plugin produces.
 *
 * Pathing: TanStack Router infers `repos/$slug` as `/repos/:slug` and
 * exposes `slug` via `Route.useParams()` in `routes/repos.$slug.tsx`.
 */

import {
  createHashHistory,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router";

import { Route as RootRoute } from "@renderer/routes/__root";
import { Route as IndexRoute } from "@renderer/routes/index";
import { Route as ClaudeRoute } from "@renderer/routes/claude";
import { Route as DebugRoute } from "@renderer/routes/debug";
import { Route as GraphRoute } from "@renderer/routes/graph";
import { Route as ProcessesRoute } from "@renderer/routes/processes";
import { Route as RepoRoute } from "@renderer/routes/repos.$slug";
import { Route as SettingsRoute } from "@renderer/routes/settings";

// Compose the route tree off the root.
const routeTree = RootRoute.addChildren([
  IndexRoute,
  ClaudeRoute,
  DebugRoute,
  ProcessesRoute,
  RepoRoute,
  SettingsRoute,
  GraphRoute,
]);

/** Either implementation. Both are the same `RouterHistory` shape. */
type AppHistory =
  | ReturnType<typeof createHashHistory>
  | ReturnType<typeof createMemoryHistory>;

/**
 * Hash history, so a reload keeps where you were.
 *
 * This was memory history, on the reasoning that a desktop app has no address
 * bar and therefore no URL to keep. But "no address bar" is not "no URL worth
 * having": reloading the window put you back on the catalog, and the map's own
 * state — the open group, the selected repo, the signal filter — went with it,
 * which is what "it keeps resetting on refresh" meant. The route now lives in
 * `#/graph?cluster=3`, so it survives a reload, can be sent to somebody, and
 * gives the router a Back that does something.
 *
 * The *fragment*, not a path, because the renderer is loaded from `file://`:
 * a History API push cannot rewrite the path of a file URL. Electron still
 * hands the renderer no address bar, and CSP plus `webPreferences` are
 * unchanged, so nothing here widens what the window can reach.
 *
 * The two satellite windows load `#window=spotlight` and
 * `#window=tray-popover`, which are not routes. `selectRoot()` in main.tsx has
 * already chosen their root component from that fragment — this module is
 * evaluated before it runs, since both are imported by the same bundle — and
 * they never mount `RouterProvider`, so they keep memory history and their
 * hash is left exactly as Electron wrote it.
 */
function createAppHistory(): AppHistory {
  if (typeof window === "undefined") {
    return createMemoryHistory({ initialEntries: ["/"] });
  }
  const raw = window.location.hash.replace(/^#/, "");
  const kind = new URLSearchParams(raw).get("window") ?? "main";
  if (kind !== "main") return createMemoryHistory({ initialEntries: ["/"] });
  // A fragment that is not a path is not a route either. Drop it before the
  // router reads it, so a hand-edited `#anything` opens the catalog rather
  // than a not-found page — replaced, not pushed, so Back leaves the app.
  if (raw !== "" && !raw.startsWith("/")) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}#/`,
    );
  }
  return createHashHistory();
}

export const router = createRouter({
  routeTree,
  history: createAppHistory(),
  defaultPreload: "intent",
  // Detail: in a desktop app we never want the route to throw a
  // 404 page — the route components themselves render an empty state.
  defaultNotFoundComponent: () => (
    <div className="p-12 text-center text-sm text-muted-foreground">
      Route not found.
    </div>
  ),
});

// Type-augmentation so TanStack Router's `Link`, `useNavigate`, etc.
// know about our routes.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
