/**
 * Migration runner. Bootstraps the DB connection on first call:
 *   1. Resolves the data directory from Electron's `app.getPath('userData')`
 *      and pins it via `setDataDirOverride()` (the client requires this
 *      before any `getDb()` call).
 *   2. Triggers the lazy `getDb()` initializer which:
 *      - opens the SQLite file at `{userData}/alltherepos.db`,
 *      - runs Drizzle migrations from `drizzle/`,
 *      - creates the FTS5 virtual table + triggers,
 *      - seeds the singleton `settings` row.
 *
 * Idempotent. Safe to call on every boot. Synchronous return — better-sqlite3
 * is sync by design.
 */

import { app } from "electron";

import { getDb, setDataDirOverride } from "./client";

export function runMigrations(): void {
  // Pin the data dir to Electron's userData per `contracts/data-layer.v1.md`
  // BEFORE the lazy `getDb()` runs.
  setDataDirOverride(app.getPath("userData"));
  // getDb() runs drizzle migrate + FTS setup + seed as a side effect.
  getDb();
}
