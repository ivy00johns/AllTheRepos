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
} from "@shared/schemas";
import type {
  GetRepoResult,
  ListReposResult,
  RescanRepoResult,
  SearchReposResult,
  SetRepoTagsResult,
  SmartFilterResult,
} from "@shared/types";

import { catalogService } from "@main/services/catalog";
import { searchService } from "@main/services/search";

import { assertRendererFrame } from "./_frame";

export async function handleCatalogList(raw: unknown): Promise<ListReposResult> {
  const input = ListReposInputSchema.parse(raw);
  const result = await catalogService.list(input);
  return ListReposResultSchema.parse(result);
}

export async function handleCatalogGet(raw: unknown): Promise<GetRepoResult> {
  const input = GetRepoInputSchema.parse(raw);
  const result = await catalogService.get(input.slug);
  return GetRepoResultSchema.parse(result);
}

export async function handleCatalogSearch(raw: unknown): Promise<SearchReposResult> {
  const input = SearchReposInputSchema.parse(raw);
  const result = await searchService.search(input);
  return SearchReposResultSchema.parse(result);
}

export async function handleCatalogRescan(raw: unknown): Promise<RescanRepoResult> {
  const input = RescanRepoInputSchema.parse(raw);
  const result = await catalogService.rescan(input.slug);
  return RescanRepoResultSchema.parse(result);
}

export async function handleCatalogSetTags(raw: unknown): Promise<SetRepoTagsResult> {
  const input = SetRepoTagsInputSchema.parse(raw);
  const result = await catalogService.setTags(input.slug, input.tags);
  return SetRepoTagsResultSchema.parse(result);
}

/**
 * Phase 1 stub: contract-locked, returns `[]`. Phase 4 will swap in the
 * real LLM-tagging implementation. The renderer can wire the UI today.
 */
export async function handleCatalogSmartFilter(raw: unknown): Promise<SmartFilterResult> {
  SmartFilterInputSchema.parse(raw);
  const empty: SmartFilterResult = [];
  return SmartFilterResultSchema.parse(empty);
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
    IPC.CATALOG.SMART_FILTER,
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
    IPC.CATALOG.SMART_FILTER,
    async (event: IpcMainInvokeEvent, raw): Promise<SmartFilterResult> => {
      assertRendererFrame(event);
      return handleCatalogSmartFilter(raw);
    },
  );
}
