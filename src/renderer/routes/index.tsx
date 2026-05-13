/**
 * Index route ("/") — the main catalog page.
 *
 * Renders the ported `<CatalogShell />`, which owns the three-column
 * layout (sidebar + grid + detail panel) plus its own search bar,
 * filter chips, and keyboard shortcuts. This file is responsible only
 * for fetching the initial data (repos + groups) and adapting the
 * preload bridge into the `loadRepoDetail` callback the shell needs.
 *
 * Wave-gate fix note: the previous version of this file imported three
 * components that don't exist (`catalog-grid`, `repo-detail-panel`,
 * `layout/sidebar`). The frontend-components agent shipped a single
 * `<CatalogShell />` that wraps the actual primitives (`repo-grid`,
 * `detail-panel`, `group-sidebar`), so we delegate to it instead of
 * trying to compose the pieces by hand.
 */

import * as React from "react";
import { createRoute } from "@tanstack/react-router";

import { CatalogShell } from "@renderer/components/catalog/catalog-shell";
import { useGroups } from "@renderer/hooks/use-groups";
import { useRepos } from "@renderer/hooks/use-repos";
import { getAtr } from "@renderer/lib/atr";
import type { RepoDetail } from "@shared/types";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  component: IndexPage,
});

function IndexPage() {
  // `CatalogShell` reads filter state from the TanStack Router search
  // params, so we don't need to thread the Zustand `activeFilter` here
  // — the URL is the source of truth for the catalog page.
  const reposQuery = useRepos({ limit: 200 });
  const groupsQuery = useGroups();

  const loadRepoDetail = React.useCallback(
    async (slug: string): Promise<RepoDetail | null> => {
      const atr = getAtr();
      if (!atr) return null;
      return atr.catalog.get({ slug });
    },
    [],
  );

  // Loading shim — the shell expects concrete arrays. Until both queries
  // resolve we render an empty shell rather than blocking on Suspense,
  // so the SearchBar / sidebar chrome stay interactive even while the
  // first scan is still warming up.
  const repos = reposQuery.data?.items ?? [];
  const totalCount = reposQuery.data?.total ?? 0;
  const groups = groupsQuery.data ?? [];

  return (
    <CatalogShell
      initialRepos={repos}
      groups={groups}
      totalCount={totalCount}
      loadRepoDetail={loadRepoDetail}
    />
  );
}
