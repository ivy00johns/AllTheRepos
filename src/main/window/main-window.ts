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

import { BrowserWindow, shell } from "electron";
import { join } from "node:path";

import { isUrlAllowed } from "../security/allowlist";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

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
      // electron-vite outputs preload as CommonJS; main bundle sits at
      // `out/main/index.js`, so the preload is one level up + over.
      preload: join(__dirname, "../preload/index.cjs"),
    },
  });

  window.once("ready-to-show", () => {
    window.show();
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

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl && rendererUrl.length > 0) {
    void window.loadURL(rendererUrl);
    // Dev: open DevTools so renderer errors are visible immediately.
    window.webContents.openDevTools({ mode: "right" });
  } else {
    // Production: load the bundled HTML. Path is relative to out/main/index.js.
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

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

  return window;
}
