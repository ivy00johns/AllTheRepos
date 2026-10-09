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
import { Skeleton, SkeletonRegion } from "@renderer/components/ui/skeleton";
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

  if (repoQuery.isLoading) {
    /*
     * The detail panel's own shape, at page width — a sentence here would be
     * the same wait the panel already shows as pulse blocks (ATR-064).
     */
    return (
      <SkeletonRegion label="Loading repo…" className="gap-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </SkeletonRegion>
    );
  }

  if (repoQuery.error) {
    return (
      <ErrorState
        title="Failed to load repo"
        error={repoQuery.error}
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
