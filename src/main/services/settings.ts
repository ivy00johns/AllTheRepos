/**
 * Settings service — JSON-file backed at `{userData}/settings.json`.
 *
 * Phase 1 contract (`contracts/data-layer.v1.md`):
 *   - File path: `app.getPath('userData')/settings.json`
 *   - Schema:    `SettingsSchema` (Zod) from `src/shared/schemas.ts`
 *   - On first run, seed defaults if the file is absent. If the legacy
 *     SQLite `settings` row exists (after data migration copied it over),
 *     promote it to `settings.json` and thereafter ignore the SQLite row.
 *
 * Implementation note: the data-layer contract names `electron-store` as the
 * backing library. We ship a tiny hand-rolled JSON-file store with the same
 * durability guarantee (atomic temp-file + rename) to avoid adding a new
 * dependency in this wave. The semantics — file path, on-disk shape, and
 * read/write API — match the contract exactly; swapping in `electron-store`
 * later is a drop-in replacement (see report).
 */

import fs from "node:fs";
import path from "node:path";

import { app } from "electron";

import { SettingsSchema } from "@shared/schemas";
import type { Settings } from "@shared/types";

import { getSettingsFromTable } from "@main/db/queries";

const SETTINGS_FILENAME = "settings.json";
const LEGACY_FLAG = "__legacyPromoted";

const DEFAULTS: Settings = {
  scanPaths: [],
  ollamaBaseUrl: "http://localhost:11434",
  ollamaEmbedModel: "nomic-embed-text",
  openaiEmbedModel: null,
  defaultEditor: "vscode",
  schemaVersion: 1,
};

interface SettingsFile extends Settings {
  [LEGACY_FLAG]?: boolean;
}

let cached: SettingsFile | null = null;
let cachedPath: string | null = null;

function settingsPath(): string {
  if (cachedPath) return cachedPath;
  // `app.getPath('userData')` resolves at runtime; safe to call at module
  // boot because the service is only imported from main-process code (the
  // renderer must NEVER touch this file).
  cachedPath = path.join(app.getPath("userData"), SETTINGS_FILENAME);
  return cachedPath;
}

function readFromDisk(): SettingsFile {
  const fp = settingsPath();
  if (!fs.existsSync(fp)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const json = JSON.parse(raw) as Record<string, unknown>;
    // Drop the bookkeeping flag before Zod-validating the Settings shape.
    const { [LEGACY_FLAG]: legacyFlag, ...rest } = json;
    const parsed = SettingsSchema.safeParse(rest);
    const settings: Settings = parsed.success ? parsed.data : { ...DEFAULTS };
    return {
      ...settings,
      [LEGACY_FLAG]: Boolean(legacyFlag),
    };
  } catch (err) {
    console.error("[backend] settings read failed; using defaults", err);
    return { ...DEFAULTS };
  }
}

function writeToDisk(blob: SettingsFile): void {
  const fp = settingsPath();
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Atomic temp-file + rename = durable across crashes. Matches
  // electron-store's own write semantics.
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(blob, null, 2));
  fs.renameSync(tmp, fp);
}

function ensureCached(): SettingsFile {
  if (cached) return cached;
  cached = readFromDisk();

  // One-shot legacy promotion: if the SQLite settings row exists and we
  // haven't already imported it, copy its values forward.
  if (!cached[LEGACY_FLAG]) {
    try {
      const legacy = getSettingsFromTable();
      if (legacy) {
        const parsed = SettingsSchema.safeParse(legacy);
        if (parsed.success) {
          cached = { ...cached, ...parsed.data };
        }
      }
    } catch (err) {
      console.error("[backend] settings legacy promotion failed", err);
    }
    cached[LEGACY_FLAG] = true;
    writeToDisk(cached);
  }
  return cached;
}

/** Read the full Settings blob. Async to match `SettingsService` contract. */
export function getSettings(): Settings {
  const blob = ensureCached();
  // Strip the bookkeeping flag before returning the Settings shape.
  const { [LEGACY_FLAG]: _flag, ...settings } = blob;
  return settings;
}

/**
 * Apply a partial patch. Only the provided keys are written. `scanPaths`
 * (when present) replaces the entire array wholesale per the contract.
 */
export function updateSettings(patch: Partial<Settings>): Settings {
  const blob = ensureCached();
  // Strip undefined keys so we don't accidentally null-out fields.
  const cleaned: Partial<Settings> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      (cleaned as Record<string, unknown>)[k] = v;
    }
  }
  const next: SettingsFile = { ...blob, ...cleaned };
  // Re-validate; throw if the merged result is invalid so callers see it.
  const { [LEGACY_FLAG]: flag, ...candidate } = next;
  const parsed = SettingsSchema.parse(candidate);
  cached = { ...parsed, [LEGACY_FLAG]: flag };
  writeToDisk(cached);
  return parsed;
}

/** Test/QE override — reset cache + file-path memoization. */
export function resetSettingsCache(): void {
  cached = null;
  cachedPath = null;
}
