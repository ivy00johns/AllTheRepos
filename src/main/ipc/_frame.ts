/**
 * Shared frame-origin check used by every IPC handler.
 *
 * Duplicates the logic in `system.ts > assertRendererFrame` (Phase 0)
 * into a Phase-1-owned helper to avoid coupling all Phase 1 handler
 * modules to `system.ts` (which would create a fan-out import that
 * isn't worth the saved 30 lines).
 *
 * Both copies MUST stay in lockstep — if you change the allow-list
 * for accepted senderFrame URLs, change it in BOTH files until a
 * future cleanup unifies them.
 */

import type { IpcMainInvokeEvent } from "electron";

function isFrameFromOurRenderer(frameUrl: string): boolean {
  if (frameUrl === "" || frameUrl === "about:blank") {
    return true;
  }
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl && frameUrl.startsWith(rendererUrl)) {
    return true;
  }
  if (frameUrl.startsWith("file://")) {
    return true;
  }
  return false;
}

/**
 * Throws if the IPC request did not originate from our renderer's
 * main frame. Call at the start of every `ipcMain.handle` callback.
 */
export function assertRendererFrame(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  const frameUrl = frame?.url ?? "";
  if (!isFrameFromOurRenderer(frameUrl)) {
    throw new Error(
      `ipc:rejected:foreign_frame frame_url=${JSON.stringify(frameUrl)}`,
    );
  }
}
