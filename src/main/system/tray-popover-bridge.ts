/**
 * Thin bridge to the tray popover window.
 *
 * `src/main/window/tray-popover.ts` exports `trayPopover`; this module is the main
 * process's one way to reach it, so `tray.ts`'s click handler does not import a
 * window factory directly.
 *
 * **The static import is a bug fix.** This used to be a
 * `require("@main/window/tray-popover")` in a try/catch, for two reasons that
 * have both expired: the window factory was being written in parallel, and the
 * popover was meant to be optional. But `@main` is a *build-time* alias
 * (`electron.vite.config.ts`): the bundler rewrites `import` specifiers and leaves
 * a `require` in the output alone, so `out/main/index.js` shipped with
 * `require("@main/window/tray-popover")` and none of the popover's code. Every
 * click on the tray icon took the fallback path — `throw` → the right-click menu
 * — which is why the popover was never seen in a built app. It is bundled now:
 * `tests/e2e/type-scale.spec.ts` opens and audits it, and that is the check that
 * would have caught this. The click handler keeps its context-menu fallback for a
 * genuine failure to show (a display that has gone away, a window already
 * destroyed), not for a module that was missing.
 */

import type { Rectangle } from "electron";

import { trayPopover } from "@main/window/tray-popover";

/** Show the popover anchored to the tray icon's bounds. */
export function showTrayPopover(bounds: Rectangle): void {
  trayPopover.showAt(bounds);
}

/** Hide the popover. No-op when it has never been shown. */
export function hideTrayPopover(): void {
  trayPopover.hide();
}

/** Whether the popover is currently on screen. */
export function isTrayPopoverVisible(): boolean {
  return trayPopover.isVisible();
}
