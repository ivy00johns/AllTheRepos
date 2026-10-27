/**
 * The catalog rail on the routes that are not the catalog.
 *
 * The handoff's shell is the same on every screen: a 232px surface column of
 * views, folders and groups, then the route. Before this, only `/` had it —
 * Running, Map, Claude, Settings, Debug and the repo page opened as a bare
 * top bar over a full-window sheet, so leaving the catalog made the app look
 * like a different product and the page titles started under the wordmark
 * instead of beside the tree they belong to.
 *
 * It is the same `DirRail` the catalog uses, not a lookalike. The rail writes
 * filters into the shared catalog store; the difference on these routes is
 * that choosing one then returns to `/`, because a filter is an instruction
 * for the catalog to show.
 *
 * Read-only in effect: the rail's own scan menus are omitted here (Settings
 * owns removal) and its group dialogs are the ordinary ones, so management
 * still has exactly one door per operation.
 */

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { DirRail } from "@renderer/components/catalog/dir-rail";
import { useGroups } from "@renderer/hooks/use-groups";
import { useAllRepos } from "@renderer/hooks/use-repos";
import {
  useAddScanPath,
  usePickScanPath,
} from "@renderer/hooks/use-scan-roots";
import { useSettings } from "@renderer/hooks/use-settings";
import { inferIdentities, ownershipOf } from "@renderer/lib/ownership";
import type { Ownership } from "@renderer/lib/ownership";
import { useUiStore } from "@renderer/stores/ui";

export function AppRail() {
  const reposQuery = useAllRepos();
  const groupsQuery = useGroups();
  const settingsQuery = useSettings();
  const pickScanPath = usePickScanPath();
  const addScanPath = useAddScanPath();
  const pushNotice = useUiStore((s) => s.pushNotice);
  const navigate = useNavigate();

  const repos = reposQuery.data?.items ?? [];
  const groups = groupsQuery.data ?? [];
  const scanPaths = settingsQuery.data?.scanPaths ?? [];
  const identities = settingsQuery.data?.identities ?? [];

  /**
   * A rail click lands on the catalog with that scope. `search` is deliberately
   * replaced rather than merged: the rail is a new instruction, and carrying
   * the previous route's query would show a narrower result than the row the
   * person just pressed.
   */
  const go = React.useCallback(
    (search: Record<string, string>) => {
      void navigate({ to: "/", search: search as never });
    },
    [navigate],
  );

  const ownershipBySlug = React.useMemo(() => {
    const configured =
      identities.length > 0 ? identities : inferIdentities(repos);
    const map = new Map<string, Ownership>();
    for (const repo of repos)
      map.set(repo.slug, ownershipOf(repo, configured).kind);
    return map;
  }, [identities, repos]);

  const handleAddScanPath = React.useCallback(async () => {
    const picked = await pickScanPath.mutateAsync();
    if (!picked) return;
    const result = await addScanPath.mutateAsync(picked);
    if (!result.added) {
      pushNotice(
        result.reason ?? "Could not add that folder to the scan list.",
      );
    }
  }, [pickScanPath, addScanPath, pushNotice]);

  return (
    <DirRail
      repos={repos}
      groups={groups}
      ownershipBySlug={ownershipBySlug}
      scanPaths={scanPaths}
      activeGroupId={null}
      showSelection={false}
      onSelectGroup={(id) => go(id === null ? {} : { groupId: String(id) })}
      onToggleDirty={() => go({ dirty: "true" })}
      onAfterSelect={() => go({})}
      onAddScanPath={() => void handleAddScanPath()}
      addingScanPath={pickScanPath.isPending || addScanPath.isPending}
    />
  );
}
