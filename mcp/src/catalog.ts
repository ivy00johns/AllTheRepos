/**
 * Open the same catalog the desktop app uses.
 *
 * `db/client.ts` deliberately does not import Electron — it resolves the
 * data directory from an override or the `ATR_DATA_DIR` environment
 * variable — so this process can reuse the app's real query layer
 * unmodified.
 *
 * SQLite runs in WAL mode, which permits one writer plus concurrent
 * readers across processes. Running alongside the open app is safe.
 */

import os from "node:os";
import path from "node:path";

import { getDb, setDataDirOverride } from "@main/db/client";

/** Where Electron's `app.getPath('userData')` resolves on macOS. */
function defaultDataDir(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "alltherepos",
  );
}

let opened = false;

export function openCatalog(): void {
  if (opened) return;
  if (!process.env.ATR_DATA_DIR) {
    setDataDirOverride(defaultDataDir());
  }
  // Runs migrations and the additive-table DDL as a side effect, so the
  // MCP works against a catalog created by an older app build.
  getDb();
  opened = true;
}
