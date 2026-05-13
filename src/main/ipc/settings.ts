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

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  GetSettingsInputSchema,
  GetSettingsResultSchema,
  UpdateSettingsInputSchema,
  UpdateSettingsResultSchema,
} from "@shared/schemas";
import type {
  GetSettingsResult,
  UpdateSettingsResult,
} from "@shared/types";

import { getSettings, updateSettings } from "@main/services/settings";

import { assertRendererFrame } from "./_frame";

export async function handleSettingsGet(raw: unknown): Promise<GetSettingsResult> {
  GetSettingsInputSchema.parse(raw);
  const result = getSettings();
  return GetSettingsResultSchema.parse(result);
}

export async function handleSettingsUpdate(raw: unknown): Promise<UpdateSettingsResult> {
  const patch = UpdateSettingsInputSchema.parse(raw);
  const result = updateSettings(patch);
  return UpdateSettingsResultSchema.parse(result);
}

/** Register every `settings:*` handler. Idempotent. */
export function registerSettingsHandlers(): void {
  const channels = [IPC.SETTINGS.GET, IPC.SETTINGS.UPDATE] as const;
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
}
