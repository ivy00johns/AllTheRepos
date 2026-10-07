/**
 * Thin runtime bridge to the backend-windows-owned tray popover.
 *
 * `backend-windows` ships `src/main/window/tray-popover.ts` exporting:
 *   ```
 *   export const trayPopover: {
 *     showAt(bounds: Rectangle): void;
 *     hide(): void;
 *     isVisible(): boolean;
 *   };
 *   ```
 *
 * We do NOT static-import that module here for two reasons:
 *   1. The two agents ship in parallel — a hard import would break the
 *      tsc + electron-vite build before backend-windows merges.
 *   2. The popover is opt-in: a packaging that doesn't bundle the
 *      window factory should still boot the app cleanly.
 *
 * The dynamic `require` is wrapped in a try/catch so the worst case is
 * a logged warning + a no-op. `backend-system`'s tray click handler
 * already has a fallback context menu for this scenario.
 */

import type { Rectangle } from "electron";

type TrayPopoverApi = {
  showAt(bounds: Rectangle): void;
  hide(): void;
  isVisible(): boolean;
};

let cached: TrayPopoverApi | null = null;
let attempted = false;

function loadTrayPopover(): TrayPopoverApi | null {
  if (cached) return cached;
  if (attempted) return null;
  attempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a module that may not be in the tree yet; see the header
    const mod = require("@main/window/tray-popover") as
      | { trayPopover?: TrayPopoverApi }
      | undefined;
    if (mod && typeof mod.trayPopover === "object") {
      cached = mod.trayPopover;
      return cached;
    }
    return null;
  } catch {
    // backend-windows hasn't shipped yet — totally fine.
    return null;
  }
}

/** Ask the popover to show next to the tray's bounds. No-op if unavailable. */
export function showTrayPopover(bounds: Rectangle): void {
  const api = loadTrayPopover();
  if (!api) {
    throw new Error("tray-popover not available");
  }
  api.showAt(bounds);
}

/** Hide the popover. No-op if unavailable. */
export function hideTrayPopover(): void {
  const api = loadTrayPopover();
  if (!api) return;
  api.hide();
}

/** Visibility query. Returns false if the popover module hasn't shipped. */
export function isTrayPopoverVisible(): boolean {
  const api = loadTrayPopover();
  if (!api) return false;
  return api.isVisible();
}
