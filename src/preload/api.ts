/**
 * Typed wrapper around `ipcRenderer.invoke` exposed via contextBridge.
 *
 * This is the renderer-facing API surface; the preload is the ONLY place
 * that has access to `ipcRenderer`. Every method here MUST:
 *   - reference a channel name from `@shared/ipc`'s `IPC` registry
 *     (no inline string literals), and
 *   - return a Promise typed against the shared `@shared/types` shape.
 *
 * Phase 0 only exposes `system.ping`. Add namespaces here as later
 * phases unlock them.
 */

import { ipcRenderer } from "electron";

import { IPC } from "@shared/ipc";
import type { PingInput, PingResponse } from "@shared/types";

export const api = {
  system: {
    /**
     * Round-trip smoke test. Returns the main-process PID and a
     * server-side ISO timestamp, useful for verifying the bridge works
     * after install / hot-reload.
     */
    ping: (input?: PingInput): Promise<PingResponse> =>
      ipcRenderer.invoke(IPC.SYSTEM.PING, input) as Promise<PingResponse>,
  },
} as const;

export type AtrApi = typeof api;
