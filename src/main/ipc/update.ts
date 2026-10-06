/**
 * IPC handlers — `update:*` namespace.
 *
 * Thin façade over `updaterService`. `check` triggers a real network
 * round-trip; `status` is a cheap read of the last known state, so the
 * renderer can render immediately on mount without provoking a check.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  OpenReleaseInputSchema,
  OpenReleaseResultSchema,
  UpdateCheckInputSchema,
  UpdateStatusInputSchema,
  UpdateStatusSchema,
} from "@shared/schemas";
import type { OpenReleaseResult, UpdateStatus } from "@shared/types";

import { updaterService } from "@main/services/updater";

import { assertRendererFrame } from "./_frame";

export async function handleUpdateCheck(raw: unknown): Promise<UpdateStatus> {
  UpdateCheckInputSchema.parse(raw);
  return UpdateStatusSchema.parse(await updaterService.check());
}

export async function handleUpdateStatus(raw: unknown): Promise<UpdateStatus> {
  UpdateStatusInputSchema.parse(raw);
  return UpdateStatusSchema.parse(updaterService.current());
}

export async function handleUpdateOpenRelease(
  raw: unknown,
): Promise<OpenReleaseResult> {
  OpenReleaseInputSchema.parse(raw);
  return OpenReleaseResultSchema.parse(await updaterService.openRelease());
}

/** Register every `update:*` handler. Idempotent. */
export function registerUpdateHandlers(): void {
  const channels = [
    IPC.UPDATE.CHECK,
    IPC.UPDATE.STATUS,
    IPC.UPDATE.OPEN_RELEASE,
  ] as const;
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    IPC.UPDATE.CHECK,
    async (event: IpcMainInvokeEvent, raw): Promise<UpdateStatus> => {
      assertRendererFrame(event);
      return handleUpdateCheck(raw);
    },
  );

  ipcMain.handle(
    IPC.UPDATE.STATUS,
    async (event: IpcMainInvokeEvent, raw): Promise<UpdateStatus> => {
      assertRendererFrame(event);
      return handleUpdateStatus(raw);
    },
  );

  ipcMain.handle(
    IPC.UPDATE.OPEN_RELEASE,
    async (event: IpcMainInvokeEvent, raw): Promise<OpenReleaseResult> => {
      assertRendererFrame(event);
      return handleUpdateOpenRelease(raw);
    },
  );
}
