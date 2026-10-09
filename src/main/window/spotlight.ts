/**
 * Spotlight window — frameless, vibrancy-backed, hotkey-summoned launcher.
 *
 * Modeled on Raycast / macOS Spotlight: a small, centered, always-on-top
 * BrowserWindow that the user toggles with a global accelerator. Reuses
 * the main renderer bundle with a `#window=spotlight` hash so the React
 * tree can switch into "spotlight" mode without a second Vite entry.
 *
 * Security defaults mirror `main-window.ts` (NEW-PLAN.md §3.4):
 *   - contextIsolation: true
 *   - nodeIntegration: false
 *   - sandbox: true
 *   - webSecurity: true
 *   - preload: out/preload/index.cjs
 *
 * Visual defaults (NEW-PLAN.md §5.8, §6):
 *   - frame: false, transparent: true
 *   - vibrancy: 'sidebar' on darwin (no-op elsewhere)
 *   - alwaysOnTop: true, skipTaskbar: true
 *
 * Behavior:
 *   - Lazy creation: first `show()` instantiates the window.
 *   - `blur` → hide (so user can dismiss by clicking away or pressing Esc
 *     once the renderer blurs the window).
 *   - On macOS, on blur also returns focus to the previously active app
 *     via `Menu.sendActionToFirstResponder('hide:')`.
 */

import { BrowserWindow, Menu, screen, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isUrlAllowed } from "../security/allowlist";
import { rendererAdditionalArguments } from "../build-info";

const SPOTLIGHT_WIDTH = 720;
const SPOTLIGHT_HEIGHT = 440;
const SPOTLIGHT_HASH = "window=spotlight";

let win: BrowserWindow | null = null;

function buildRendererUrl(): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (typeof devUrl === "string" && devUrl.length > 0) {
    // Dev: electron-vite serves index.html for all routes, so a hash on
    // the dev URL is just a fragment the SPA reads via location.hash.
    return `${devUrl}/#${SPOTLIGHT_HASH}`;
  }
  // Prod: convert the bundled index.html path to a file:// URL so we can
  // safely append the hash fragment. `loadFile` doesn't expose fragments.
  const indexPath = join(__dirname, "../renderer/index.html");
  return `${pathToFileURL(indexPath).toString()}#${SPOTLIGHT_HASH}`;
}

function positionOnActiveDisplay(window: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const targetX = Math.round(x + (width - SPOTLIGHT_WIDTH) / 2);
  // ~25% from the top of the work area — Raycast-style above center.
  const targetY = Math.round(y + height * 0.25);
  window.setPosition(targetX, targetY, false);
}

function create(): BrowserWindow {
  const isMac = process.platform === "darwin";

  const window = new BrowserWindow({
    width: SPOTLIGHT_WIDTH,
    height: SPOTLIGHT_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    vibrancy: isMac ? "sidebar" : undefined,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
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

  // Hide instead of close so subsequent toggles are instant.
  window.on("close", (event) => {
    if (!window.isDestroyed()) {
      event.preventDefault();
      window.hide();
    }
  });

  // Dismiss on focus loss — the only way to "Esc out" without bespoke IPC.
  window.on("blur", () => {
    if (window.isDestroyed()) return;
    window.hide();
    if (isMac) {
      try {
        // Return focus to whatever the user was in before summoning us.
        Menu.sendActionToFirstResponder("hide:");
      } catch {
        // sendActionToFirstResponder can throw if no responder exists;
        // we don't care — the hide above is what matters.
      }
    }
  });

  // Defense in depth: window.open() must not crack the renderer open.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isUrlAllowed(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Block any in-renderer navigation away from our origin.
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
        `[spotlight] did-fail-load: ${errorCode} ${errorDescription} url=${validatedURL}`,
      );
    },
  );
  window.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[spotlight] render-process-gone:`, details);
  });

  void window.loadURL(buildRendererUrl());

  return window;
}

function show(): void {
  if (!win || win.isDestroyed()) {
    win = create();
  }
  positionOnActiveDisplay(win);
  win.show();
  win.focus();
}

function hide(): void {
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.hide();
  }
}

function toggle(): void {
  if (win && !win.isDestroyed() && win.isVisible()) {
    hide();
  } else {
    show();
  }
}

function isVisible(): boolean {
  return Boolean(win && !win.isDestroyed() && win.isVisible());
}

export const spotlightWindow = {
  toggle,
  show,
  hide,
  isVisible,
};
