/**
 * IPC handlers — `catalog:*` namespace.
 *
 * Wires the renderer-facing catalog channels to the CatalogService and
 * SearchService implementations owned by backend-services. Every
 * handler:
 *   1. asserts the request came from our renderer frame,
 *   2. Zod-parses the input,
 *   3. delegates to the service,
 *   4. Zod-parses the output (catches drift from the service layer),
 *   5. returns the parsed result.
 *
 * `catalog:smartFilter` is a Phase-1 stub that returns `[]` — the
 * contract is locked now so renderer code can wire the affordance,
 * but the LLM-tagging job is a Phase 4 feature.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  DeleteRepoInputSchema,
  DeleteRepoResultSchema,
  GetRepoInputSchema,
  GetRepoResultSchema,
  ListReposInputSchema,
  ListReposResultSchema,
  RescanRepoInputSchema,
  RescanRepoResultSchema,
  SearchReposInputSchema,
  SearchReposResultSchema,
  SetRepoTagsInputSchema,
  SetRepoTagsResultSchema,
  SmartFilterInputSchema,
  SmartFilterResultSchema,
  CoverInputSchema,
  CoverResultSchema,
  MoveInputSchema,
  MoveCheckResultSchema,
  MoveResultSchema,
  MoveUndoInputSchema,
  MoveLastInputSchema,
  MoveLastResultSchema,
  FolderCheckInputSchema,
  FolderCheckResultSchema,
  FolderRenameInputSchema,
  FolderMoveInputSchema,
  FolderCreateInputSchema,
  FolderOpResultSchema,
  SetFavoriteInputSchema,
  SetFavoriteResultSchema,
} from "@shared/schemas";
import type {
  DeleteRepoResult,
  GetRepoResult,
  ListReposResult,
  RescanRepoResult,
  SearchReposResult,
  SetRepoTagsResult,
  SmartFilterResult,
  CoverResult,
  MoveCheckResult,
  MoveResult,
  MoveLastResult,
  FolderCheckResult,
  FolderOpResult,
  SetFavoriteResult,
} from "@shared/types";

import { setRepoFavorite } from "@main/db/queries";
import { catalogService } from "@main/services/catalog";
import { coverService } from "@main/services/cover";
import { folderService } from "@main/services/folder";
import { moveService } from "@main/services/move";
import { searchService } from "@main/services/search";

import { assertRendererFrame } from "./_frame";

export async function handleCatalogList(
  raw: unknown,
): Promise<ListReposResult> {
  const input = ListReposInputSchema.parse(raw);
  const result = await catalogService.list(input);
  return ListReposResultSchema.parse(result);
}

export async function handleCatalogGet(raw: unknown): Promise<GetRepoResult> {
  const input = GetRepoInputSchema.parse(raw);
  const result = await catalogService.get(input.slug);
  return GetRepoResultSchema.parse(result);
}

export async function handleCatalogSearch(
  raw: unknown,
): Promise<SearchReposResult> {
  const input = SearchReposInputSchema.parse(raw);
  const result = await searchService.search(input);
  return SearchReposResultSchema.parse(result);
}

export async function handleCatalogRescan(
  raw: unknown,
): Promise<RescanRepoResult> {
  const input = RescanRepoInputSchema.parse(raw);
  const result = await catalogService.rescan(input.slug);
  return RescanRepoResultSchema.parse(result);
}

/**
 * ATR-028: remove one repo row from the catalog. Never touches the repo on
 * disk — row + FTS + memberships + (best-effort) vector only.
 */
export async function handleCatalogDelete(
  raw: unknown,
): Promise<DeleteRepoResult> {
  const input = DeleteRepoInputSchema.parse(raw);
  const result = await catalogService.deleteRepo(input.slug);
  return DeleteRepoResultSchema.parse(result);
}

export async function handleCatalogSetTags(
  raw: unknown,
): Promise<SetRepoTagsResult> {
  const input = SetRepoTagsInputSchema.parse(raw);
  const result = await catalogService.setTags(input.slug, input.tags);
  return SetRepoTagsResultSchema.parse(result);
}

