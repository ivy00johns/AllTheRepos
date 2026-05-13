/**
 * Electron main-process entry point.
 *
 * Phase 1 responsibilities (extends Phase 0):
 *   1. Acquire the single-instance lock.
 *   2. On `app.whenReady`:
 *      a. Run the legacy-data migration (one-time copy from
 *         `~/.alltherepos/` into `app.getPath('userData')/`).
 *      b. Run Drizzle migrations to bring `alltherepos.db` up to date.
 *      c. Boot the scanner service (resume an unfinished job in future
 *         phases — Phase 1: no-op).
 *      d. Install the strict CSP, register every IPC handler, subscribe
 *         to scan-progress events, and create the main window.
 *   3. Honor macOS-specific lifecycle (`activate` recreates the window;
 *      we only quit on `window-all-closed` outside darwin).
 *
 * The scan-progress subscription lives here (not in the scan handler
 * module) because the broadcaster is naturally main-entry: it fans the
 * event out to every `BrowserWindow.getAllWindows()`.
 */

import { app, BrowserWindow } from "electron";

import type { ScanEvent } from "@shared/types";
import { IPC } from "@shared/ipc";

import { runMigrations } from "./db/migrate";
import { migrateFromLegacy } from "./db/migration";
import { registerIpcHandlers } from "./ipc/register";
import { installContentSecurityPolicy } from "./security/csp";
import { scanService } from "./services/scan";
import { createMainWindow } from "./window/main-window";

// Module-scoped reference prevents the BrowserWindow from being GC'd.
let mainWindow: BrowserWindow | null = null;

/**
 * Fan a ScanEvent out to every active BrowserWindow. Defined at module
 * scope so the subscription registered in `app.whenReady()` can refer
 * to it.
 *
 * Defensive: skips destroyed windows; tolerates calls when zero windows
 * are open (renderer mid-recreation, scan finishing during teardown).
 */
function broadcastScanEvent(event: ScanEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IPC.SCAN.ON_PROGRESS, event);
  }
}

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

  app.whenReady().then(async () => {
    // 1. Migrate legacy `~/.alltherepos/` data into `userData/` (idempotent,
    //    gated by the MIGRATED sentinel file — see contracts/data-layer.v1.md).
    migrateFromLegacy(app.getPath("userData"));

    // 2. Bring the SQLite schema up to date BEFORE any service touches it.
    //    `runMigrations()` is synchronous — it triggers the lazy `getDb()`
    //    initializer which runs Drizzle migrations + FTS setup + seed.
    runMigrations();

    // 3. Scanner boot — Phase 1 is a no-op; later phases may resume a
    //    half-finished job here.
    await scanService.boot();

    // 4. CSP — must be in place before any document load.
    installContentSecurityPolicy();

    // 5. IPC handlers — must exist before the renderer can call them.
    registerIpcHandlers();

    // 6. Subscribe to the scanner's progress events and fan them out to
    //    every renderer window via `webContents.send`. This is the canonical
    //    app-lifetime subscription — `src/main/ipc/scan.ts` does NOT install
    //    its own listener, so events fire exactly once per scan tick.
    scanService.events.on("progress", broadcastScanEvent);

    // 7. Window last.
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
