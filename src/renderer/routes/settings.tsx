/**
 * Settings route ("/settings").
 *
 * Thin wrapper around the SettingsForm component. The form itself is
 * authored by frontend-components; this route handles only the page
 * chrome and bridge-availability fallback.
 */

import { Link, createRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { SettingsForm } from "@renderer/components/settings-form";
import { Button } from "@renderer/components/ui/button";
import { ErrorState } from "@renderer/components/ui/error-state";
import { Skeleton, SkeletonRegion } from "@renderer/components/ui/skeleton";
import { useSettings } from "@renderer/hooks/use-settings";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/settings",
  component: SettingsPage,
});

function SettingsPage() {
  const settingsQuery = useSettings();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure scan locations, embeddings, and your default editor.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Link>
        </Button>
      </div>

      {settingsQuery.isLoading ? (
        /*
         * The catalog's own skeleton, not a sentence. Settings is read at
         * boot by the shell, so this is the shape the first paint takes on
         * a cold start — where a bare "Loading settings…" next to pulsing
         * cards read as two different applications (ATR-064).
         */
        <SkeletonRegion label="Loading settings…">
          {Array.from({ length: 3 }, (_, section) => (
            <div
              key={section}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </SkeletonRegion>
      ) : settingsQuery.error ? (
        <ErrorState
          title="Failed to load settings"
          error={settingsQuery.error}
          onRetry={() => void settingsQuery.refetch()}
          retrying={settingsQuery.isFetching}
        />
      ) : settingsQuery.data ? (
        <SettingsForm initialSettings={settingsQuery.data} />
      ) : null}
    </div>
  );
}
