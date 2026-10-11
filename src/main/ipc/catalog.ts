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
  SetFavoriteInputSchema,
  SetFavoriteResultSchema,
  TagCleanupApplyInputSchema,
  TagCleanupApplyResultSchema,
  TagCleanupPreviewResultSchema,
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
  SetFavoriteResult,
  TagCleanupApplyResult,
  TagCleanupPreviewResult,
} from "@shared/types";

import { setRepoFavorite } from "@main/db/queries";
import { catalogService } from "@main/services/catalog";
import { coverService } from "@main/services/cover";
import { searchService } from "@main/services/search";
import { applyTagCleanup, previewTagCleanup } from "@main/services/tag-cleanup";

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

/** Read-only: the heuristic tag changes a re-tag would make. Takes no input. */
export async function handleCatalogTagCleanupPreview(): Promise<TagCleanupPreviewResult> {
  return TagCleanupPreviewResultSchema.parse(previewTagCleanup());
}

/** Accept or reject tag-cleanup proposals. Writes only the decided repos. */
export async function handleCatalogTagCleanupApply(
  raw: unknown,
): Promise<TagCleanupApplyResult> {
  const input = TagCleanupApplyInputSchema.parse(raw);
  return TagCleanupApplyResultSchema.parse(applyTagCleanup(input));
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
    IPC.CATALOG.SET_FAVORITE,
    IPC.CATALOG.TAG_CLEANUP_PREVIEW,
    IPC.CATALOG.TAG_CLEANUP_APPLY,
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
    IPC.CATALOG.TAG_CLEANUP_PREVIEW,
    async (event: IpcMainInvokeEvent): Promise<TagCleanupPreviewResult> => {
      assertRendererFrame(event);
      return handleCatalogTagCleanupPreview();
    },
  );

  ipcMain.handle(
    IPC.CATALOG.TAG_CLEANUP_APPLY,
    async (event: IpcMainInvokeEvent, raw): Promise<TagCleanupApplyResult> => {
      assertRendererFrame(event);
      return handleCatalogTagCleanupApply(raw);
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
    IPC.CATALOG.SET_FAVORITE,
    async (event: IpcMainInvokeEvent, raw): Promise<SetFavoriteResult> => {
      assertRendererFrame(event);
      return handleCatalogSetFavorite(raw);
    },
  );
}
