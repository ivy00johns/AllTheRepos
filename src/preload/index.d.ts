/**
 * Ambient typings for the renderer.
 *
 * Including this file from the renderer's `tsconfig.web.json` makes
 * `window.atr.*` strongly typed without any runtime cost. The
 * `PRELOAD_BRIDGE_KEY` constant in `@shared/ipc` MUST match the literal
 * `"atr"` used here; the cross-check is the test in `tests/preload`.
 *
 * Current surface (all derived from `typeof api` in `./api.ts`).
 * The TYPE below is always exactly `typeof api`, so this list is a
 * human-readable index, not a second source of truth — keep it in
 * step with `./api.ts` when namespaces change.
 *
 * Build facts (synchronous, no IPC — see `@shared/build-info`):
 *   - `window.atr.build.packaged`
 *
 * Phase 0/1/2:
 *   - `window.atr.system.ping`
 *   - `window.atr.catalog.{list,get,search,rescan,setTags,delete,smartFilter}`
 *   - `window.atr.scan.{start,status,cancel,onProgress}`
 *   - `window.atr.git.{status,branches,openInEditor}`
 *   - `window.atr.settings.{get,update}`
 *   - `window.atr.groups.{list,create,rename,delete,setMembers}`
 *   - `window.atr.app.{setDockBadge,notify,showSpotlight,hideSpotlight,registerActions}`
 *   - `window.atr.app.{onMenuCommand,onDeepLink,onTrayOpenRepo}` (push streams)
 *
 * Phase 3a (process + launcher):
 *   - `window.atr.process.{list,listForRepo,refresh,kill,onUpdate}`
 *   - `window.atr.launcher.{detect,openInEditor,openInTerminal,openInFinder,openRemote,copyPath}`
 *
 * Phase 3b (Claude Code integration):
 *   - `window.atr.claude.{index,projects,repoState,sessionTranscript,globalUsage,launch,openClaudeMd,onUpdate}`
 *
 * The `on*` methods (`scan.onProgress`; `app.onMenuCommand`,
 * `app.onDeepLink`, `app.onTrayOpenRepo`; `process.onUpdate`;
 * `claude.onUpdate`) are the only non-`invoke` methods — each returns
 * an unsubscribe lambda the renderer MUST call from cleanup to avoid
 * listener leaks on hot-reload.
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
