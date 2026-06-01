/**
 * Shared frame-origin check used by every IPC handler.
 *
 * This module is the SINGLE SOURCE OF TRUTH for "did this IPC request
 * originate from our own renderer's main frame?". `system.ts` (Phase 0)
 * re-exports `assertRendererFrame` from here rather than keeping its own
 * divergent copy, so the security policy lives in exactly one place
 * (ATR-014). Every other handler module imports `assertRendererFrame`
 * from this file — keep that exported signature stable.
 *
 * Policy (§3.4 — "every handler validates the sender frame"):
 *   - A frame whose URL points at our dev renderer (`ELECTRON_RENDERER_URL`)
 *     or at the packaged `file://` bundle is accepted.
 *   - An EMPTY or `about:blank` frame URL is accepted ONLY in a dev-like
 *     environment (un-packaged build, i.e. `electron-vite dev` / unit
 *     tests), where the renderer legitimately presents an empty URL
 *     during HMR/boot. In a PRODUCTION (packaged) build an empty /
 *     `about:blank` URL is REJECTED — a foreign frame must not slip
 *     through on an unset origin.
 */

import type { IpcMainInvokeEvent } from "electron";

/**
 * True when we are NOT a packaged production build — i.e. running under
 * `electron-vite dev` or a unit-test/Node context. We only relax the
 * empty / `about:blank` frame-URL allowance in this mode.
 *
 * Signals (any one is sufficient):
 *   - `ELECTRON_RENDERER_URL` is set (electron-vite dev injects this).
 *   - `app.isPackaged === false` (Electron runtime, dev/un-packaged).
 *
 * `app` is read lazily and defensively: in a plain Node/vitest context
 * `electron` is externalised and `require` either throws or yields a stub
 * without `isPackaged`. We treat any such failure as "not packaged" so
 * unit tests (which run un-packaged, with no Electron runtime) keep
 * exercising the dev-permissive path.
 *
 * Exported so the frame-check seam is unit-testable without an Electron
 * runtime — callers/tests can pass an explicit override to `isFrameFromOurRenderer`.
 */
export function isDevLikeEnvironment(): boolean {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (typeof rendererUrl === "string" && rendererUrl.length > 0) {
    return true;
  }
  try {
    // Lazy require so this module stays importable from vitest, where
    // `electron` is externalised and has no real runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as { app?: { isPackaged?: boolean } };
    const isPackaged = electron?.app?.isPackaged;
    if (typeof isPackaged === "boolean") {
      return isPackaged === false;
    }
  } catch {
    // No Electron runtime (unit tests / tooling) — treat as dev-like.
  }
  // Default: when we cannot prove we're packaged, assume dev-like so the
  // boot/HMR empty-URL path is not broken outside production.
  return true;
}

/**
 * Decides whether `frameUrl` belongs to our renderer's main frame.
 *
 * @param frameUrl the `senderFrame.url` (empty string when unset).
 * @param devLike  override for the dev-like signal (defaults to
 *                  {@link isDevLikeEnvironment}). Exists so unit tests can
 *                  assert BOTH the production (reject empty) and dev
 *                  (allow empty) branches deterministically.
 */
export function isFrameFromOurRenderer(
  frameUrl: string,
  devLike: boolean = isDevLikeEnvironment(),
): boolean {
  if (frameUrl === "" || frameUrl === "about:blank") {
    // Renderer init legitimately has an empty URL during HMR/boot, but
    // only in a dev-like context. In production an empty/about:blank
    // frame URL is treated as foreign and rejected (ATR-014).
    return devLike;
  }
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl && frameUrl.startsWith(rendererUrl)) {
    return true;
  }
  // Production: renderer is loaded from a file:// URL pointing into out/renderer.
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
