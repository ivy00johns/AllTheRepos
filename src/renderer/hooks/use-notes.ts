/**
 * useNote / useSaveNote — TanStack Query hooks for the per-repo notes
 * scratchpad (`notes:get` / `notes:save`, NEW-PLAN.md §5.9).
 *
 * Notes are edited in-place with a debounced autosave, so the save mutation
 * writes straight into the cache with `setQueryData` rather than invalidating.
 * Invalidating would refetch, and a refetch landing mid-typing would reseed
 * the editor from the server and fight the user's cursor. `setQueryData`
 * makes the cache agree with what was just stored without a round-trip.
 *
 * The query is keyed on the repo slug — the handle the detail panel holds.
 * Main resolves the slug to the catalog row id, which is the on-disk key, so
 * a repo that moves keeps its note.
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
import type { Note, NotesSaveInput } from "@shared/types";

export function useNote(slug: string): UseQueryResult<Note, Error> {
  return useQuery<Note, Error>({
    queryKey: queryKeys.notes.detail(slug),
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot read the note.");
      }
      return atr.notes.get({ slug });
    },
    enabled: typeof window !== "undefined" && Boolean(getAtr()),
  });
}

/**
 * useSaveNote — mutation over `notes:save`.
 *
 * On success the returned note is written into the per-slug cache rather than
 * invalidated, so the editor does not refetch over the user's caret. The
 * projection reflects exactly what the server stored (blank content comes
 * back as `content: ""`, `updatedAt: null`), which is also what the "Saved"
 * indicator keys off.
 */
export function useSaveNote(): UseMutationResult<Note, Error, NotesSaveInput> {
  const queryClient = useQueryClient();

  return useMutation<Note, Error, NotesSaveInput>({
    mutationFn: async (input: NotesSaveInput) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot save the note.");
      }
      return atr.notes.save(input);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.notes.detail(saved.slug), saved);
    },
  });
}
