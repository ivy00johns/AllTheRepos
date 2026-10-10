/**
 * IPC handlers - `launcher:*` namespace (Phase 3a).
 *
 * Six channels: `detect`, `openInEditor`, `openInTerminal`, `openInFinder`,
 * `openRemote`, `copyPath`. Each handler:
 *   1. Asserts the request came from our renderer frame.
 *   2. Zod-parses the raw input.
 *   3. Delegates to `launcherService`.
 *   4. Zod-parses the result before returning.
 *
 * The service NEVER throws back to the renderer for "expected" misses
 * (no editor installed, no origin remote, etc.) - those surface as
 * `{ ok: false, reason }` envelopes. Unexpected exceptions in the
 * service bubble up as a thrown promise here, which becomes a renderer-
 * side rejection.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  DetectLauncherInputSchema,
  DetectLauncherResultSchema,
  LauncherResultSchema,
  OpenInEditorPhase3InputSchema,
  OpenInTerminalInputSchema,
  OpenSlugInputSchema,
} from "@shared/schemas";
import type { DetectLauncherResult, LauncherResult } from "@shared/types";

import { launcherService } from "@main/services/launcher";

import { assertRendererFrame } from "./_frame";

export async function handleLauncherDetect(
  raw: unknown,
): Promise<DetectLauncherResult> {
  DetectLauncherInputSchema.parse(raw ?? {});
  // boot() is idempotent - safe to call here if the main entry didn't
  // already prime it. We `await` so the first IPC call after a cold
  // start blocks on detection rather than returning an empty snapshot.
  await launcherService.boot();
  const result = launcherService.detect();
  return DetectLauncherResultSchema.parse(result);
}

export async function handleLauncherOpenInEditor(
  raw: unknown,
): Promise<LauncherResult> {
  const input = OpenInEditorPhase3InputSchema.parse(raw);
  const result = await launcherService.openInEditor(input);
  return LauncherResultSchema.parse(result);
}

export async function handleLauncherOpenInTerminal(
  raw: unknown,
): Promise<LauncherResult> {
  const input = OpenInTerminalInputSchema.parse(raw);
  const result = await launcherService.openInTerminal(input);
  return LauncherResultSchema.parse(result);
}

export async function handleLauncherOpenInFinder(
  raw: unknown,
): Promise<LauncherResult> {
  const input = OpenSlugInputSchema.parse(raw);
  const result = await launcherService.openInFinder(input);
  return LauncherResultSchema.parse(result);
}

export async function handleLauncherOpenRemote(
  raw: unknown,
): Promise<LauncherResult> {
  const input = OpenSlugInputSchema.parse(raw);
  const result = await launcherService.openRemote(input);
  return LauncherResultSchema.parse(result);
}

export async function handleLauncherCopyPath(
  raw: unknown,
): Promise<LauncherResult> {
  const input = OpenSlugInputSchema.parse(raw);
  const result = await launcherService.copyPath(input);
  return LauncherResultSchema.parse(result);
}

/**
 * Register every `launcher:*` handler. Idempotent - removes existing
 * handlers before re-registering (matches the pattern used by every
 * other namespace in this project).
 */
export function registerLauncherHandlers(): void {
  const channels = [
    IPC.LAUNCHER.DETECT,
    IPC.LAUNCHER.OPEN_IN_EDITOR,
    IPC.LAUNCHER.OPEN_IN_TERMINAL,
    IPC.LAUNCHER.OPEN_IN_FINDER,
    IPC.LAUNCHER.OPEN_REMOTE,
    IPC.LAUNCHER.COPY_PATH,
  ] as const;
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    IPC.LAUNCHER.DETECT,
    async (event: IpcMainInvokeEvent, raw): Promise<DetectLauncherResult> => {
      assertRendererFrame(event);
      return handleLauncherDetect(raw);
    },
  );

  ipcMain.handle(
    IPC.LAUNCHER.OPEN_IN_EDITOR,
    async (event: IpcMainInvokeEvent, raw): Promise<LauncherResult> => {
      assertRendererFrame(event);
      // The detection result decides which editor this opens. The window no
      // longer waits for detection (ATR-055), so the first click of a launch
      // could otherwise be answered from the defensive empty cache.
      await launcherService.boot();
      return handleLauncherOpenInEditor(raw);
    },
  );

  ipcMain.handle(
    IPC.LAUNCHER.OPEN_IN_TERMINAL,
    async (event: IpcMainInvokeEvent, raw): Promise<LauncherResult> => {
      assertRendererFrame(event);
      await launcherService.boot();
      return handleLauncherOpenInTerminal(raw);
    },
  );

  ipcMain.handle(
    IPC.LAUNCHER.OPEN_IN_FINDER,
    async (event: IpcMainInvokeEvent, raw): Promise<LauncherResult> => {
      assertRendererFrame(event);
      return handleLauncherOpenInFinder(raw);
    },
  );

  ipcMain.handle(
    IPC.LAUNCHER.OPEN_REMOTE,
    async (event: IpcMainInvokeEvent, raw): Promise<LauncherResult> => {
      assertRendererFrame(event);
      await launcherService.boot();
      return handleLauncherOpenRemote(raw);
    },
  );

  ipcMain.handle(
    IPC.LAUNCHER.COPY_PATH,
    async (event: IpcMainInvokeEvent, raw): Promise<LauncherResult> => {
      assertRendererFrame(event);
      return handleLauncherCopyPath(raw);
    },
  );
}
