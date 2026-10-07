/**
 * Preload entry — runs in an isolated, sandboxed context with limited
 * Node access. Its sole job is to expose the typed `api` object on
 * `window[PRELOAD_BRIDGE_KEY]` via `contextBridge.exposeInMainWorld`.
 *
 * IMPORTANT: electron-vite emits this file as CommonJS (`.cjs`) — see
 * `electron.vite.config.ts`. Keep ESM-only syntax out of code paths
 * that aren't transpiled (top-level `await`, dynamic imports of ESM
 * deps, etc.). Plain imports are fine; Vite handles them.
 */

import { contextBridge } from "electron";

import { PRELOAD_BRIDGE_KEY } from "@shared/ipc";

import { api } from "./api";

// Sandbox is enabled, contextIsolation is enabled — `process` and `require`
// are NOT exposed to the renderer. The bridge is our only surface.
try {
  contextBridge.exposeInMainWorld(PRELOAD_BRIDGE_KEY, api);
} catch (err) {
  // If contextIsolation is somehow off (a regression bug elsewhere),
  // we still want to fail loudly rather than silently leaking globals.
  console.error("[preload] contextBridge.exposeInMainWorld failed", err);
}
