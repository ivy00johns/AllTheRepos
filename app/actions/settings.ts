"use server";

import { z } from "zod";
import {
  addScanPathRow,
  getSettings,
  removeScanPathRow,
  upsertSettings,
} from "@/lib/db/queries";
import type { ActionResult, Settings } from "@/lib/types";

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

const SettingsPatchSchema = z.object({
  scanPaths: z.array(z.string()).optional(),
  ollamaBaseUrl: z.string().optional(),
  ollamaEmbedModel: z.string().optional(),
  openaiEmbedModel: z.string().nullable().optional(),
  defaultEditor: z.enum(["vscode", "cursor", "none"]).optional(),
  schemaVersion: z.number().int().optional(),
});

export async function saveSettings(
  patch: z.infer<typeof SettingsPatchSchema>,
): Promise<ActionResult<Settings>> {
  try {
    const parsed = SettingsPatchSchema.parse(patch);
    // Sync scan paths to the scan_paths table if provided.
    if (parsed.scanPaths) {
      const existing = await getSettings();
      const wanted = new Set(parsed.scanPaths);
      const current = new Set(existing.scanPaths);
      for (const p of parsed.scanPaths) {
        if (!current.has(p)) await addScanPathRow(p);
      }
      for (const p of existing.scanPaths) {
        if (!wanted.has(p)) await removeScanPathRow(p);
      }
    }
    const next = await upsertSettings(parsed as Partial<Settings>);
    return ok<Settings>(next);
  } catch (e) {
    if (e instanceof z.ZodError) return err("VALIDATION", e.message);
    console.error("[backend] saveSettings error", e);
    return err("DB_ERROR", e instanceof Error ? e.message : String(e));
  }
}

export async function addScanPath(
  path: string,
): Promise<ActionResult<Settings>> {
  try {
    const p = z.string().min(1).parse(path);
    await addScanPathRow(p);
    const current = await getSettings();
    const merged = Array.from(new Set([...(current.scanPaths ?? []), p]));
    const next = await upsertSettings({ scanPaths: merged });
    return ok<Settings>(next);
  } catch (e) {
    if (e instanceof z.ZodError) return err("VALIDATION", e.message);
    console.error("[backend] addScanPath error", e);
    return err("DB_ERROR", e instanceof Error ? e.message : String(e));
  }
}

export async function removeScanPath(
  path: string,
): Promise<ActionResult<Settings>> {
  try {
    const p = z.string().min(1).parse(path);
    await removeScanPathRow(p);
    const current = await getSettings();
    const filtered = (current.scanPaths ?? []).filter((x) => x !== p);
    const next = await upsertSettings({ scanPaths: filtered });
    return ok<Settings>(next);
  } catch (e) {
    if (e instanceof z.ZodError) return err("VALIDATION", e.message);
    console.error("[backend] removeScanPath error", e);
    return err("DB_ERROR", e instanceof Error ? e.message : String(e));
  }
}
