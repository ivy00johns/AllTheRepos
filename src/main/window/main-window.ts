/**
 * Factory for the application's single Phase 0 BrowserWindow.
 *
 * Security defaults (NEW-PLAN.md §3.4) are non-negotiable:
 *   - contextIsolation: true
 *   - nodeIntegration: false
 *   - sandbox: true
 *   - webSecurity: true
 *   - preload: out/preload/index.cjs (electron-vite emits cjs)
 *
 * The window loads `ELECTRON_RENDERER_URL` when set (electron-vite dev
 * server) and falls back to `out/renderer/index.html` in production.
 */

import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

import { isUrlAllowed } from "../security/allowlist";
import { rendererAdditionalArguments } from "../build-info";
import {
  readLastRoute,
  rememberRoute,
  rendererTarget,
  restorableRoute,
} from "./route-memory";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

// Module-scoped reference so other main-process modules (e.g. the menu /
// global-shortcut wiring in `system/`) can broadcast IPC to the main
// window when no window currently holds focus. Set by `createMainWindow`
// and cleared on `closed`.
let mainWindowRef: BrowserWindow | null = null;

/**
 * Returns the current main BrowserWindow, or `null` if it has been
 * closed or hasn't been created yet. Used by `backend-system` so it can
 * route `menu:on:command` IPC to the main window when there is no
 * focused window to broadcast to.
 */
export function getMainWindow(): BrowserWindow | null {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    return mainWindowRef;
  }
  return null;
}

/**
 * Create + show the main window. Caller is responsible for keeping the
 * returned reference alive (e.g. as a module-scoped variable in
 * `index.ts`) so it isn't garbage-collected.
 */
export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === "darwin";

  const window = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false, // wait for `ready-to-show` to avoid white flash
    autoHideMenuBar: !isMac,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    vibrancy: isMac ? "sidebar" : undefined,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // The one fact the renderer cannot learn for itself — whether this run is
      // the app that ships — stated where it is known and read by the preload off
      // `process.argv`. See `@shared/build-info`.
      additionalArguments: rendererAdditionalArguments(),
      // electron-vite outputs preload as CommonJS; main bundle sits at
      // `out/main/index.js`, so the preload is one level up + over.
      preload: join(__dirname, "../preload/index.cjs"),
    },
  });

  window.once("ready-to-show", () => {
    // Under E2E (`ATR_E2E=1`, set by playwright.electron.config.ts) show the
    // window WITHOUT activating it. A plain `show()` makes macOS focus the
    // app, so a test run repeatedly yanks keyboard focus away from whatever
    // the developer is typing into — and the suite launches one app per spec.
    // `showInactive()` renders identically for Playwright, which drives the
    // window over the debugger protocol and never needs it focused.
    if (process.env.ATR_E2E === "1") {
      window.showInactive();
    } else {
      window.show();
    }
  });

  // Defense in depth: any anchor with target=_blank or a window.open()
  // call must go through `shell.openExternal` AND clear the allowlist.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isUrlAllowed(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Block in-page navigation away from our renderer origin. Prevents a
  // compromised renderer from swapping to an attacker page.
  window.webContents.on("will-navigate", (event, targetUrl) => {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    const isDevAllowed =
      typeof rendererUrl === "string" &&
      rendererUrl.length > 0 &&
      targetUrl.startsWith(rendererUrl);
    const isProdAllowed = targetUrl.startsWith("file://");
    if (!isDevAllowed && !isProdAllowed) {
      event.preventDefault();
      if (isUrlAllowed(targetUrl)) {
        void shell.openExternal(targetUrl);
      }
    }
  });

  /*
   * Open where the window was left rather than on the catalog every time.
   *
   * The renderer's route lives in the address, and main is the only thing that
   * knows it at launch — so the fragment is read back here and appended to the
   * load URL. `route-memory` takes the profile directory rather than reaching
   * for `app` itself, so the decision is testable without Electron. A first
   * launch, or a memory that no longer names a route, gives `null` and this is
   * exactly the load it always was.
   */
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const isDev = typeof rendererUrl === "string" && rendererUrl.length > 0;
  void window.loadURL(
    rendererTarget({
      rendererUrl: isDev ? rendererUrl : undefined,
      indexPath: join(__dirname, "../renderer/index.html"),
      route: readLastRoute(app.getPath("userData")),
    }),
  );
  if (isDev) {
    // Dev: open DevTools so renderer errors are visible immediately.
    window.webContents.openDevTools({ mode: "right" });
  }

  /*
   * Write the fragment down as it changes, so the next launch opens on it.
   *
   * `did-navigate-in-page` is the hash change itself; `did-navigate` catches
   * the first load, so a window that was never moved still remembers where it
   * opened — which is what makes a launch that restores nothing (no memory,
   * or a fragment that is not a route) settle on the catalog instead of
   * keeping a stale map address forever.
   */
  const rememberFragment = (url: string): void => {
    const route = restorableRoute(new URL(url).hash);
    if (route !== null) rememberRoute(app.getPath("userData"), route);
  };
  window.webContents.on("did-navigate", (_event, url) => {
    rememberFragment(url);
  });
  window.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    // The renderer's route changes in the top frame; anything below it is a
    // frame's business, not the window's.
    if (isMainFrame) rememberFragment(url);
  });
  // And once as the window closes. The two events above are the browser's to
  // fire and this is the state that actually has to survive, so the last
  // address is read from the page rather than assumed to have arrived by
  // event — a belt worth wearing for a feature whose failure is silent.
  window.on("close", () => {
    if (!window.webContents.isDestroyed()) {
      rememberFragment(window.webContents.getURL());
    }
  });

  // Surface load failures so a blank window isn't a silent mystery.
  window.webContents.on(
    "did-fail-load",
    (_e, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[renderer] did-fail-load: ${errorCode} ${errorDescription} url=${validatedURL}`,
      );
    },
  );
  window.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[renderer] render-process-gone:`, details);
  });

  // Track the latest main window so `getMainWindow()` can hand it back
  // to other main-process modules without an import cycle.
  mainWindowRef = window;
  window.on("closed", () => {
    if (mainWindowRef === window) {
      mainWindowRef = null;
    }
  });

  return window;
}
