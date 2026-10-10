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
 *      f. Subscribe to every service's events (fan-out to renderers, the
 *         dock badge, the native "Scan complete" notification).
 *      g. Register every IPC handler.
 *      h. Create the main window — **before** the services boot (ATR-055).
 *      i. Create the tray (lazy — depends on main window existing).
 *      j. Register the global Cmd+Shift+Space hotkey.
 *      k. Boot the process, launcher and Claude services behind the window;
 *         every handler that needs one of them awaits that service's
 *         `boot()`, which hands back the promise started here.
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
import { repoWatchService } from "./services/watch";
import { taskService } from "./services/tasks";
import { updaterService } from "./services/updater";
import { scanService } from "./services/scan";
import {
  registerGlobalHotkeys,
  unregisterGlobalHotkeys,
} from "./system/hotkey";
import { setDockBadge } from "./system/dock-badge";
import { notifyScanComplete } from "./system/notification";
import { registerProtocolHandler } from "./system/protocol";
import { createTray } from "./system/tray";
import { createMainWindow } from "./window/main-window";

/**
 * Pin the application name BEFORE anything reads `app.getPath('userData')`.
 *
 * Electron derives the user-data directory from `app.getName()`, which for
 * an unpackaged app is whatever it can infer from the launch context. That
 * inference is not stable: `pnpm electron:dev` resolved to "alltherepos"
 * while launching the built entry directly resolved to "Electron" — two
 * different directories, so the app silently kept TWO separate catalogs
 * with different scan roots, and work done in one was invisible in the
 * other. Worse, "Electron" is the default for every unpackaged Electron
 * app on the machine, so that directory is shared with unrelated tools.
 *
 * Setting the name explicitly makes every launch path — dev, built entry,
 * packaged bundle — agree on exactly one location.
 */
app.setName("alltherepos");

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

/** Fan update status out to every active BrowserWindow. */
function broadcastUpdateStatus(
  payload: import("@shared/types").UpdateStatus,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IPC.UPDATE.ON_STATUS, payload);
  }
}

/**
 * Fan a task's stdout/stderr out to every active BrowserWindow.
 *
 * Broadcast rather than targeted: a task started in one window should be
 * visible in any other, and there is normally exactly one window.
 */
function broadcastTaskOutput(
  payload: import("@shared/types").TaskOutputEvent,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IPC.TASKS.ON_OUTPUT, payload);
  }
}

/**
 * Fan a live catalog change out to every active BrowserWindow. Same
 * defensive shape as `broadcastScanEvent`.
 */
function broadcastCatalogChange(
  payload: import("@shared/types").CatalogChangeEvent,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IPC.CATALOG.ON_CHANGED, payload);
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
 * ATR-010 — derive the dock-badge count from a ProcessService snapshot
 * and drive the macOS dock badge. "Running dev servers" is the count of
 * listening processes bound to a known repo (`repoSlug != null`) — the
 * unbound listeners (system daemons, unrelated tools) aren't the user's
 * dev servers, so they don't earn a badge.
 *
 * `setDockBadge` clears the badge on `0` and is a no-op off darwin, so
 * this is safe to call on every update. Returns the running count for
 * the caller's convenience / testability.
 */
