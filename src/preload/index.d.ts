/**
 * Ambient typings for the renderer.
 *
 * Including this file from the renderer's `tsconfig.web.json` makes
 * `window.atr.*` strongly typed without any runtime cost. The
 * `PRELOAD_BRIDGE_KEY` constant in `@shared/ipc` MUST match the literal
 * `"atr"` used here; the cross-check is the test in `tests/preload`.
 *
 * Phase 1 surface (all derived from `typeof api` in `./api.ts`):
 *   - `window.atr.system.ping`
 *   - `window.atr.catalog.{list,get,search,rescan,setTags,smartFilter}`
 *   - `window.atr.scan.{start,status,cancel,onProgress}`
 *   - `window.atr.git.{status,branches,openInEditor}`
 *   - `window.atr.settings.{get,update}`
 *   - `window.atr.groups.{list,create,rename,delete,setMembers}`
 *
 * `scan.onProgress(cb)` is the only non-`invoke` method — it returns an
 * unsubscribe lambda that the renderer MUST call from cleanup.
 */

import type { AtrApi } from "./api";

declare global {
  interface Window {
    /** Renderer-side IPC surface exposed by the preload. */
    readonly atr: AtrApi;
  }
}

export type { AtrApi };

export {};
