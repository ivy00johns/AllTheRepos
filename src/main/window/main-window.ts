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

import { app, BrowserWindow, screen, shell } from "electron";
import { join } from "node:path";

import { isUrlAllowed } from "../security/allowlist";
import { rendererAdditionalArguments } from "../build-info";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  readWindowMemory,
  rememberBounds,
  rememberRoute,
  rendererTarget,
  restorableRoute,
} from "./window-memory";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

/**
 * How long the window has to hold still before its shape is written down.
 *
 * `resize` and `move` fire on every frame of a drag, and a file write per frame
 * is a file write per frame; half a second is longer than the gap between two
 * mouse events and shorter than the time it takes to let go of the window and
 * quit. The write on `close` is the one that matters — this only means a crash
 * loses less.
 */
const SHAPE_SETTLE_MS = 500;

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

  // Read once, use for both halves: the shape the window opens at and the route
  // it loads. The profile directory is passed in rather than reached for inside
  // `window-memory`, so what it decides is testable without Electron.
  const profileDir = app.getPath("userData");
  const memory = readWindowMemory(profileDir, {
    // `screen` is only available after `ready`, and this is called after it.
    displays: screen.getAllDisplays().map((display) => display.workArea),
  });

  const window = new BrowserWindow({
    width: memory.bounds?.width ?? DEFAULT_WIDTH,
    height: memory.bounds?.height ?? DEFAULT_HEIGHT,
    // Only when there is a position worth restoring: a remembered size with no
    // position, or a position on a display that has been unplugged, is left to
    // the window manager to place — centred on the display you are looking at
    // rather than off the edge of one that is not there.
    ...(memory.bounds?.x !== undefined && memory.bounds?.y !== undefined
      ? { x: memory.bounds.x, y: memory.bounds.y }
      : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
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
   * Open where the window was left rather than on the catalog every time, at
   * the shape it was left in rather than at 1280×800.
   *
   * The renderer's route lives in the address, and main is the only thing that
   * knows it at launch — so the fragment is read back at the top of this
   * function and appended to the load URL, and the size and position are read
   * from the same file for the `BrowserWindow` above. `window-memory` takes the
   * profile directory rather than reaching for `app` itself, so the decision is
   * testable without Electron. A first launch, or a memory that no longer
   * names a route or a sane shape, gives `null` and this is exactly the window
   * it always was.
   */
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const isDev = typeof rendererUrl === "string" && rendererUrl.length > 0;
  void window.loadURL(
    rendererTarget({
      rendererUrl: isDev ? rendererUrl : undefined,
      indexPath: join(__dirname, "../renderer/index.html"),
      route: memory.route,
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
    if (route !== null) rememberRoute(profileDir, route);
  };
  window.webContents.on("did-navigate", (_event, url) => {
    rememberFragment(url);
  });
  window.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    // The renderer's route changes in the top frame; anything below it is a
    // frame's business, not the window's.
    if (isMainFrame) rememberFragment(url);
  });
  /*
   * The window's shape, remembered the same way its place is.
   *
   * Main is the only thing that knows the size: the renderer's viewport is a
   * consequence of it. A window sized for two panes, or stretched across a
   * second monitor, is a decision that took a drag to make and is not worth
   * making twice — and the default is 1280×800, which is a shape somebody chose
   * for a first launch rather than the one most days happen in.
   */
  const rememberShape = (): void => {
    if (window.isDestroyed()) return;
    rememberBounds(profileDir, window.getBounds());
  };
  let settle: NodeJS.Timeout | null = null;
  const shapeSettled = (): void => {
    if (settle !== null) clearTimeout(settle);
    settle = setTimeout(() => {
      settle = null;
      rememberShape();
    }, SHAPE_SETTLE_MS);
    // A pending timer must not hold the process open: `unref` keeps a settled
    // window from being a reason for the app to stay alive a moment longer.
    settle.unref?.();
  };
  window.on("resize", shapeSettled);
  window.on("move", shapeSettled);

  // And once as the window closes. The two events above are the browser's to
  // fire and this is the state that actually has to survive, so the last
  // address — and the shape it was at — is read from the window itself rather
  // than assumed to have arrived by event. A belt worth wearing for a feature
  // whose failure is silent, and the shape makes it two belts: a drag that was
  // still settling when the window was closed would otherwise not be written.
  window.on("close", () => {
    if (settle !== null) {
      clearTimeout(settle);
      settle = null;
    }
    rememberShape();
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
