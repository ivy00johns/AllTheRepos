/**
 * useGroups + group mutation hooks.
 *
 * Read path: `useGroups` wraps `groups:list`.
 *
 * Mutations (ATR-005): `useCreateGroup`, `useRenameGroup`,
 * `useDeleteGroup`, `useSetGroupMembers` each call the matching
 * `window.atr.groups.*` bridge method and invalidate the groups list
 * query (`groups.list`) on success so the sidebar re-renders with the
 * new set without a manual refetch. They mirror the `useUpdateSettings`
 * pattern: a `getAtr()` null-guard that throws a clear error, and a
 * single `invalidateQueries({ queryKey: queryKeys.groups.all })` in
 * `onSuccess` (the `all` prefix covers the `list` key and any future
 * group sub-queries).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { getAtr } from "@renderer/lib/atr";
import { queryKeys } from "@renderer/lib/query-client";
import type {
  CreateGroupInput,
  CreateGroupResult,
  DeleteGroupInput,
  DeleteGroupResult,
  ListGroupsResult,
  RenameGroupInput,
  RenameGroupResult,
  SetGroupMembersInput,
  SetGroupMembersResult,
} from "@shared/types";

export function useGroups(): UseQueryResult<ListGroupsResult, Error> {
  return useQuery<ListGroupsResult, Error>({
    queryKey: queryKeys.groups.list(),
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot fetch groups.");
      }
      return atr.groups.list();
    },
    enabled: typeof window !== "undefined" && Boolean(getAtr()),
  });
}

/**
 * useGroupMemberSlugs — the manual-group membership read path (ATR-011).
 *
 * The `groups:list` payload carries no member slugs/ids (see `GroupSchema`
 * — only `repoCount`), so we cannot derive a manual group's members from
 * the groups list alone. The authoritative read path is `catalog:list`
 * with a `groupId`: the main process resolves membership through the
 * `repo_groups` join (`src/main/db/queries.ts` — `listRepos`), returning
 * exactly the repos in that group. We ask for the contract max (`limit:
 * 200`) and project the result down to a `Set<slug>` the catalog grid can
 * intersect against.
 *
 * Passing `groupId === null` disables the query and yields `null`, the
 * "no manual-group restriction" sentinel the shell treats as "show all".
 * Smart groups are still filtered client-side by their `smartFilter`, so
 * callers should only enable this for MANUAL groups.
 */
export function useGroupMemberSlugs(
  groupId: number | null,
): UseQueryResult<Set<string>, Error> {
  return useQuery<Set<string>, Error>({
    // `queryKeys.groups` only registers `all`/`list`; this read is keyed
    // off the shared `groups.all` prefix (so the group mutations'
    // `invalidateQueries({ queryKey: queryKeys.groups.all })` also drops
    // stale member sets) plus the groupId discriminator.
    queryKey: [...queryKeys.groups.all, "members", groupId ?? -1],
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot fetch group members.",
        );
      }
      const result = await atr.catalog.list({
        groupId: groupId as number,
        limit: 200,
      });
      return new Set(result.items.map((r) => r.slug));
    },
    enabled:
      groupId !== null && typeof window !== "undefined" && Boolean(getAtr()),
  });
}

export function useCreateGroup(): UseMutationResult<
  CreateGroupResult,
  Error,
  CreateGroupInput
> {
  const qc = useQueryClient();
  return useMutation<CreateGroupResult, Error, CreateGroupInput>({
    mutationFn: async (input) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot create group.");
      }
      return atr.groups.create(input);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all });
    },
  });
}

export function useRenameGroup(): UseMutationResult<
  RenameGroupResult,
  Error,
  RenameGroupInput
> {
  const qc = useQueryClient();
  return useMutation<RenameGroupResult, Error, RenameGroupInput>({
    mutationFn: async (input) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot rename group.");
      }
      return atr.groups.rename(input);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all });
    },
  });
}

export function useDeleteGroup(): UseMutationResult<
  DeleteGroupResult,
  Error,
  DeleteGroupInput
> {
  const qc = useQueryClient();
  return useMutation<DeleteGroupResult, Error, DeleteGroupInput>({
    mutationFn: async (input) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot delete group.");
      }
      return atr.groups.delete(input);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all });
    },
  });
}

export function useSetGroupMembers(): UseMutationResult<
  SetGroupMembersResult,
  Error,
  SetGroupMembersInput
> {
  const qc = useQueryClient();
  return useMutation<SetGroupMembersResult, Error, SetGroupMembersInput>({
    mutationFn: async (input) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot set group members.",
        );
      }
      return atr.groups.setMembers(input);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all });
    },
  });
}
