/**
 * IPC handlers — `git:*` namespace.
 *
 * Three handlers: `git:status`, `git:branches`, `git:openInEditor`.
 *
 * The `openInEditor` handler:
 *   1. Resolves the editor target URI via the GitService (which consults
 *      the user's settings for the default editor).
 *   2. Filters the URI through `openExternalAllowlisted` from the
 *      Phase 0 security helper — under no circumstances does the
 *      renderer get to hand an arbitrary URL to `shell.openExternal`.
 *   3. Stamps `repos.last_opened_at = now()` on success via
 *      `gitService.markOpened`.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  GitBranchesInputSchema,
  GitBranchesResultSchema,
  GitStatusInputSchema,
  GitStatusSchema,
  OpenInEditorInputSchema,
  OpenInEditorResultSchema,
  SyncInputSchema,
  SyncResultSchema,
} from "@shared/schemas";
import type {
  GitBranchesResult,
  GitStatus,
  OpenInEditorResult,
  SyncResult,
} from "@shared/types";

import { openExternalAllowlisted } from "@main/security/allowlist";
import { gitSyncService } from "@main/services/git-sync";
import { gitService } from "@main/services/git";

import { assertRendererFrame } from "./_frame";

export async function handleGitStatus(raw: unknown): Promise<GitStatus> {
  const input = GitStatusInputSchema.parse(raw);
  const result = await gitService.status(input.slug);
  return GitStatusSchema.parse(result);
}

export async function handleGitBranches(raw: unknown): Promise<GitBranchesResult> {
  const input = GitBranchesInputSchema.parse(raw);
  const result = await gitService.branches(input.slug);
  return GitBranchesResultSchema.parse(result);
}

export async function handleGitOpenInEditor(raw: unknown): Promise<OpenInEditorResult> {
  const input = OpenInEditorInputSchema.parse(raw);
  const { uri } = await gitService.resolveEditorUri(input);

  // No editor configured / no resolvable target — return non-error
  // result so the renderer can render a toast.
  if (!uri) {
    return OpenInEditorResultSchema.parse({ opened: false, uri: null });
  }

  const launch = await openExternalAllowlisted(uri);
  if (!launch.ok) {
    // Allowlist rejected (unknown scheme) or shell.openExternal failed.
    // We still return a structured result rather than throwing so the
    // renderer doesn't need an error boundary for this affordance.
    return OpenInEditorResultSchema.parse({ opened: false, uri });
  }

  await gitService.markOpened(input.slug);
  return OpenInEditorResultSchema.parse({ opened: true, uri });
}

/**
 * Register every `git:*` handler. Idempotent.
 */

/**
 * Update remote refs without touching any working tree. Safe on every
 * repo, so this is how the catalog refreshes ahead/behind in bulk.
 */
export async function handleGitFetch(raw: unknown): Promise<SyncResult> {
  const input = SyncInputSchema.parse(raw);
  const result = await gitSyncService.fetch(input.slugs);
  return SyncResultSchema.parse(result);
}

/** Fast-forward each repo where that is unambiguously safe. */
export async function handleGitPull(raw: unknown): Promise<SyncResult> {
  const input = SyncInputSchema.parse(raw);
  const result = await gitSyncService.pull(input.slugs);
  return SyncResultSchema.parse(result);
}

export function registerGitHandlers(): void {
  const channels = [
    IPC.GIT.STATUS,
    IPC.GIT.BRANCHES,
    IPC.GIT.OPEN_IN_EDITOR,
    IPC.GIT.FETCH,
    IPC.GIT.PULL,
  ] as const;
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    IPC.GIT.STATUS,
    async (event: IpcMainInvokeEvent, raw): Promise<GitStatus> => {
      assertRendererFrame(event);
      return handleGitStatus(raw);
    },
  );

  ipcMain.handle(
    IPC.GIT.BRANCHES,
    async (event: IpcMainInvokeEvent, raw): Promise<GitBranchesResult> => {
      assertRendererFrame(event);
      return handleGitBranches(raw);
    },
  );

  ipcMain.handle(
    IPC.GIT.OPEN_IN_EDITOR,
    async (event: IpcMainInvokeEvent, raw): Promise<OpenInEditorResult> => {
      assertRendererFrame(event);
      return handleGitOpenInEditor(raw);
    },
  );
  ipcMain.handle(
    IPC.GIT.FETCH,
    async (event: IpcMainInvokeEvent, raw): Promise<SyncResult> => {
      assertRendererFrame(event);
      return handleGitFetch(raw);
    },
  );

  ipcMain.handle(
    IPC.GIT.PULL,
    async (event: IpcMainInvokeEvent, raw): Promise<SyncResult> => {
      assertRendererFrame(event);
      return handleGitPull(raw);
    },
  );
}
