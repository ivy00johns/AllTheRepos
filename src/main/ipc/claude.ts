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
      return handleClaudeIndex(raw);
    },
  );

  ipcMain.handle(
    IPC.CLAUDE.PROJECTS,
    async (event: IpcMainInvokeEvent, raw): Promise<ClaudeProjectsResult> => {
      assertRendererFrame(event);
      return handleClaudeProjects(raw);
    },
  );

  ipcMain.handle(
    IPC.CLAUDE.REPO_STATE,
    async (event: IpcMainInvokeEvent, raw): Promise<ClaudeRepoState> => {
      assertRendererFrame(event);
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
      return handleClaudeGlobalUsage(raw);
    },
  );

  ipcMain.handle(
    IPC.CLAUDE.LAUNCH,
    async (event: IpcMainInvokeEvent, raw): Promise<ClaudeLaunchResult> => {
      assertRendererFrame(event);
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
      return handleClaudeOpenClaudeMd(raw);
    },
  );
}
