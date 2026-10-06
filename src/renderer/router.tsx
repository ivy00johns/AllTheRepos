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

import { createMemoryHistory, createRouter } from "@tanstack/react-router";

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

/**
 * Electron note: we use `createMemoryHistory` instead of the default
 * browser history because the renderer is loaded from `file://` (or
 * the Vite dev server) and a real History API doesn't make sense in a
 * desktop app. Memory history also avoids the renderer being able to
 * navigate to arbitrary URLs via the address bar (defense-in-depth on
 * top of the main-process CSP).
 */
export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
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
