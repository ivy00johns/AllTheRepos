/**
 * useSettings + useUpdateSettings — read & mutation hooks for
 * `settings:get` and `settings:update`.
 *
 * `useUpdateSettings` invalidates the `settings.current` query on
 * success so any reader (Settings page, scan-paths picker, etc.) sees
 * the new values without a manual refetch. The mutation accepts a
 * partial Settings patch per the contract.
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
  GetSettingsResult,
  UpdateSettingsInput,
  UpdateSettingsResult,
} from "@shared/types";

export function useSettings(): UseQueryResult<GetSettingsResult, Error> {
  return useQuery<GetSettingsResult, Error>({
    queryKey: queryKeys.settings.current(),
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot read settings.",
        );
      }
      return atr.settings.get();
    },
    enabled: typeof window !== "undefined" && Boolean(getAtr()),
  });
}

export function useUpdateSettings(): UseMutationResult<
  UpdateSettingsResult,
  Error,
  UpdateSettingsInput
> {
  const qc = useQueryClient();
  return useMutation<UpdateSettingsResult, Error, UpdateSettingsInput>({
    mutationFn: async (patch) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot update settings.",
        );
      }
      return atr.settings.update(patch);
    },
    onSuccess: (next) => {
      // Seed the cache with the server-returned merged settings so the
      // form sees the new values immediately, then mark stale so any
      // sibling consumers pull on next focus.
      qc.setQueryData(queryKeys.settings.current(), next);
      void qc.invalidateQueries({ queryKey: queryKeys.settings.all });
    },
  });
}
