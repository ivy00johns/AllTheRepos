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
      <SkeletonRegion label="Loading repo…" className="gap-4 px-6 py-8">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full max-w-[68ch]" />
        <Skeleton className="h-20 w-full max-w-[68ch]" />
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

  /*
   * The page is the panel without its chrome: the same content, opened at the
   * display tier on a full-bleed header, then one 68ch column. There is no
   * Back button — the top bar is the way back, and a page that needs a back
   * arrow beside a permanent nav is asking the person to choose.
   */
  return <RepoDetailContent repo={repoQuery.data} variant="page" />;
}
