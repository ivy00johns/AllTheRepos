/**
 * Electron main-process entry point.
 *
 * Phase 2 responsibilities (extends Phase 0 + 1):
 *   1. Acquire the single-instance lock.
 *   2. On `app.whenReady`, in order:
 *      a. Install the strict CSP (must precede any document load).
 *      b. Register the `alltherepos://` protocol scheme and its
 *         `open-url` / `second-instance` handlers.
 *      c. Run the legacy-data migration (one-time copy from
 *         `~/.alltherepos/` into `app.getPath('userData')/`).
 *      d. Run Drizzle migrations to bring `alltherepos.db` up to date.
 *      e. Boot the scanner service (resume an unfinished job in future
 *         phases — Phase 1: no-op).
 *      f. Register every IPC handler.
 *      g. Subscribe to scan-progress events (fan-out to renderers +
 *         fire the native "Scan complete" notification on `done`).
 *      h. Create the main window.
 *      i. Create the tray (lazy — depends on main window existing).
 *      j. Register the global Cmd+Shift+Space hotkey.
 *   3. On `before-quit`: unregister every global shortcut.
 *   4. Honor macOS-specific lifecycle (`activate` recreates the window;
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
import { claudeService } from "./services/claude";
import { launcherService } from "./services/launcher";
import { processService } from "./services/process";
import { scanService } from "./services/scan";
import {
  registerGlobalHotkeys,
  unregisterGlobalHotkeys,
} from "./system/hotkey";
import { notifyScanComplete } from "./system/notification";
import { registerProtocolHandler } from "./system/protocol";
import { createTray } from "./system/tray";
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

/**
 * Phase 3a — fan a ProcessUpdateEvent (full snapshot) to every active
 * BrowserWindow. Defensive against destroyed windows, same pattern as
 * `broadcastScanEvent`.
 */
function broadcastProcessUpdate(
  payload: import("@shared/types").ProcessUpdateEvent,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IPC.PROCESS.ON_UPDATE, payload);
  }
}

/**
 * Phase 3b — fan a ClaudeUpdateEvent (project-hash + reason) to every
 * active BrowserWindow. Fires when the chokidar watcher detects a
 * session JSONL file added/changed/removed.
 */
function broadcastClaudeUpdate(
  payload: import("@shared/types").ClaudeUpdateEvent,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IPC.CLAUDE.ON_UPDATE, payload);
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

  app
    .whenReady()
    .then(async () => {
      // 1. CSP — must be in place before any document load.
      installContentSecurityPolicy();

      // 2. Register `alltherepos://` protocol. Must precede the window
      //    creation so a cold launch with a deep-link URL has a chance
      //    to dispatch into the renderer when it mounts.
      registerProtocolHandler();

      // 3. Migrate legacy `~/.alltherepos/` data into `userData/` (idempotent,
      //    gated by the MIGRATED sentinel file — see contracts/data-layer.v1.md).
      migrateFromLegacy(app.getPath("userData"));

      // 4. Bring the SQLite schema up to date BEFORE any service touches it.
      //    `runMigrations()` is synchronous — it triggers the lazy `getDb()`
      //    initializer which runs Drizzle migrations + FTS setup + seed.
      runMigrations();

      // 5. Scanner boot — Phase 1 is a no-op; later phases may resume a
      //    half-finished job here.
      await scanService.boot();

      // 5a. Phase 3a — ProcessService + LauncherService boot. ProcessService
      //     builds its catalog cwd→repo trie from the SQLite repos table
      //     (so runMigrations + the catalog must already be online) and
      //     starts paused — `start()` triggers on the first subscriber.
      //     LauncherService runs editor/terminal detection on /Applications
      //     + PATH probe and caches for the app lifetime.
      await processService.boot();
      await launcherService.boot();

      // 5b. Phase 3b — ClaudeService boot. Reads `~/.claude.json`, walks
      //     `~/.claude/projects/<hash>/` to index sessions, and starts a
      //     chokidar watcher that emits `claude:on:update` when any
      //     project's session file changes. Idempotent.
      await claudeService.boot();

      // 6. IPC handlers — must exist before the renderer can call them.
      registerIpcHandlers();

      // 7. Subscribe to the scanner's progress events. Two consumers:
      //    (a) Fan to every renderer window via `webContents.send`.
      //    (b) Fire the "Scan complete" native notification on `done`.
      //    This is the canonical app-lifetime subscription — `src/main/ipc/scan.ts`
      //    does NOT install its own listener, so events fire exactly once per tick.
      scanService.events.on("progress", broadcastScanEvent);
      scanService.events.on("progress", (event: ScanEvent) => {
        if (event.kind === "done") {
          notifyScanComplete(event.totalRepos, event.durationMs);
        }
      });

      // Phase 3a — fan ProcessService snapshot updates to every renderer.
      // `update` events fire only when the (pid, port, repoSlug) triple
      // set changes, so wire cost is minimal.
      processService.events.on("update", broadcastProcessUpdate);

      // Phase 3b — fan ClaudeService chokidar updates to every renderer.
      // Renderer invalidates the matching `claude:projects` /
      // `claude:repoState` / `claude:globalUsage` queries.
      claudeService.events.on("update", broadcastClaudeUpdate);

      // 8. Main window.
      mainWindow = createMainWindow();
      mainWindow.on("closed", () => {
        mainWindow = null;
      });

      // 9. Tray — lazy: only after the main window exists so the popover
      //    bridge has a target to position against.
      createTray();

      // 10. Global hotkey — registered AFTER `app.whenReady()` per the
      //     Electron docs. `before-quit` unregisters.
      registerGlobalHotkeys();

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
    })
    .catch((err) => {
      // Boot errors otherwise vanish into UnhandledPromiseRejectionWarning
      // — surface them loudly and exit so the user sees the failure
      // instead of staring at a hung process with no window.
      console.error("[main] app.whenReady boot failed:", err);
      app.exit(1);
    });

  // Quit on non-darwin platforms when the last window closes; on macOS
  // the app convention is to stay alive in the menu bar.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  // Ensure global accelerators don't outlive the app. `unregisterAll`
  // is idempotent; calling it here is the canonical Electron pattern.
  app.on("before-quit", () => {
    unregisterGlobalHotkeys();
  });
}
