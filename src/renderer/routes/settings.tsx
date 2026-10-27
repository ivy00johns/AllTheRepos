/**
 * Settings route ("/settings").
 *
 * Thin wrapper around the SettingsForm component. The route owns the page
 * header — the handoff's display-tier title on a hairline, not a mono heading
 * with a subtitle and a Back button — and the bridge-availability fallbacks.
 */

import { createRoute } from "@tanstack/react-router";

import { PageHeader } from "@renderer/components/layout/page-header";
import { SettingsForm } from "@renderer/components/settings-form";
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
    <div className="flex flex-col">
      <PageHeader title="Settings" />

      {settingsQuery.isLoading ? (
        /*
         * The page's own shape at rest: a label column and a control column
         * per block, on hairlines — not three cards inside a centred column.
         */
        <SkeletonRegion label="Loading settings…">
          {Array.from({ length: 4 }, (_, section) => (
            <div
              key={section}
              className="flex flex-wrap gap-x-12 gap-y-4 border-b border-border px-6 py-6"
            >
              <div className="flex max-w-[420px] flex-[1_1_240px] flex-col gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
              <div className="flex flex-[2_1_420px] flex-col gap-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            </div>
          ))}
        </SkeletonRegion>
      ) : settingsQuery.error ? (
        <div className="px-6 py-6">
          <ErrorState
            title="Failed to load settings"
            error={settingsQuery.error}
            onRetry={() => void settingsQuery.refetch()}
            retrying={settingsQuery.isFetching}
          />
        </div>
      ) : settingsQuery.data ? (
        <SettingsForm initialSettings={settingsQuery.data} />
      ) : null}
    </div>
  );
}
