/**
 * Folder restructuring hooks.
 *
 * Same split as `use-move.ts`: the preflight is a query because it only
 * reads, the operations are mutations because they change the
 * filesystem. Every mutation invalidates the whole catalog — a folder
 * rename changes the path of every repo beneath it, which in turn
 * changes their tree position, their folder label, and their cover key.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { FolderCheckResult, FolderOpResult } from "@shared/types";

import { getAtr, requireAtr } from "@renderer/lib/atr";

const EMPTY_CHECK: FolderCheckResult = {
  fromPath: "",
  toPath: "",
  affected: [],
  blockers: [],
  ok: false,
};

/**
 * Preview a folder rename or move.
 *
 * Disabled until both paths are known, and never cached: a repo inside
 * the folder can go dirty, or a dev server can start, between opening
 * the dialog and confirming it.
 */
export function useFolderCheck(fromPath: string | null, toPath: string | null) {
  return useQuery({
    queryKey: ["catalog", "folderCheck", fromPath, toPath] as const,
    queryFn: async (): Promise<FolderCheckResult> => {
      const atr = getAtr();
      if (!atr || !fromPath || !toPath) return EMPTY_CHECK;
      return atr.catalog.folderCheck({ fromPath, toPath });
    },
    enabled: Boolean(fromPath && toPath),
    staleTime: 0,
    retry: false,
  });
}

function useCatalogInvalidator() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["catalog"] });
  };
}

export function useRenameFolder() {
  const invalidate = useCatalogInvalidator();
  return useMutation({
    mutationFn: async (input: {
      fromPath: string;
      newName: string;
    }): Promise<FolderOpResult> => requireAtr().catalog.folderRename(input),
    onSuccess: invalidate,
  });
}

export function useMoveFolder() {
  const invalidate = useCatalogInvalidator();
  return useMutation({
    mutationFn: async (input: {
      fromPath: string;
      parentPath: string;
    }): Promise<FolderOpResult> => requireAtr().catalog.folderMove(input),
    onSuccess: invalidate,
  });
}

export function useCreateFolder() {
  const invalidate = useCatalogInvalidator();
  return useMutation({
    mutationFn: async (input: {
      parentPath: string;
      name: string;
    }): Promise<FolderOpResult> => requireAtr().catalog.folderCreate(input),
    onSuccess: invalidate,
  });
}
