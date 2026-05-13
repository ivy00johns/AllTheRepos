/**
 * Central IPC handler registration.
 *
 * Phase 0 wires only the `system` namespace. As later phases add
 * `catalog:*`, `git:*`, `scan:*`, etc., import their `register*Handlers`
 * function here and call it from {@link registerIpcHandlers}.
 *
 * Keep this file the single source of truth for "which namespaces are
 * live" — handlers should not self-register at module-import time.
 */

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
}
