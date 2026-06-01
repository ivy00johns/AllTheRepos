/**
 * IPC handlers — `system:*` namespace.
 *
 * Phase 0 contains a single handler: `system:ping`. Its sole purpose is
 * to validate that the contextBridge + Zod-schema pattern works end to
 * end before any feature work begins (NEW-PLAN.md §9, Phase 0).
 *
 * Hard rules (per §3.4):
 *   - Every handler `.parse()`s its input.
 *   - Every handler asserts the request came from our renderer frame.
 */

import { ipcMain } from "electron";

import { IPC } from "@shared/ipc";
import { PingInputSchema, PingResponseSchema } from "@shared/schemas";
import type { PingResponse } from "@shared/types";

// Frame-origin enforcement lives in the single source of truth `_frame.ts`
// (ATR-014). Re-exported here so the historical `system.ts > assertRendererFrame`
// symbol keeps resolving for any caller, while the policy is defined once.
import { assertRendererFrame } from "./_frame";

export { assertRendererFrame };

/**
 * Pure handler body for `system:ping`. Lives outside `ipcMain.handle` so QE
 * can exercise it in isolation without an Electron runtime (NEW-PLAN.md §3.3).
 *
 * Intentionally Electron-agnostic: frame-origin enforcement happens in the
 * `ipcMain.handle` wrapper below, NOT here — testing the frame check belongs
 * in a separate, IPC-layer test.
 */
export async function handlePing(raw: unknown): Promise<PingResponse> {
  // Phase 0 input is optional; Zod parses `undefined` as the empty default.
  PingInputSchema.optional().parse(raw);

  const response: PingResponse = {
    ok: true,
    pong: "pong",
    mainProcessPid: process.pid,
    receivedAt: new Date().toISOString(),
  };

  // Defensive: parse output too so contract drift is caught in dev.
  PingResponseSchema.parse(response);
  return response;
}

/**
 * Register every `system:*` handler. Idempotent because we `removeHandler`
 * first; this lets hot-reload during `electron-vite dev` swap handlers
 * cleanly on main-process restart.
 */
export function registerSystemHandlers(): void {
  ipcMain.removeHandler(IPC.SYSTEM.PING);
  ipcMain.handle(IPC.SYSTEM.PING, async (event, raw): Promise<PingResponse> => {
    assertRendererFrame(event);
    return handlePing(raw);
  });
}
