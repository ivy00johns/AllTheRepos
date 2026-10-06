/**
 * Relocation hooks.
 *
 * The preflight is a query (it only reads) and the move is a mutation
 * (it changes the filesystem). Keeping that split honest means the
 * preview can re-run freely as the user picks different targets, while
 * the destructive step happens exactly once per confirmation.
 *
 * Every mutation invalidates the catalog, because a moved repo's path —
 * and therefore its folder, its tree position and its cover — is stale
 * the moment the rename returns.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  MoveCheckResult,
  MoveLastResult,
  MoveResult,
} from "@shared/types";

import { getAtr, requireAtr } from "@renderer/lib/atr";

const EMPTY_CHECK: MoveCheckResult = {
  targetDir: "",
  entries: [],
  movableCount: 0,
  blockedCount: 0,
};

/**
 * Preview what a move would do. Disabled until there's both a selection
 * and a target, so opening the dialog doesn't fire a pointless check.
 */
export function useMoveCheck(slugs: string[], targetDir: string | null) {
  return useQuery({
    queryKey: ["catalog", "moveCheck", [...slugs].sort(), targetDir] as const,
    queryFn: async (): Promise<MoveCheckResult> => {
      const atr = getAtr();
      if (!atr || !targetDir) return EMPTY_CHECK;
      return atr.catalog.moveCheck({ slugs, targetDir });
    },
    enabled: slugs.length > 0 && Boolean(targetDir),
    // Preflight answers go stale immediately: a dev server can start, or
    // a file can change, between opening the dialog and confirming.
    staleTime: 0,
    retry: false,
  });
}

/** Execute a move batch. */
export function useMoveRepos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      slugs: string[];
      targetDir: string;
    }): Promise<MoveResult> => requireAtr().catalog.move(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
}

/** Reverse the last (or a named) move batch. */
export function useUndoMove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (batchId?: string): Promise<MoveResult> =>
      requireAtr().catalog.moveUndo(batchId ? { batchId } : {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
}

/** The most recent move batch, powering the undo affordance. */
export function useLastMove() {
  return useQuery({
    queryKey: ["catalog", "moveLast"] as const,
    queryFn: async (): Promise<MoveLastResult> => {
      const atr = getAtr();
      if (!atr) return null;
      return atr.catalog.moveLast({});
    },
    retry: false,
  });
}
