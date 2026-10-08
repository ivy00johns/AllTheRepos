/**
 * Thin bridge to the spotlight window.
 *
 * `src/main/window/spotlight.ts` exports `spotlightWindow`; this module is the
 * main process's one way to reach it, so `hotkey.ts` and the `app:showSpotlight`
 * IPC handler do not import a window factory directly.
 *
 * **It is a static import on purpose, and that is a bug fix.** It used to be a
 * `require("@main/window/spotlight")` inside a try/catch, so that the build would
 * succeed while the window factory was still being written alongside it. But
 * `@main` is a *build-time* alias (see `electron.vite.config.ts`): the bundler
 * rewrites `import` specifiers and does not touch a `require` left in the output.
 * `out/main/index.js` therefore shipped with the literal
 * `require("@main/window/spotlight")` and without a single line of the window
 * factory — so `loadSpotlight()` threw, the bridge logged its warning, and the
 * spotlight could not open in any built app. The same was true of the tray
 * popover's bridge. Both factories are in the tree now, so both are imported
 * statically and both are bundled; `tests/e2e/type-scale.spec.ts` opens and audits
 * each of them on the built app, which is the check that would have caught it.
 */

import { spotlightWindow } from "@main/window/spotlight";

/** Show the spotlight window, creating it if this is its first appearance. */
export function showSpotlightWindow(): void {
  spotlightWindow.show();
}

/** Hide it. Safe when it has never been shown — main hides a window it owns and
 * the window factory treats a missing window as nothing to hide. */
export function hideSpotlightWindow(): void {
  spotlightWindow.hide();
}

/** What the global accelerator runs: show if hidden, hide if already up. */
export function toggleSpotlightWindow(): void {
  spotlightWindow.toggle();
}
