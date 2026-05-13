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
        <p className="font-mono text-sm text-muted-foreground">
          Loading settings…
        </p>
      ) : settingsQuery.error ? (
        <div className="flex flex-col gap-2">
          <p className="text-base font-medium text-destructive">
            Failed to load settings
          </p>
          <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs text-muted-foreground">
            {settingsQuery.error.message}
          </pre>
        </div>
      ) : settingsQuery.data ? (
        <SettingsForm initialSettings={settingsQuery.data} />
      ) : null}
    </div>
  );
}