function driveDockBadge(
  payload: import("@shared/types").ProcessUpdateEvent,
): number {
  const runningCount = payload.processes.filter(
    (p) => p.repoSlug != null,
  ).length;
  setDockBadge(runningCount);
  return runningCount;
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

/**
 * Boot the services the window no longer waits for (ATR-055).
 *
 * These three used to be awaited before `createMainWindow()`, which put the
 * scanning of every configured root, the detection of every editor on the
 * machine and the indexing of every Claude session between a launch and its
 * first paint. None of it is needed to draw the window: the renderer paints
 * the shell and the catalog from SQLite (migrated before the window), and each
 * panel that needs a service awaits that service's `boot()`, which hands back
 * the promise started here rather than starting a second one.
 *
 * A failure is logged rather than fatal. It used to abort the whole boot with
 * `app.exit(1)`, which meant a broken Claude index could keep the catalog from
 * opening; now the panel whose service failed reports it, and offers a retry.
 */
function bootServicesBehindTheWindow(): void {
  void (async () => {
    try {
      // ProcessService builds its catalog cwd→repo trie from the repos table
      // (so `runMigrations` + the catalog must already be online) and starts
      // paused — `start()` triggers on the first subscriber. LauncherService
      // runs editor/terminal detection on /Applications + a PATH probe and
      // caches the result for the app lifetime.
      await processService.boot();

      // Live filesystem watching. Started AFTER the catalog is open because
      // the watcher prunes known repo subtrees, and it can only know them by
      // reading the DB.
      repoWatchService.onChange(broadcastCatalogChange);
      repoWatchService.start();

      await launcherService.boot();

      // Reads `~/.claude.json`, walks `~/.claude/projects/<hash>/` to index
      // sessions, and starts a chokidar watcher that emits `claude:on:update`
      // when any project's session file changes.
      await claudeService.boot();
    } catch (err) {
      console.error(
        "[main] a service failed to boot behind the window — the panel that needs it will report it",
        err,
      );
    }
  })();
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
      // 0. E2E only — run as a macOS accessory app so the suite never steals
      //    focus. Launching a normal app ACTIVATES it, which interrupts
      //    whatever the developer is typing; the suite launches one app per
      //    spec, so that adds up fast. Hiding the dock icon (LSUIElement
      //    behaviour) keeps the app out of the activation path entirely.
      //    Playwright drives the window over the debugger protocol and never
      //    needs it focused. No E2E spec asserts on dock or activation state.
      if (process.env.ATR_E2E === "1") {
        app.dock?.hide();
      }

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
      //    half-finished job here. The only service boot that stays in front of
      //    the window: no handler awaits it, so there is nothing that could
      //    have waited for it afterwards.
      await scanService.boot();

      // 6. Subscriptions. Pure wiring — attaching a listener needs no service
      //    to have booted, so this happens before the window rather than after.
      //
      //    Scanner progress has two consumers:
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

      //    Phase 3a — fan ProcessService snapshot updates to every renderer.
      //    `update` events fire only when the (pid, port, repoSlug) triple
      //    set changes, so wire cost is minimal.
      processService.events.on("update", broadcastProcessUpdate);

      //    ATR-010 — auto-drive the macOS dock badge from the same
      //    ProcessService snapshot. Separate listener (not folded into the
      //    broadcast) so the badge logic is independently testable and one
      //    consumer failing can't starve the other.
      processService.events.on("update", driveDockBadge);

      //    Phase 3b — fan ClaudeService chokidar updates to every renderer.
      //    Renderer invalidates the matching `claude:projects` /
      //    `claude:repoState` / `claude:globalUsage` queries.
      claudeService.events.on("update", broadcastClaudeUpdate);

      //    Task output stream.
      taskService.onOutput(broadcastTaskOutput);

      //    Update checking. Checks once shortly after launch and stays
      //    quiet otherwise; a packaged build only.
      updaterService.onStatus(broadcastUpdateStatus);
      updaterService.scheduleStartupCheck();

      // 7. IPC handlers — before the window, because the renderer's first call
      //    has to find a handler to reach. A handler that needs a service
      //    awaits that service's `boot()`, so nothing here depends on the boots
      //    below having finished; see `bootServicesBehindTheWindow`.
      registerIpcHandlers();

      // 8. Main window — created BEFORE the services boot (ATR-055). It used to
      //    be the last thing in this sequence, behind the process scan, editor
      //    detection and the whole Claude index, none of which the first paint
      //    needs: the renderer draws the shell and the catalog from SQLite
      //    (migrated in step 4) and awaits a service only inside the panel that
      //    shows that service's data.
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

      // 11. The services, behind the window they no longer hold up.
      bootServicesBehindTheWindow();
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
    // Close the filesystem watchers so the process can actually exit —
    // an open FSEvents stream keeps the event loop alive.
    void repoWatchService.stop();
    // Never orphan a dev server the user started from inside the app.
    taskService.stopAll();
  });
}
