/**
 * One-time data migration from the legacy `~/.alltherepos/` directory
 * (Next.js MVP storage) to the Electron `userData` directory.
 *
 * Behavior (per `contracts/data-layer.v1.md`):
 *   - COPY (never MOVE) the SQLite db, LanceDB dir, and notes/.
 *   - Idempotent — gated by a `MIGRATED` sentinel file in `userData`.
 *   - No destructive operations on the legacy location.
 *
 * If the sentinel exists OR the legacy directory does not exist, this is a
 * no-op. Call from `app.whenReady()` BEFORE the first `getDb()` call so the
 * copy lands on the canonical SQLite path the client will then open.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SENTINEL_FILE = "MIGRATED";

function copyFileIfExists(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function copyDirIfExists(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest)) return false;
  // Node 16.7+ has fs.cpSync — copy the entire tree.
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

export interface MigrationReport {
  ran: boolean;
  copiedDb: boolean;
  copiedLance: boolean;
  copiedNotes: boolean;
  reason?: string;
}

/**
 * Run the one-shot migration. Safe to call on every boot — the sentinel
 * guards against repeat runs.
 *
 * @param userDataDir resolved Electron `userData` directory
 * @param legacyDirOverride optional override for tests (defaults to `~/.alltherepos`)
 */
export function migrateFromLegacy(
  userDataDir: string,
  legacyDirOverride?: string,
): MigrationReport {
  const legacyDir = legacyDirOverride ?? path.join(os.homedir(), ".alltherepos");
  const sentinel = path.join(userDataDir, SENTINEL_FILE);

  if (fs.existsSync(sentinel)) {
    return {
      ran: false,
      copiedDb: false,
      copiedLance: false,
      copiedNotes: false,
      reason: "sentinel_present",
    };
  }
  if (!fs.existsSync(legacyDir)) {
    // Nothing to migrate — write the sentinel anyway so we don't poke at the
    // legacy path on every subsequent boot.
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(sentinel, new Date().toISOString());
    return {
      ran: false,
      copiedDb: false,
      copiedLance: false,
      copiedNotes: false,
      reason: "no_legacy_dir",
    };
  }

  fs.mkdirSync(userDataDir, { recursive: true });

  const copiedDb = copyFileIfExists(
    path.join(legacyDir, "alltherepos.db"),
    path.join(userDataDir, "alltherepos.db"),
  );
  const copiedLance = copyDirIfExists(
    path.join(legacyDir, "lance"),
    path.join(userDataDir, "lance"),
  );
  const copiedNotes = copyDirIfExists(
    path.join(legacyDir, "notes"),
    path.join(userDataDir, "notes"),
  );

  fs.writeFileSync(sentinel, new Date().toISOString());
  return {
    ran: true,
    copiedDb,
    copiedLance,
    copiedNotes,
  };
}
