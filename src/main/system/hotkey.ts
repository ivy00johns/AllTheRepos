/**
 * Global accelerator registration — the `CommandOrControl+Shift+Space`
 * spotlight hotkey.
 *
 * Hard rules (see NEW-PLAN.md §5.8 + §6):
 *   - `globalShortcut.register` MUST be called AFTER `app.whenReady()`.
 *   - `globalShortcut.unregisterAll()` MUST be called on `before-quit`.
 *   - Registration MAY fail (the OS or another app already owns the
 *     accelerator) — we log a warning and continue rather than crash.
 *
 * The hotkey toggles the spotlight window (show if hidden, hide if
 * already visible). The toggle policy lives in backend-windows'
 * `spotlightWindow.toggle()`; this module just calls it.
 */

import { globalShortcut } from "electron";

import {
  hideSpotlightWindow,
  showSpotlightWindow,
  toggleSpotlightWindow,
} from "./spotlight-bridge";

/** The single Phase 2 global shortcut. */
export const SPOTLIGHT_ACCELERATOR = "CommandOrControl+Shift+Space" as const;

/**
 * Register the spotlight hotkey. Called once from `app.whenReady()`.
 * Logs but does not throw on registration failure — global shortcuts
 * are best-effort.
 */
export function registerGlobalHotkeys(): void {
  // Be defensive against double-registration on hot-reload — Electron
  // will return `false` from `register` if the accelerator is already
  // bound, but `isRegistered` lets us short-circuit cleanly.
  if (globalShortcut.isRegistered(SPOTLIGHT_ACCELERATOR)) {
    return;
  }

  const ok = globalShortcut.register(SPOTLIGHT_ACCELERATOR, () => {
    toggleSpotlightWindow();
  });

  if (!ok) {
    console.warn(
      `[hotkey] failed to register ${SPOTLIGHT_ACCELERATOR} — likely an OS / app conflict`,
    );
  }
}

/**
 * Unregister every global shortcut. Called from `before-quit` in
 * `src/main/index.ts`. Idempotent — safe to call multiple times.
 */
export function unregisterGlobalHotkeys(): void {
  globalShortcut.unregisterAll();
}

/**
 * Public helper used by the tray fallback menu and the menu module so
 * "Open Spotlight" can route through the same code path as the global
 * accelerator.
 */
export function showSpotlight(): void {
  showSpotlightWindow();
}

/** Public helper symmetric with `showSpotlight`. */
export function hideSpotlight(): void {
  hideSpotlightWindow();
}
