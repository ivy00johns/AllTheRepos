/**
 * Renderer-side façade over the preload `contextBridge` surface.
 *
 * Renderer code MUST import the bridge through this module rather than
 * touching `window.atr` directly. This gives us a single seam to:
 *   - mock the bridge in unit tests / Storybook,
 *   - detect when the renderer is running outside Electron (e.g. a plain
 *     browser tab during QE) and surface a graceful fallback,
 *   - swap in a different transport later (e.g. electron-trpc) without
 *     churning every call site.
 *
 * Types come from `src/preload/index.d.ts` (owned by the backend agent).
 * In Phase 0 the preload may not yet expose its `.d.ts`, so we fall back
 * to a structural type sourced from the shared Phase 0 schemas.
 */

import type { PingInput, PingResponse } from "@shared/types";

/**
 * Phase 0 IPC surface as exposed on `window.atr` by the preload script.
 *
 * Keep this in sync with `src/preload/index.d.ts`. New namespaces land
 * here as later phases unlock them.
 */
export interface AtrBridge {
  system: {
    ping(input?: PingInput): Promise<PingResponse>;
  };
}

declare global {
  interface Window {
    atr?: AtrBridge;
  }
}

/**
 * Returns the preload bridge if it is mounted, otherwise `null`.
 *
 * Renderer features should branch on this and render a graceful "preload
 * bridge unavailable" state so the renderer is still runnable in a
 * vanilla browser during QE / Storybook work.
 */
export function getAtr(): AtrBridge | null {
  if (typeof window === "undefined") return null;
  return window.atr ?? null;
}

/**
 * Throwing variant for code paths that absolutely require the bridge.
 * Prefer `getAtr()` plus a UI fallback in app-level components.
 */
export function requireAtr(): AtrBridge {
  const bridge = getAtr();
  if (!bridge) {
    throw new Error(
      "window.atr is undefined — preload bridge is not mounted. " +
        "Run via `pnpm electron:dev` so the Electron preload script loads.",
    );
  }
  return bridge;
}
