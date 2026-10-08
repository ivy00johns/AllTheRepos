/**
 * Repo detail route ("/repos/$slug").
 *
 * Standalone full-page view of one repo. The index route renders the
 * same repo via the side panel; this route is the "open in new view"
 * destination (used by keyboard `Enter`, the address bar, and external
 * deep links once Phase 2 lands).
 */

import { Link, createRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { RepoDetailContent } from "@renderer/components/catalog/repo-detail-content";
import { Button } from "@renderer/components/ui/button";
import { ErrorState } from "@renderer/components/ui/error-state";
import { Skeleton } from "@renderer/components/ui/skeleton";
import { useRepo } from "@renderer/hooks/use-repo";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/repos/$slug",
  component: RepoPage,
});

function RepoPage() {
  const { slug } = Route.useParams();
  const repoQuery = useRepo(slug);

  // The placeholders carry the page's own shape — the back affordance, the
  // name, the meta line and the two content blocks — so the layout does not
  // jump when the repo arrives (ATR-064).
  if (repoQuery.isLoading) {
    return (
      <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-32" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (repoQuery.error) {
    return (
      <ErrorState
        title="Failed to load repo"
        message={repoQuery.error.message}
        onRetry={() => void repoQuery.refetch()}
        retrying={repoQuery.isFetching}
      />
    );
  }

  if (!repoQuery.data) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-base font-medium text-foreground">
          Repo not found
        </p>
        <p className="text-sm text-muted-foreground">
          No repo matches the slug{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {slug}
          </code>
          . It may have been removed from the catalog.
        </p>
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to catalog
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to="/" search={{ repo: repoQuery.data.slug }}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to catalog
          </Link>
        </Button>
      </div>
      <RepoDetailContent repo={repoQuery.data} variant="page" />
    </div>
  );
}
