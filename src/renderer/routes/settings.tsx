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
import { Skeleton } from "@renderer/components/ui/skeleton";
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
        // Label-and-field rows, the shape the form itself renders, so the
        // page does not restructure when the values land (ATR-064).
        <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-9 w-full max-w-md" />
            </div>
          ))}
        </div>
      ) : settingsQuery.error ? (
        <ErrorState
          title="Failed to load settings"
          message={settingsQuery.error.message}
          onRetry={() => void settingsQuery.refetch()}
          retrying={settingsQuery.isFetching}
        />
      ) : settingsQuery.data ? (
        <SettingsForm initialSettings={settingsQuery.data} />
      ) : null}
    </div>
  );
}
