/**
 * Central IPC handler registration.
 *
 * Phase 0 wired `system:*` only. Phase 1 adds the catalog / scan / git /
 * settings / groups namespaces. Each domain module owns its own
 * `register*Handlers()` function; this module is just the orchestrator.
 *
 * Keep this file the single source of truth for "which namespaces are
 * live" — handlers should not self-register at module-import time.
 */

import { registerCatalogHandlers } from "./catalog";
import { registerGitHandlers } from "./git";
import { registerGroupsHandlers } from "./groups";
import { registerScanHandlers } from "./scan";
import { registerSettingsHandlers } from "./settings";
import { registerSystemHandlers } from "./system";

/**
 * Idempotently register every IPC handler the app exposes.
 *
 * Called from `app.whenReady()` exactly once. Safe to call again on
 * hot-reload because each domain module removes its own handlers
 * before re-registering.
 */
export function registerIpcHandlers(): void {
  registerSystemHandlers();
  registerCatalogHandlers();
  registerScanHandlers();
  registerGitHandlers();
  registerSettingsHandlers();
  registerGroupsHandlers();
}
