/**
 * IPC handlers — `groups:*` namespace.
 *
 * Five handlers: `list`, `create`, `rename`, `delete`, `setMembers`.
 * Groups live in the same SQLite DB as the catalog, so we wrap the
 * `CatalogService` rather than introduce a one-table sibling service.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  CreateGroupInputSchema,
  CreateGroupResultSchema,
  DeleteGroupInputSchema,
  DeleteGroupResultSchema,
  ListGroupsInputSchema,
  ListGroupsResultSchema,
  RenameGroupInputSchema,
  RenameGroupResultSchema,
  SetGroupMembersInputSchema,
  SetGroupMembersResultSchema,
} from "@shared/schemas";
import type {
  CreateGroupResult,
  DeleteGroupResult,
  ListGroupsResult,
  RenameGroupResult,
  SetGroupMembersResult,
} from "@shared/types";

import { catalogService } from "@main/services/catalog";

import { assertRendererFrame } from "./_frame";

export async function handleGroupsList(raw: unknown): Promise<ListGroupsResult> {
  ListGroupsInputSchema.parse(raw);
  const result = await catalogService.listGroups();
  return ListGroupsResultSchema.parse(result);
}

export async function handleGroupsCreate(raw: unknown): Promise<CreateGroupResult> {
  const input = CreateGroupInputSchema.parse(raw);
  const result = await catalogService.createGroup(input);
  return CreateGroupResultSchema.parse(result);
}

export async function handleGroupsRename(raw: unknown): Promise<RenameGroupResult> {
  const input = RenameGroupInputSchema.parse(raw);
  const result = await catalogService.renameGroup(input.id, input.name);
  return RenameGroupResultSchema.parse(result);
}

export async function handleGroupsDelete(raw: unknown): Promise<DeleteGroupResult> {
  const input = DeleteGroupInputSchema.parse(raw);
  const result = await catalogService.deleteGroup(input.id);
  return DeleteGroupResultSchema.parse(result);
}

export async function handleGroupsSetMembers(raw: unknown): Promise<SetGroupMembersResult> {
  const input = SetGroupMembersInputSchema.parse(raw);
  const result = await catalogService.setGroupMembers(input.groupId, input.slugs);
  return SetGroupMembersResultSchema.parse(result);
}

/** Register every `groups:*` handler. Idempotent. */
export function registerGroupsHandlers(): void {
  const channels = [
    IPC.GROUPS.LIST,
    IPC.GROUPS.CREATE,
    IPC.GROUPS.RENAME,
    IPC.GROUPS.DELETE,
    IPC.GROUPS.SET_MEMBERS,
  ] as const;
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    IPC.GROUPS.LIST,
    async (event: IpcMainInvokeEvent, raw): Promise<ListGroupsResult> => {
      assertRendererFrame(event);
      return handleGroupsList(raw);
    },
  );

  ipcMain.handle(
    IPC.GROUPS.CREATE,
    async (event: IpcMainInvokeEvent, raw): Promise<CreateGroupResult> => {
      assertRendererFrame(event);
      return handleGroupsCreate(raw);
    },
  );

  ipcMain.handle(
    IPC.GROUPS.RENAME,
    async (event: IpcMainInvokeEvent, raw): Promise<RenameGroupResult> => {
      assertRendererFrame(event);
      return handleGroupsRename(raw);
    },
  );

  ipcMain.handle(
    IPC.GROUPS.DELETE,
    async (event: IpcMainInvokeEvent, raw): Promise<DeleteGroupResult> => {
      assertRendererFrame(event);
      return handleGroupsDelete(raw);
    },
  );

  ipcMain.handle(
    IPC.GROUPS.SET_MEMBERS,
    async (event: IpcMainInvokeEvent, raw): Promise<SetGroupMembersResult> => {
      assertRendererFrame(event);
      return handleGroupsSetMembers(raw);
    },
  );
}
