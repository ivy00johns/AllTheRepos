/**
 * IPC handlers — `settings:*` namespace.
 *
 * Two handlers: `settings:get` and `settings:update`. The backing store
 * is `electron-store` (owned by backend-services); this layer is a thin
 * Zod-validated façade.
 *
 * `settings:update` validates the patch with `SettingsSchema.partial()`
 * (via `UpdateSettingsInputSchema`) — last-write-wins merging is the
 * service's responsibility, not ours.
 */

import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";

import { IPC } from "@shared/ipc";
import {
  GetSettingsInputSchema,
  GetSettingsResultSchema,
  UpdateSettingsInputSchema,
  UpdateSettingsResultSchema,
  PickScanPathInputSchema,
  PickScanPathResultSchema,
  AddScanPathInputSchema,
  AddScanPathResultSchema,
  RemoveScanPathInputSchema,
  RemoveScanPathResultSchema,
  CountUnderInputSchema,
  CountUnderResultSchema,
} from "@shared/schemas";
import type {
  GetSettingsResult,
  UpdateSettingsResult,
  PickScanPathResult,
  AddScanPathResult,
  RemoveScanPathResult,
  CountUnderResult,
} from "@shared/types";

import { getSettings, updateSettings } from "@main/services/settings";
import { scanRootService } from "@main/services/scan-roots";
import { repoWatchService } from "@main/services/watch";

import { assertRendererFrame } from "./_frame";

export async function handleSettingsGet(raw: unknown): Promise<GetSettingsResult> {
  GetSettingsInputSchema.parse(raw);
  const result = getSettings();
  return GetSettingsResultSchema.parse(result);
}

export async function handleSettingsUpdate(
  raw: unknown,
): Promise<UpdateSettingsResult> {
  const patch = UpdateSettingsInputSchema.parse(raw);
  const result = updateSettings(patch);
  // Settings is the other route to editing scan roots (the form), and
  // the watcher has to follow them wherever they're changed from.
  if (patch.scanPaths !== undefined) void repoWatchService.restart();
  return UpdateSettingsResultSchema.parse(result);
}


/**
 * Open the native folder picker.
 *
 * Needs the requesting window so the sheet is modal to it rather than
 * floating free, which is why this one handler takes the event instead
 * of just the payload.
 */
export async function handleSettingsPickScanPath(
  event: IpcMainInvokeEvent,
  raw: unknown,
): Promise<PickScanPathResult> {
  PickScanPathInputSchema.parse(raw);
  const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const result = await dialog.showOpenDialog(window!, {
    title: "Choose a folder to scan",
    buttonLabel: "Scan this folder",
    properties: ["openDirectory", "createDirectory"],
  });
  const picked = result.canceled ? null : (result.filePaths[0] ?? null);
  return PickScanPathResultSchema.parse({ path: picked });
}

export async function handleSettingsAddScanPath(
  raw: unknown,
): Promise<AddScanPathResult> {
  const input = AddScanPathInputSchema.parse(raw);
  const result = await scanRootService.add(input.path);
  return AddScanPathResultSchema.parse(result);
}

export async function handleSettingsRemoveScanPath(
  raw: unknown,
): Promise<RemoveScanPathResult> {
  const input = RemoveScanPathInputSchema.parse(raw);
  const result = await scanRootService.remove(input.path, input.forgetRepos);
  return RemoveScanPathResultSchema.parse(result);
}

export async function handleSettingsCountUnder(
  raw: unknown,
): Promise<CountUnderResult> {
  const input = CountUnderInputSchema.parse(raw);
  return CountUnderResultSchema.parse({
    count: scanRootService.countUnder(input.path),
  });
}

/** Register every `settings:*` handler. Idempotent. */
export function registerSettingsHandlers(): void {
  const channels = [
    IPC.SETTINGS.GET,
    IPC.SETTINGS.UPDATE,
    IPC.SETTINGS.PICK_SCAN_PATH,
    IPC.SETTINGS.ADD_SCAN_PATH,
    IPC.SETTINGS.REMOVE_SCAN_PATH,
    IPC.SETTINGS.COUNT_UNDER,
  ] as const;
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    IPC.SETTINGS.GET,
    async (event: IpcMainInvokeEvent, raw): Promise<GetSettingsResult> => {
      assertRendererFrame(event);
      return handleSettingsGet(raw);
    },
  );

  ipcMain.handle(
    IPC.SETTINGS.UPDATE,
    async (event: IpcMainInvokeEvent, raw): Promise<UpdateSettingsResult> => {
      assertRendererFrame(event);
      return handleSettingsUpdate(raw);
    },
  );

  ipcMain.handle(
    IPC.SETTINGS.PICK_SCAN_PATH,
    async (event: IpcMainInvokeEvent, raw): Promise<PickScanPathResult> => {
      assertRendererFrame(event);
      return handleSettingsPickScanPath(event, raw);
    },
  );

  ipcMain.handle(
    IPC.SETTINGS.ADD_SCAN_PATH,
    async (event: IpcMainInvokeEvent, raw): Promise<AddScanPathResult> => {
      assertRendererFrame(event);
      return handleSettingsAddScanPath(raw);
    },
  );

  ipcMain.handle(
    IPC.SETTINGS.REMOVE_SCAN_PATH,
    async (event: IpcMainInvokeEvent, raw): Promise<RemoveScanPathResult> => {
      assertRendererFrame(event);
      return handleSettingsRemoveScanPath(raw);
    },
  );

  ipcMain.handle(
    IPC.SETTINGS.COUNT_UNDER,
    async (event: IpcMainInvokeEvent, raw): Promise<CountUnderResult> => {
      assertRendererFrame(event);
      return handleSettingsCountUnder(raw);
    },
  );
}