/**
 * Phase 1 stub: contract-locked, returns `[]`. Phase 4 will swap in the
 * real LLM-tagging implementation. The renderer can wire the UI today.
 */
export async function handleCatalogSmartFilter(
  raw: unknown,
): Promise<SmartFilterResult> {
  SmartFilterInputSchema.parse(raw);
  const empty: SmartFilterResult = [];
  return SmartFilterResultSchema.parse(empty);
}

/**
 * Resolve a repo's own cover artwork. Returns `{src: null}` rather than
 * throwing when there's nothing to show — "no artwork" is the common
 * case, not an error, and the renderer already has generated art ready.
 */
export async function handleCatalogCover(raw: unknown): Promise<CoverResult> {
  const input = CoverInputSchema.parse(raw);
  const result = await coverService.resolve(input.slug);
  return CoverResultSchema.parse(result);
}

/** Preflight a relocation. Reads only — nothing on disk is touched. */
export async function handleCatalogMoveCheck(
  raw: unknown,
): Promise<MoveCheckResult> {
  const input = MoveInputSchema.parse(raw);
  const result = await moveService.check(input.slugs, input.targetDir);
  return MoveCheckResultSchema.parse(result);
}

/** Execute a relocation. Re-runs the preflight internally. */
export async function handleCatalogMove(raw: unknown): Promise<MoveResult> {
  const input = MoveInputSchema.parse(raw);
  const result = await moveService.move(input.slugs, input.targetDir);
  return MoveResultSchema.parse(result);
}

/** Reverse a journaled move batch; defaults to the most recent one. */
export async function handleCatalogMoveUndo(
  raw: unknown,
): Promise<MoveResult> {
  const input = MoveUndoInputSchema.parse(raw);
  const result = await moveService.undo(input.batchId);
  return MoveResultSchema.parse(result);
}

/** Describe the most recent move batch so the UI can offer an undo. */
export async function handleCatalogMoveLast(
  raw: unknown,
): Promise<MoveLastResult> {
  MoveLastInputSchema.parse(raw);
  const result = await moveService.lastBatch();
  return MoveLastResultSchema.parse(result);
}

/**
 * Preflight a folder rename or move. Reads only — reports which repos
 * would travel with the folder and anything that blocks the operation.
 */
export async function handleCatalogFolderCheck(
  raw: unknown,
): Promise<FolderCheckResult> {
  const input = FolderCheckInputSchema.parse(raw);
  const result = await folderService.check(input.fromPath, input.toPath);
  return FolderCheckResultSchema.parse(result);
}

/** Rename a folder in place, re-pointing every catalog row beneath it. */
export async function handleCatalogFolderRename(
  raw: unknown,
): Promise<FolderOpResult> {
  const input = FolderRenameInputSchema.parse(raw);
  const result = await folderService.rename(input.fromPath, input.newName);
  return FolderOpResultSchema.parse(result);
}

/** Move a folder into a different parent, keeping its name. */
export async function handleCatalogFolderMove(
  raw: unknown,
): Promise<FolderOpResult> {
  const input = FolderMoveInputSchema.parse(raw);
  const result = await folderService.moveInto(input.fromPath, input.parentPath);
  return FolderOpResultSchema.parse(result);
}

/** Create an empty folder inside a scan root. */
export async function handleCatalogFolderCreate(
  raw: unknown,
): Promise<FolderOpResult> {
  const input = FolderCreateInputSchema.parse(raw);
  const result = await folderService.create(input.parentPath, input.name);
  return FolderOpResultSchema.parse(result);
}

/** Pin or unpin a repo. Returns the updated row, or null if unknown. */
export async function handleCatalogSetFavorite(
  raw: unknown,
): Promise<SetFavoriteResult> {
  const input = SetFavoriteInputSchema.parse(raw);
  const result = setRepoFavorite(input.slug, input.favorite);
  return SetFavoriteResultSchema.parse(result);
}

/**
 * Register every `catalog:*` handler. Idempotent — removes existing
 * handlers first so electron-vite hot-reload swaps them cleanly.
 */
