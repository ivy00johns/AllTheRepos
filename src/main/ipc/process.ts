/**
 * IPC handlers — `process:*` namespace (Phase 3a).
 *
 * Four handlers: `process:list`, `process:listForRepo`, `process:refresh`,
 * `process:kill`. Each one runs `assertRendererFrame(event)` before touching
 * the service and `.parse()`s its raw input through the Zod schema. The
 * `process:on:update` event stream is fanned out from `src/main/index.ts`
 * (the canonical app-lifetime subscription).
 *
 * The handlers never call `lsof` / `ps` themselves — `ProcessService` is
 * the only owner of subprocess invocations.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  KillProcessInputSchema,
  KillProcessResultSchema,
  ListProcessesForRepoInputSchema,
  ListProcessesInputSchema,
  ListProcessesResultSchema,
} from "@shared/schemas";
import type { KillProcessResult, ListProcessesResult } from "@shared/types";

import { processService } from "@main/services/process";

import { assertRendererFrame } from "./_frame";

export async function handleProcessList(
  raw: unknown,
): Promise<ListProcessesResult> {
  ListProcessesInputSchema.parse(raw ?? {});
  const result = await processService.list();
  return ListProcessesResultSchema.parse(result);
}

export async function handleProcessListForRepo(
  raw: unknown,
): Promise<ListProcessesResult> {
  const input = ListProcessesForRepoInputSchema.parse(raw);
  const result = await processService.listForRepo(input.slug);
  return ListProcessesResultSchema.parse(result);
}

export async function handleProcessRefresh(
  raw: unknown,
): Promise<ListProcessesResult> {
  ListProcessesInputSchema.parse(raw ?? {});
  const result = await processService.refresh();
  return ListProcessesResultSchema.parse(result);
}

export async function handleProcessKill(
  raw: unknown,
): Promise<KillProcessResult> {
  const input = KillProcessInputSchema.parse(raw);
  const result = await processService.kill(input);
  return KillProcessResultSchema.parse(result);
}

/**
 * Register every `process:*` handler. Idempotent — removes any prior
 * handler before re-installing so hot-reload doesn't double-register.
 *
 * Registration order matches the channel order in `IPC.PROCESS`:
 * LIST, LIST_FOR_REPO, REFRESH, KILL. (ON_UPDATE is push-only.)
 */
export function registerProcessHandlers(): void {
  const channels = [
    IPC.PROCESS.LIST,
    IPC.PROCESS.LIST_FOR_REPO,
    IPC.PROCESS.REFRESH,
    IPC.PROCESS.KILL,
  ] as const;
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    IPC.PROCESS.LIST,
    async (event: IpcMainInvokeEvent, raw): Promise<ListProcessesResult> => {
      assertRendererFrame(event);
      return handleProcessList(raw);
    },
  );

  ipcMain.handle(
    IPC.PROCESS.LIST_FOR_REPO,
    async (event: IpcMainInvokeEvent, raw): Promise<ListProcessesResult> => {
      assertRendererFrame(event);
      return handleProcessListForRepo(raw);
    },
  );

  ipcMain.handle(
    IPC.PROCESS.REFRESH,
    async (event: IpcMainInvokeEvent, raw): Promise<ListProcessesResult> => {
      assertRendererFrame(event);
      return handleProcessRefresh(raw);
    },
  );

  ipcMain.handle(
    IPC.PROCESS.KILL,
    async (event: IpcMainInvokeEvent, raw): Promise<KillProcessResult> => {
      assertRendererFrame(event);
      return handleProcessKill(raw);
    },
  );
}
