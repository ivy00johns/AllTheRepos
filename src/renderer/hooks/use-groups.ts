/**
 * useGroups + group mutation hooks.
 *
 * Read path: `useGroups` wraps `groups:list`.
 *
 * Mutations (ATR-005): `useCreateGroup`, `useRenameGroup`,
 * `useDeleteGroup`, `useSetGroupMembers` each call the matching
 * `window.atr.groups.*` bridge method and invalidate the groups list
 * query (`groups.list`) on success so the rail re-renders with the
 * new set without a manual refetch. They mirror the `useUpdateSettings`
 * pattern: a `getAtr()` null-guard that throws a clear error, and a
 * single `invalidateQueries({ queryKey: queryKeys.groups.all })` in
 * `onSuccess` (the `all` prefix covers the `list` key and any future
 * group sub-queries).
 *
 * `useAddGroupMembers` / `useRemoveGroupMembers` are the read-modify-write
 * pair on top of `groups:setMembers`: that channel takes the whole member
 * set, so "add" is a union and "remove" a difference against a fresh read
 * (see `lib/group-membership.ts`). They invalidate the repo queries too,
 * because membership shows up on a repo's detail panel and in the group's
 * count.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { readAllRepos } from "./use-repos";
import { getAtr } from "@renderer/lib/atr";
import {
  addGroupMembers,
  removeGroupMembers,
  slugsInGroup,
  slugsNotInGroup,
} from "@renderer/lib/group-membership";
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
  UpdateGroupFilterInput,
  UpdateGroupFilterResult,
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
 * exactly the repos in that group. We read it to completion — one page at a
 * time, since the contract caps a request at 200 rows — and project the result
 * down to a `Set<slug>` the catalog grid can intersect against. A single capped
 * page would strand every member past row 200, hiding them from the group the
 * same way the catalog used to hide them from the rail (ATR-042).
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
      const result = await readAllRepos({ groupId: groupId as number });
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

/**
 * Rewrite a saved filter's rule.
 *
 * No repo query is invalidated: a smart group's membership is its filter, so
 * nothing about a repo changed. The groups list does, because the row's count
 * and the grid's scope both read the new `smartFilter` from it.
 */
export function useUpdateGroupFilter(): UseMutationResult<
  UpdateGroupFilterResult,
  Error,
  UpdateGroupFilterInput
> {
  const qc = useQueryClient();
  return useMutation<UpdateGroupFilterResult, Error, UpdateGroupFilterInput>({
    mutationFn: async (input) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot update the filter.",
        );
      }
      return atr.groups.updateFilter(input);
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
      void qc.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });
}

/**
 * The result of an add/remove, with the part the notice needs.
 *
 * `added`/`removed` count the repos the write actually moved, which is not the
 * size of the selection: adding a repo that is already a member changes
 * nothing, and the strip should say so rather than claim a change it did not
 * make.
 */
export interface GroupMembershipChange extends SetGroupMembersResult {
  added: number;
  removed: number;
}

/**
 * Resolve a group's current members, right before the write.
 *
 * `groups:setMembers` REPLACES the member set, so an add is read-modify-write.
 * The read goes to `catalog:list({ groupId })` in full (`readAllRepos` pages
 * past the 200-row ceiling) rather than to the query cache: a cached member set
 * that predates somebody else's write would be written back as the whole
 * group, deleting their additions. The read is cheap — one indexed join — and
 * the alternative loses data.
 */
async function currentMemberSlugs(groupId: number): Promise<string[]> {
  const result = await readAllRepos({ groupId });
  return result.items.map((repo) => repo.slug);
}

/**
 * Add repos to a manual group, keeping everyone already in it.
 *
 * Wired to the toolbar's "Add to group" menu and to "New group" (a group
 * created from a selection is empty, so the same union covers both).
 */
export function useAddGroupMembers(): UseMutationResult<
  GroupMembershipChange,
  Error,
  SetGroupMembersInput
> {
  const qc = useQueryClient();
  return useMutation<GroupMembershipChange, Error, SetGroupMembersInput>({
    mutationFn: async (input) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot add to group.");
      }
      const current = await currentMemberSlugs(input.groupId);
      const added = slugsNotInGroup(current, input.slugs);
      if (added.length === 0) {
        return {
          groupId: input.groupId,
          memberCount: current.length,
          added: 0,
          removed: 0,
        };
      }
      const result = await atr.groups.setMembers({
        groupId: input.groupId,
        slugs: addGroupMembers(current, input.slugs),
      });
      return { ...result, added: added.length, removed: 0 };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all });
      void qc.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });
}

/** Remove repos from a manual group, keeping the rest. */
export function useRemoveGroupMembers(): UseMutationResult<
  GroupMembershipChange,
  Error,
  SetGroupMembersInput
> {
  const qc = useQueryClient();
  return useMutation<GroupMembershipChange, Error, SetGroupMembersInput>({
    mutationFn: async (input) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot remove from group.");
      }
      const current = await currentMemberSlugs(input.groupId);
      const removed = slugsInGroup(current, input.slugs);
      if (removed.length === 0) {
        return {
          groupId: input.groupId,
          memberCount: current.length,
          added: 0,
          removed: 0,
        };
      }
      const result = await atr.groups.setMembers({
        groupId: input.groupId,
        slugs: removeGroupMembers(current, input.slugs),
      });
      return { ...result, added: 0, removed: removed.length };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all });
      void qc.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });
}
