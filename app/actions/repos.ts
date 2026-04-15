"use server";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  getRepoBySlug,
  getSettings,
  markRepoOpened,
  setUserTagsBySlug,
} from "@/lib/db/queries";
import { rowToRepo } from "@/lib/db/queries";
import { getSqlite } from "@/lib/db/client";
import { scanPaths } from "@/lib/git/scanner";
import type {
  ActionResult,
  Repo,
} from "@/lib/types";
import type { RepoRow } from "@/lib/db/schema";

const execFileAsync = promisify(execFile);

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

const SlugSchema = z.string().min(1);
const TagsSchema = z.array(z.string());

export async function rescanRepo(slug: string): Promise<ActionResult<Repo>> {
  try {
    const s = SlugSchema.parse(slug);
    const existing = await getRepoBySlug(s);
    if (!existing) return err("NOT_FOUND", `repo '${s}' not found`);
    // Drive the scanner over this single repo path.
    let found = false;
    for await (const _evt of scanPaths([existing.fullPath])) {
      if (_evt.kind === "error" && _evt.fullPath === existing.fullPath) {
        return err("SCAN_FAILED", _evt.message);
      }
      if (_evt.kind === "indexed") found = true;
    }
    const refreshed = await getRepoBySlug(s);
    if (!refreshed) {
      return err("INTERNAL", "repo disappeared after rescan");
    }
    if (!found) {
      // Scanner didn't find a .git under that path — could be deleted. Still return current row.
      return ok<Repo>(refreshed);
    }
    return ok<Repo>(refreshed);
  } catch (e) {
    if (e instanceof z.ZodError) return err("VALIDATION", e.message);
    console.error("[backend] rescanRepo error", e);
    return err("INTERNAL", e instanceof Error ? e.message : String(e));
  }
}

export async function setRepoTags(
  slug: string,
  tags: string[],
): Promise<ActionResult<Repo>> {
  try {
    const s = SlugSchema.parse(slug);
    const values = TagsSchema.parse(tags);
    const row = await setUserTagsBySlug(s, values);
    if (!row) return err("NOT_FOUND", `repo '${s}' not found`);
    return ok<Repo>(rowToRepo(row as RepoRow));
  } catch (e) {
    if (e instanceof z.ZodError) return err("VALIDATION", e.message);
    console.error("[backend] setRepoTags error", e);
    return err("INTERNAL", e instanceof Error ? e.message : String(e));
  }
}

export async function openInEditor(
  slug: string,
): Promise<ActionResult<{ opened: boolean }>> {
  try {
    const s = SlugSchema.parse(slug);
    const existing = await getRepoBySlug(s);
    if (!existing) return err("NOT_FOUND", `repo '${s}' not found`);
    const settings = await getSettings();
    if (settings.defaultEditor === "none") {
      return ok({ opened: false });
    }
    const bin = settings.defaultEditor === "cursor" ? "cursor" : "code";
    try {
      await execFileAsync(bin, [existing.fullPath]);
    } catch (e) {
      console.warn("[backend] openInEditor failed", e);
      return ok({ opened: false });
    }
    await markRepoOpened(s);
    return ok({ opened: true });
  } catch (e) {
    if (e instanceof z.ZodError) return err("VALIDATION", e.message);
    console.error("[backend] openInEditor error", e);
    return err("INTERNAL", e instanceof Error ? e.message : String(e));
  }
}

// Helper re-exported for API routes / tests
export async function getRepoRowBySlug(slug: string): Promise<RepoRow | null> {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare("SELECT * FROM repos WHERE slug = ?")
    .get(slug) as RepoRow | undefined;
  return row ?? null;
}