export function registerCatalogHandlers(): void {
  const channels = [
    IPC.CATALOG.LIST,
    IPC.CATALOG.GET,
    IPC.CATALOG.SEARCH,
    IPC.CATALOG.RESCAN,
    IPC.CATALOG.SET_TAGS,
    IPC.CATALOG.DELETE,
    IPC.CATALOG.SMART_FILTER,
    IPC.CATALOG.COVER,
    IPC.CATALOG.MOVE_CHECK,
    IPC.CATALOG.MOVE,
    IPC.CATALOG.MOVE_UNDO,
    IPC.CATALOG.MOVE_LAST,
    IPC.CATALOG.FOLDER_CHECK,
    IPC.CATALOG.FOLDER_RENAME,
    IPC.CATALOG.FOLDER_MOVE,
    IPC.CATALOG.FOLDER_CREATE,
    IPC.CATALOG.SET_FAVORITE,
  ] as const;
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    IPC.CATALOG.LIST,
    async (event: IpcMainInvokeEvent, raw): Promise<ListReposResult> => {
      assertRendererFrame(event);
      return handleCatalogList(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.GET,
    async (event: IpcMainInvokeEvent, raw): Promise<GetRepoResult> => {
      assertRendererFrame(event);
      return handleCatalogGet(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.SEARCH,
    async (event: IpcMainInvokeEvent, raw): Promise<SearchReposResult> => {
      assertRendererFrame(event);
      return handleCatalogSearch(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.RESCAN,
    async (event: IpcMainInvokeEvent, raw): Promise<RescanRepoResult> => {
      assertRendererFrame(event);
      return handleCatalogRescan(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.SET_TAGS,
    async (event: IpcMainInvokeEvent, raw): Promise<SetRepoTagsResult> => {
      assertRendererFrame(event);
      return handleCatalogSetTags(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.DELETE,
    async (event: IpcMainInvokeEvent, raw): Promise<DeleteRepoResult> => {
      assertRendererFrame(event);
      return handleCatalogDelete(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.SMART_FILTER,
    async (event: IpcMainInvokeEvent, raw): Promise<SmartFilterResult> => {
      assertRendererFrame(event);
      return handleCatalogSmartFilter(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.COVER,
    async (event: IpcMainInvokeEvent, raw): Promise<CoverResult> => {
      assertRendererFrame(event);
      return handleCatalogCover(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.MOVE_CHECK,
    async (event: IpcMainInvokeEvent, raw): Promise<MoveCheckResult> => {
      assertRendererFrame(event);
      return handleCatalogMoveCheck(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.MOVE,
    async (event: IpcMainInvokeEvent, raw): Promise<MoveResult> => {
      assertRendererFrame(event);
      return handleCatalogMove(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.MOVE_UNDO,
    async (event: IpcMainInvokeEvent, raw): Promise<MoveResult> => {
      assertRendererFrame(event);
      return handleCatalogMoveUndo(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.MOVE_LAST,
    async (event: IpcMainInvokeEvent, raw): Promise<MoveLastResult> => {
      assertRendererFrame(event);
      return handleCatalogMoveLast(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.FOLDER_CHECK,
    async (event: IpcMainInvokeEvent, raw): Promise<FolderCheckResult> => {
      assertRendererFrame(event);
      return handleCatalogFolderCheck(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.FOLDER_RENAME,
    async (event: IpcMainInvokeEvent, raw): Promise<FolderOpResult> => {
      assertRendererFrame(event);
      return handleCatalogFolderRename(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.FOLDER_MOVE,
    async (event: IpcMainInvokeEvent, raw): Promise<FolderOpResult> => {
      assertRendererFrame(event);
      return handleCatalogFolderMove(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.FOLDER_CREATE,
    async (event: IpcMainInvokeEvent, raw): Promise<FolderOpResult> => {
      assertRendererFrame(event);
      return handleCatalogFolderCreate(raw);
    },
  );

  ipcMain.handle(
    IPC.CATALOG.SET_FAVORITE,
    async (event: IpcMainInvokeEvent, raw): Promise<SetFavoriteResult> => {
      assertRendererFrame(event);
      return handleCatalogSetFavorite(raw);
    },
  );
}
