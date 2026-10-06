/**
 * Central IPC handler registration.
 *
 * Phase 0 wired `system:*` only. Phase 1 adds the catalog / scan / git /
 * settings / groups namespaces. Phase 2 adds `app:*` (dock badge,
 * native notifications, spotlight orchestration, action registry).
 * Phase 3a adds `process:*` (lsof-based listening-port detection +
 * per-repo binding + graceful kill) and `launcher:*` (open in editor /
 * terminal / Finder / remote / copy path).
 * Phase 3b adds `claude:*` (read-only Claude Code state — projects,
 * sessions, skills, agents, MCP servers, rolled-up token usage).
 * Each domain module owns its own `register*Handlers()` function; this
 * module is just the orchestrator.
 *
 * Keep this file the single source of truth for "which namespaces are
 * live" — handlers should not self-register at module-import time.
 */

import { registerAppHandlers } from "./app";
import { registerCatalogHandlers } from "./catalog";
import { registerClaudeHandlers } from "./claude";
import { registerGitHandlers } from "./git";
import { registerGroupsHandlers } from "./groups";
import { registerLauncherHandlers } from "./launcher";
import { registerProcessHandlers } from "./process";
import { registerScanHandlers } from "./scan";
import { registerSettingsHandlers } from "./settings";
import { registerSystemHandlers } from "./system";
import { registerTaskHandlers } from "./tasks";
import { registerUpdateHandlers } from "./update";
import { registerGraphHandlers } from "./graph";

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
  registerAppHandlers();
  registerProcessHandlers();
  registerTaskHandlers();
  registerUpdateHandlers();
  registerGraphHandlers();
  registerLauncherHandlers();
  registerClaudeHandlers();
}
