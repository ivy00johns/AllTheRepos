/**
 * Electron main-process entry point.
 *
 * Phase 0 responsibilities:
 *   1. Acquire the single-instance lock (per NEW-PLAN.md §3.1, the
 *      desktop app should never run twice simultaneously).
 *   2. On `app.whenReady`, install the strict CSP, register every IPC
 *      handler, and create the main window.
 *   3. Honor macOS-specific lifecycle (`activate` recreates the window;
 *      we only quit on `window-all-closed` outside darwin).
 *
 * No feature services are wired in Phase 0 — only the ping IPC.
 */

import { app, BrowserWindow } from "electron";

import { registerIpcHandlers } from "./ipc/register";
import { installContentSecurityPolicy } from "./security/csp";
import { createMainWindow } from "./window/main-window";

// Module-scoped reference prevents the BrowserWindow from being GC'd.
let mainWindow: BrowserWindow | null = null;

/** Acquire the single-instance lock before doing anything else. */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // Bring the existing window forward when a second instance launches.
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // 1. CSP first — it must be in place before any document load.
    installContentSecurityPolicy();

    // 2. IPC handlers second — must exist before the renderer can call them.
    registerIpcHandlers();

    // 3. Window last.
    mainWindow = createMainWindow();
    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    // macOS: recreate the window when the dock icon is clicked and there
    // are no other windows open.
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        mainWindow.on("closed", () => {
          mainWindow = null;
        });
      }
    });
  });

  // Quit on non-darwin platforms when the last window closes; on macOS
  // the app convention is to stay alive in the menu bar.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
