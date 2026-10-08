/**
 * Tray popover window — a small frameless BrowserWindow anchored to the
 * menu-bar tray icon. Re-uses the main renderer bundle with the hash
 * `#window=tray-popover` so the React tree can switch into popover mode
 * without a second Vite entry.
 *
 * Security defaults mirror `main-window.ts` (NEW-PLAN.md §3.4):
 *   - contextIsolation: true
 *   - nodeIntegration: false
 *   - sandbox: true
 *   - webSecurity: true
 *   - preload: out/preload/index.cjs
 *
 * Visual defaults (NEW-PLAN.md §5.8):
 *   - frame: false, transparent: true
 *   - vibrancy: 'sidebar' on darwin (no-op elsewhere)
 *   - alwaysOnTop: true, skipTaskbar: true
 *
 * Anchoring: `showAt(trayBounds)` positions the popover horizontally
 * centered under the tray icon (or above, on Windows where the tray is
 * at the bottom). The caller (`backend-system`) sources the bounds from
 * its Tray instance.
 */

import { BrowserWindow, screen, shell } from "electron";
import type { Rectangle } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isUrlAllowed } from "../security/allowlist";
import { rendererAdditionalArguments } from "../build-info";

const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 420;
const POPOVER_GAP = 6; // px between the tray icon and the popover edge
const POPOVER_HASH = "window=tray-popover";

let win: BrowserWindow | null = null;

function buildRendererUrl(): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (typeof devUrl === "string" && devUrl.length > 0) {
    return `${devUrl}/#${POPOVER_HASH}`;
  }
  const indexPath = join(__dirname, "../renderer/index.html");
  return `${pathToFileURL(indexPath).toString()}#${POPOVER_HASH}`;
}

function positionNearTray(window: BrowserWindow, trayBounds: Rectangle): void {
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x + Math.floor(trayBounds.width / 2),
    y: trayBounds.y + Math.floor(trayBounds.height / 2),
  });
  const work = display.workArea;

  // Center the popover horizontally on the tray icon.
  let targetX = Math.round(
    trayBounds.x + trayBounds.width / 2 - POPOVER_WIDTH / 2,
  );
  // Clamp to the work area horizontally so it never spills off-screen.
  const maxX = work.x + work.width - POPOVER_WIDTH;
  if (targetX < work.x) targetX = work.x;
  if (targetX > maxX) targetX = maxX;

  // On macOS the menu bar sits at the top, so we drop below the tray.
  // On Windows/Linux the tray is typically at the bottom of the work
  // area; pop up above the tray icon instead.
  const isTrayAtTop = trayBounds.y <= work.y + 32;
  const targetY = isTrayAtTop
    ? trayBounds.y + trayBounds.height + POPOVER_GAP
    : trayBounds.y - POPOVER_HEIGHT - POPOVER_GAP;

  window.setPosition(targetX, Math.round(targetY), false);
}

function create(): BrowserWindow {
  const isMac = process.platform === "darwin";

  const window = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    vibrancy: isMac ? "sidebar" : undefined,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Same build fact as the main window, so no window has to guess. See
      // `@shared/build-info`.
      additionalArguments: rendererAdditionalArguments(),
      preload: join(__dirname, "../preload/index.cjs"),
    },
  });

  // Hide instead of close so the popover stays warm for re-summoning.
  window.on("close", (event) => {
    if (!window.isDestroyed()) {
      event.preventDefault();
      window.hide();
    }
  });

  // Click-away dismissal.
  window.on("blur", () => {
    if (!window.isDestroyed() && window.isVisible()) {
      window.hide();
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isUrlAllowed(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

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

  window.webContents.on(
    "did-fail-load",
    (_e, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[tray-popover] did-fail-load: ${errorCode} ${errorDescription} url=${validatedURL}`,
      );
    },
  );
  window.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[tray-popover] render-process-gone:`, details);
  });

  void window.loadURL(buildRendererUrl());

  return window;
}

function showAt(trayBounds: Rectangle): void {
  if (!win || win.isDestroyed()) {
    win = create();
  }
  positionNearTray(win, trayBounds);
  win.show();
  win.focus();
}

function hide(): void {
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.hide();
  }
}

function isVisible(): boolean {
  return Boolean(win && !win.isDestroyed() && win.isVisible());
}

export const trayPopover = {
  showAt,
  hide,
  isVisible,
};
