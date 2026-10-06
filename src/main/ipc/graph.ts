/**
 * IPC handlers — `graph:*` namespace.
 *
 * One channel. Building the graph reads every repo's `package.json` and
 * `.gitmodules`, so it's an explicit request rather than something the
 * catalog does on every render.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import { GraphBuildInputSchema, GraphResultSchema } from "@shared/schemas";
import type { GraphResult } from "@shared/types";

import { graphService } from "@main/services/graph";

import { assertRendererFrame } from "./_frame";

export async function handleGraphBuild(raw: unknown): Promise<GraphResult> {
  GraphBuildInputSchema.parse(raw);
  return GraphResultSchema.parse(graphService.build());
}

/** Register every `graph:*` handler. Idempotent. */
export function registerGraphHandlers(): void {
  ipcMain.removeHandler(IPC.GRAPH.BUILD);
  ipcMain.handle(
    IPC.GRAPH.BUILD,
    async (event: IpcMainInvokeEvent, raw): Promise<GraphResult> => {
      assertRendererFrame(event);
      return handleGraphBuild(raw);
    },
  );
}
