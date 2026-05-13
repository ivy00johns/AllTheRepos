/**
 * Ambient typings for the renderer.
 *
 * Including this file from the renderer's `tsconfig.web.json` makes
 * `window.atr.*` strongly typed without any runtime cost. The
 * `PRELOAD_BRIDGE_KEY` constant in `@shared/ipc` MUST match the literal
 * `"atr"` used here; the cross-check is the test in `tests/preload`.
 */

import type { AtrApi } from "./api";

declare global {
  interface Window {
    /** Renderer-side IPC surface exposed by the preload. */
    readonly atr: AtrApi;
  }
}

export {};
