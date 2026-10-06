/**
 * IPC handlers — `tasks:*` namespace.
 *
 * Discovering and running the commands a project declares. Every handler
 * follows the house pattern: assert the frame, Zod-parse in, delegate,
 * Zod-parse out.
 *
 * `tasks:start` returns immediately with a run id; the actual output
 * arrives on the `tasks:on:output` push stream. Waiting for a dev server
 * to "finish" would never return.
 */

import { randomUUID } from "node:crypto";

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  TaskActiveInputSchema,
  TaskActiveResultSchema,
  TaskListInputSchema,
  TaskListResultSchema,
  TaskStartInputSchema,
  TaskStartResultSchema,
  TaskStopInputSchema,
  TaskStopResultSchema,
} from "@shared/schemas";
import type {
  TaskActiveResult,
  TaskListResult,
  TaskStartResult,
  TaskStopResult,
} from "@shared/types";

import { getSqlite } from "@main/db/client";
import { taskService } from "@main/services/tasks";

import { assertRendererFrame } from "./_frame";

function repoPathBySlug(slug: string): string | null {
  const row = getSqlite()
    .prepare("SELECT full_path FROM repos WHERE slug = ?")
    .get(slug) as { full_path: string } | undefined;
  return row?.full_path ?? null;
}

export async function handleTasksList(raw: unknown): Promise<TaskListResult> {
  const input = TaskListInputSchema.parse(raw);
  const fullPath = repoPathBySlug(input.slug);
  // An unknown or vanished repo has no tasks — not an error worth
  // rejecting the call over, since the UI asks on every selection.
  const tasks = fullPath ? taskService.list(fullPath) : [];
  return TaskListResultSchema.parse({ tasks });
}

export async function handleTasksStart(raw: unknown): Promise<TaskStartResult> {
  const input = TaskStartInputSchema.parse(raw);
  const fullPath = repoPathBySlug(input.slug);
  if (!fullPath) {
    return TaskStartResultSchema.parse({
      runId: null,
      started: false,
      reason: "That repo isn't in the catalog any more.",
    });
  }

  // The command is resolved from the repo's OWN declared tasks — the
  // renderer sends a task id, never a command string, so nothing the UI
  // says can turn into an arbitrary shell execution.
  const task = taskService.list(fullPath).find((t) => t.id === input.taskId);
  if (!task) {
    return TaskStartResultSchema.parse({
      runId: null,
      started: false,
      reason: "That task no longer exists in this project.",
    });
  }

  const runId = randomUUID();
  const result = taskService.start({
    runId,
    slug: input.slug,
    taskId: task.id,
    command: task.command,
    cwd: fullPath,
  });

  return TaskStartResultSchema.parse({
    runId: result.started ? runId : null,
    started: result.started,
    reason: result.reason,
  });
}

export async function handleTasksStop(raw: unknown): Promise<TaskStopResult> {
  const input = TaskStopInputSchema.parse(raw);
  return TaskStopResultSchema.parse(taskService.stop(input.runId));
}

export async function handleTasksActive(
  raw: unknown,
): Promise<TaskActiveResult> {
  TaskActiveInputSchema.parse(raw);
  return TaskActiveResultSchema.parse({ runs: taskService.active() });
}

/** Register every `tasks:*` handler. Idempotent. */
export function registerTaskHandlers(): void {
  const channels = [
    IPC.TASKS.LIST,
    IPC.TASKS.START,
    IPC.TASKS.STOP,
    IPC.TASKS.ACTIVE,
  ] as const;
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    IPC.TASKS.LIST,
    async (event: IpcMainInvokeEvent, raw): Promise<TaskListResult> => {
      assertRendererFrame(event);
      return handleTasksList(raw);
    },
  );

  ipcMain.handle(
    IPC.TASKS.START,
    async (event: IpcMainInvokeEvent, raw): Promise<TaskStartResult> => {
      assertRendererFrame(event);
      return handleTasksStart(raw);
    },
  );

  ipcMain.handle(
    IPC.TASKS.STOP,
    async (event: IpcMainInvokeEvent, raw): Promise<TaskStopResult> => {
      assertRendererFrame(event);
      return handleTasksStop(raw);
    },
  );

  ipcMain.handle(
    IPC.TASKS.ACTIVE,
    async (event: IpcMainInvokeEvent, raw): Promise<TaskActiveResult> => {
      assertRendererFrame(event);
      return handleTasksActive(raw);
    },
  );
}
