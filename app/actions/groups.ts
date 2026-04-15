"use server";

import { z } from "zod";
import {
  addRepoToGroupBySlug,
  deleteGroupRow,
  insertGroup,
  listGroups,
  removeRepoFromGroupBySlug,
  updateGroupRow,
} from "@/lib/db/queries";
import type { ActionResult, Group, SmartFilter } from "@/lib/types";

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function err(
  code:
    | "NOT_FOUND"
    | "BAD_REQUEST"
    | "SCAN_FAILED"
    | "EMBED_UNAVAILABLE"
    | "DB_ERROR"
    | "VALIDATION"
    | "INTERNAL",
  message: string,
  details?: Record<string, unknown>,
): ActionResult<never> {
  return { ok: false, error: { code, message, details } };
}

const SmartFilterSchema: z.ZodType<SmartFilter> = z.object({
  language: z.string().optional(),
  tagsInclude: z.array(z.string()).optional(),
  tagsExclude: z.array(z.string()).optional(),
  dirtyOnly: z.boolean().optional(),
  sinceDays: z.number().int().optional(),
  hasRemote: z.boolean().optional(),
});

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  isSmart: z.boolean().optional(),
  smartFilter: SmartFilterSchema.nullable().optional(),
  parentGroupId: z.number().int().nullable().optional(),
});

export async function createGroup(
  input: z.infer<typeof CreateSchema>,
): Promise<ActionResult<Group>> {
  try {
    const parsed = CreateSchema.parse(input);
    const g = await insertGroup(parsed);
    return ok<Group>(g);
  } catch (e) {
    if (e instanceof z.ZodError) return err("VALIDATION", e.message);
    console.error("[backend] createGroup error", e);
    return err("DB_ERROR", e instanceof Error ? e.message : String(e));
  }
}

const UpdatePatchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  isSmart: z.boolean().optional(),
  smartFilter: SmartFilterSchema.nullable().optional(),
  parentGroupId: z.number().int().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function updateGroup(
  id: number,
  patch: z.infer<typeof UpdatePatchSchema>,
): Promise<ActionResult<Group>> {
  try {
    const parsedId = z.number().int().parse(id);
    const parsed = UpdatePatchSchema.parse(patch);
    const g = await updateGroupRow(parsedId, parsed as Partial<Group>);
    if (!g) return err("NOT_FOUND", `group ${id} not found`);
    return ok<Group>(g);
  } catch (e) {
    if (e instanceof z.ZodError) return err("VALIDATION", e.message);
    console.error("[backend] updateGroup error", e);
    return err("DB_ERROR", e instanceof Error ? e.message : String(e));
  }
}

export async function deleteGroup(
  id: number,
): Promise<ActionResult<{ deleted: true }>> {
  try {
    const parsedId = z.number().int().parse(id);
    await deleteGroupRow(parsedId);
    return ok({ deleted: true } as const);
  } catch (e) {
    if (e instanceof z.ZodError) return err("VALIDATION", e.message);
    console.error("[backend] deleteGroup error", e);
    return err("DB_ERROR", e instanceof Error ? e.message : String(e));
  }
}

export async function addRepoToGroup(
  slug: string,
  groupId: number,
): Promise<ActionResult<{ added: true }>> {
  try {
    const s = z.string().min(1).parse(slug);
    const gid = z.number().int().parse(groupId);
    await addRepoToGroupBySlug(s, gid);
    return ok({ added: true } as const);
  } catch (e) {
    if (e instanceof z.ZodError) return err("VALIDATION", e.message);
    console.error("[backend] addRepoToGroup error", e);
    return err("DB_ERROR", e instanceof Error ? e.message : String(e));
  }
}

export async function removeRepoFromGroup(
  slug: string,
  groupId: number,
): Promise<ActionResult<{ removed: true }>> {
  try {
    const s = z.string().min(1).parse(slug);
    const gid = z.number().int().parse(groupId);
    await removeRepoFromGroupBySlug(s, gid);
    return ok({ removed: true } as const);
  } catch (e) {
    if (e instanceof z.ZodError) return err("VALIDATION", e.message);
    console.error("[backend] removeRepoFromGroup error", e);
    return err("DB_ERROR", e instanceof Error ? e.message : String(e));
  }
}

export async function listGroupsAction(): Promise<ActionResult<Group[]>> {
  try {
    const groups = await listGroups();
    return ok<Group[]>(groups);
  } catch (e) {
    console.error("[backend] listGroupsAction error", e);
    return err("DB_ERROR", e instanceof Error ? e.message : String(e));
  }
}
