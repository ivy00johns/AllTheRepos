/**
 * IPC handlers — `scan:*` namespace.
 *
 * Three request/response handlers (`scan:start`, `scan:status`,
 * `scan:cancel`). The push-style `scan:on:progress` event stream is
 * NOT wired here — the canonical subscription lives in
 * `src/main/index.ts` so the broadcaster is co-located with
 * `BrowserWindow` lifecycle (and is registered exactly once per app
 * boot, not per handler-registration call).
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  CancelScanInputSchema,
  CancelScanResultSchema,
  ScanStatusInputSchema,
  ScanStatusResultSchema,
  StartScanInputSchema,
  StartScanResultSchema,
} from "@shared/schemas";
import type {
  CancelScanResult,
  ScanStatusResult,
  StartScanResult,
} from "@shared/types";

import { scanService } from "@main/services/scan";

import { assertRendererFrame } from "./_frame";

export async function handleScanStart(raw: unknown): Promise<StartScanResult> {
  const input = StartScanInputSchema.parse(raw);
  const result = await scanService.start(input);
  return StartScanResultSchema.parse(result);
}

export async function handleScanStatus(raw: unknown): Promise<ScanStatusResult> {
  const input = ScanStatusInputSchema.parse(raw);
  const result = await scanService.status(input.jobId);
  return ScanStatusResultSchema.parse(result);
}

export async function handleScanCancel(raw: unknown): Promise<CancelScanResult> {
  const input = CancelScanInputSchema.parse(raw);
  const result = await scanService.cancel(input.jobId);
  return CancelScanResultSchema.parse(result);
}

/**
 * Register every `scan:*` request/response handler. Idempotent.
 *
 * The `scan:on:progress` event subscription is intentionally NOT here —
 * see the module header for rationale.
 */
export function registerScanHandlers(): void {
  const channels = [
    IPC.SCAN.START,
    IPC.SCAN.STATUS,
    IPC.SCAN.CANCEL,
  ] as const;
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    IPC.SCAN.START,
    async (event: IpcMainInvokeEvent, raw): Promise<StartScanResult> => {
      assertRendererFrame(event);
      return handleScanStart(raw);
    },
  );

  ipcMain.handle(
    IPC.SCAN.STATUS,
    async (event: IpcMainInvokeEvent, raw): Promise<ScanStatusResult> => {
      assertRendererFrame(event);
      return handleScanStatus(raw);
    },
  );

  ipcMain.handle(
    IPC.SCAN.CANCEL,
    async (event: IpcMainInvokeEvent, raw): Promise<CancelScanResult> => {
      assertRendererFrame(event);
      return handleScanCancel(raw);
    },
  );
}
