/**
 * IPC handlers — `claude:*` namespace (Phase 3b).
 *
 * Seven invoke channels: `INDEX`, `PROJECTS`, `REPO_STATE`,
 * `SESSION_TRANSCRIPT`, `GLOBAL_USAGE`, `LAUNCH`, `OPEN_CLAUDE_MD`.
 * The push-style `ON_UPDATE` event is fanned out from
 * `src/main/index.ts` (the canonical app-lifetime subscription).
 *
 * Every handler runs `assertRendererFrame(event)` first and parses
 * its raw input through the matching Zod schema before dispatching
 * to ClaudeService.
 *
 * Each registration also awaits `claudeService.boot()` before dispatching.
 * The walk over every project's session files is the expensive part of a cold
 * start and the window no longer waits for it (ATR-055), so a `claude:*` call
 * on the first paint has to be able to wait for the walk that is already
 * running — the service hands back the same promise, so this joins it rather
 * than starting a second one. The `handle*` functions stay free of that
 * concern, which is why the await lives here: they remain pure dispatch and
 * the unit suite keeps testing them for exactly that.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  ClaudeGlobalUsageInputSchema,
  ClaudeGlobalUsageResultSchema,
  ClaudeIndexInputSchema,
  ClaudeIndexResultSchema,
  ClaudeLaunchInputSchema,
  ClaudeLaunchResultSchema,
  ClaudeOpenClaudeMdInputSchema,
  ClaudeOpenClaudeMdResultSchema,
  ClaudeProjectsInputSchema,
  ClaudeProjectsResultSchema,
  ClaudeRepoStateInputSchema,
  ClaudeRepoStateResultSchema,
  ClaudeSessionTranscriptInputSchema,
  ClaudeSessionTranscriptResultSchema,
} from "@shared/schemas";
import type {
  ClaudeGlobalUsageResult,
  ClaudeIndexResult,
  ClaudeLaunchResult,
  ClaudeOpenClaudeMdResult,
  ClaudeProjectsResult,
  ClaudeRepoState,
  ClaudeSessionTranscriptResult,
} from "@shared/types";

import { claudeService } from "@main/services/claude";

import { assertRendererFrame } from "./_frame";

export async function handleClaudeIndex(
  raw: unknown,
): Promise<ClaudeIndexResult> {
  ClaudeIndexInputSchema.parse(raw ?? {});
  const result = await claudeService.index();
  return ClaudeIndexResultSchema.parse(result);
}

export async function handleClaudeProjects(
  raw: unknown,
): Promise<ClaudeProjectsResult> {
  ClaudeProjectsInputSchema.parse(raw ?? {});
  const result = claudeService.projects();
  return ClaudeProjectsResultSchema.parse(result);
}

export async function handleClaudeRepoState(
  raw: unknown,
): Promise<ClaudeRepoState> {
  const input = ClaudeRepoStateInputSchema.parse(raw);
  const result = await claudeService.repoState(input);
  return ClaudeRepoStateResultSchema.parse(result);
}

export async function handleClaudeSessionTranscript(
  raw: unknown,
): Promise<ClaudeSessionTranscriptResult> {
  const input = ClaudeSessionTranscriptInputSchema.parse(raw);
  const result = await claudeService.sessionTranscript(input);
  return ClaudeSessionTranscriptResultSchema.parse(result);
}

export async function handleClaudeGlobalUsage(
  raw: unknown,
): Promise<ClaudeGlobalUsageResult> {
  const input = ClaudeGlobalUsageInputSchema.parse(raw ?? {});
  const result = claudeService.globalUsage(input);
  return ClaudeGlobalUsageResultSchema.parse(result);
}

export async function handleClaudeLaunch(
  raw: unknown,
): Promise<ClaudeLaunchResult> {
  const input = ClaudeLaunchInputSchema.parse(raw);
  const result = await claudeService.launch(input);
  return ClaudeLaunchResultSchema.parse(result);
}

export async function handleClaudeOpenClaudeMd(
  raw: unknown,
): Promise<ClaudeOpenClaudeMdResult> {
  const input = ClaudeOpenClaudeMdInputSchema.parse(raw);
  const result = await claudeService.openClaudeMd(input);
  return ClaudeOpenClaudeMdResultSchema.parse(result);
}

/**
 * Register every `claude:*` invoke handler. Idempotent — removes any
 * prior handler before re-installing so hot-reload doesn't double
 * register.
 */
export function registerClaudeHandlers(): void {
  const channels = [
    IPC.CLAUDE.INDEX,
    IPC.CLAUDE.PROJECTS,
    IPC.CLAUDE.REPO_STATE,
    IPC.CLAUDE.SESSION_TRANSCRIPT,
    IPC.CLAUDE.GLOBAL_USAGE,
    IPC.CLAUDE.LAUNCH,
    IPC.CLAUDE.OPEN_CLAUDE_MD,
  ] as const;
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    IPC.CLAUDE.INDEX,
    async (event: IpcMainInvokeEvent, raw): Promise<ClaudeIndexResult> => {
      assertRendererFrame(event);
      await claudeService.boot();
      return handleClaudeIndex(raw);
    },
  );

  ipcMain.handle(
    IPC.CLAUDE.PROJECTS,
    async (event: IpcMainInvokeEvent, raw): Promise<ClaudeProjectsResult> => {
      assertRendererFrame(event);
      await claudeService.boot();
      return handleClaudeProjects(raw);
    },
  );

  ipcMain.handle(
    IPC.CLAUDE.REPO_STATE,
    async (event: IpcMainInvokeEvent, raw): Promise<ClaudeRepoState> => {
      assertRendererFrame(event);
      await claudeService.boot();
      return handleClaudeRepoState(raw);
    },
  );

  ipcMain.handle(
    IPC.CLAUDE.SESSION_TRANSCRIPT,
    async (
      event: IpcMainInvokeEvent,
      raw,
    ): Promise<ClaudeSessionTranscriptResult> => {
      assertRendererFrame(event);
      await claudeService.boot();
      return handleClaudeSessionTranscript(raw);
    },
  );

  ipcMain.handle(
    IPC.CLAUDE.GLOBAL_USAGE,
    async (
      event: IpcMainInvokeEvent,
      raw,
    ): Promise<ClaudeGlobalUsageResult> => {
      assertRendererFrame(event);
      await claudeService.boot();
      return handleClaudeGlobalUsage(raw);
    },
  );

  ipcMain.handle(
    IPC.CLAUDE.LAUNCH,
    async (event: IpcMainInvokeEvent, raw): Promise<ClaudeLaunchResult> => {
      assertRendererFrame(event);
      await claudeService.boot();
      return handleClaudeLaunch(raw);
    },
  );

  ipcMain.handle(
    IPC.CLAUDE.OPEN_CLAUDE_MD,
    async (
      event: IpcMainInvokeEvent,
      raw,
    ): Promise<ClaudeOpenClaudeMdResult> => {
      assertRendererFrame(event);
      await claudeService.boot();
      return handleClaudeOpenClaudeMd(raw);
    },
  );
}
