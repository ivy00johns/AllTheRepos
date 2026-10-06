/**
 * Scan-root management.
 *
 * Adding and removing the directories the app watches used to be a trip
 * to Settings, which is the wrong place for it: the rail is where you
 * look at your folders, so it's where you should be able to say "also
 * watch this one" or "stop watching that one".
 *
 * This service owns the orchestration those two verbs need — validating
 * a directory, editing the settings array, and (on removal) optionally
 * forgetting the catalog rows underneath. It sits above both the
 * settings store and the catalog because it has to touch both; keeping
 * that coupling here rather than in the IPC layer means the rules are
 * testable without an Electron window.
 *
 * Nothing here ever deletes anything from disk. Removing a scan root
 * forgets catalog ROWS at most; the code itself is untouched.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { Settings } from "@shared/types";

import { getSqlite } from "@main/db/client";
import { catalogService } from "@main/services/catalog";
import { getSettings, updateSettings } from "@main/services/settings";
import { repoWatchService } from "@main/services/watch";

export interface AddScanRootResult {
  settings: Settings;
  added: boolean;
  /** Human-readable explanation when `added` is false. */
  reason: string | null;
}

export interface RemoveScanRootResult {
  settings: Settings;
  removed: boolean;
  /** Catalog rows dropped. Always 0 unless `forgetRepos` was set. */
  forgotten: number;
  reason: string | null;
}

function normalize(candidate: string): string {
  return path.resolve(candidate).replace(/\/+$/, "");
}

function isInside(child: string, parent: string): boolean {
  const withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child === parent || child.startsWith(withSep);
}

/** Slugs of every catalog row living beneath `dir`. */
function slugsUnder(dir: string): string[] {
  const prefix = `${normalize(dir)}/`;
  const rows = getSqlite()
    .prepare(
      "SELECT slug FROM repos WHERE full_path LIKE ? ESCAPE '\\' ORDER BY full_path",
    )
    .all(`${prefix.replace(/[\\%_]/g, "\\$&")}%`) as Array<{ slug: string }>;
  return rows.map((row) => row.slug);
}

class ScanRootService {
  /**
   * Add a directory to the scan roots.
   *
   * Refuses anything that isn't an existing directory, and anything
   * already covered — either exactly, or by a root further up the tree,
   * since the scanner already walks into it and a second entry would
   * just double the work and split the rail in two.
   */
  async add(candidate: string): Promise<AddScanRootResult> {
    const target = normalize(candidate);
    const settings = getSettings();
    const existing = settings.scanPaths.map(normalize);

    const fail = (reason: string): AddScanRootResult => ({
      settings,
      added: false,
      reason,
    });

    try {
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) return fail("That isn't a folder.");
    } catch {
      return fail("That folder doesn't exist.");
    }

    if (existing.includes(target)) {
      return fail("That folder is already being scanned.");
    }
    const covering = existing.find((root) => isInside(target, root));
    if (covering) {
      return fail(`Already covered by ${covering}.`);
    }

    // Adding a parent of existing roots makes those redundant — fold
    // them in rather than leaving duplicate coverage behind.
    const superseded = existing.filter((root) => isInside(root, target));
    const next = [
      ...existing.filter((root) => !superseded.includes(root)),
      target,
    ];

    const settingsAfter = updateSettings({ scanPaths: next });
    // The watch surface is defined by the scan roots, so it has to be
    // rebuilt whenever they change.
    void repoWatchService.restart();
    return { settings: settingsAfter, added: true, reason: null };
  }

  /**
   * Remove a scan root.
   *
   * `forgetRepos` decides what happens to what was found there. Left
   * false, the rows stay and surface under "Outside scan folders" —
   * honest, but noisy. Set true, the rows are dropped from the catalog.
   * Either way the directory and its contents are untouched on disk.
   */
  async remove(
    candidate: string,
    forgetRepos: boolean,
  ): Promise<RemoveScanRootResult> {
    const target = normalize(candidate);
    const settings = getSettings();
    const existing = settings.scanPaths.map(normalize);

    if (!existing.includes(target)) {
      return {
        settings,
        removed: false,
        forgotten: 0,
        reason: "That folder isn't in your scan list.",
      };
    }

    let forgotten = 0;
    if (forgetRepos) {
      for (const slug of slugsUnder(target)) {
        try {
          const result = await catalogService.deleteRepo(slug);
          if (result.deleted) forgotten++;
        } catch (error) {
          // One bad row must not abort the rest of the cleanup.
          console.error("[scan-roots] failed to forget repo", slug, error);
        }
      }
    }

    const next = existing.filter((root) => root !== target);
    const settingsAfter = updateSettings({ scanPaths: next });
    void repoWatchService.restart();
    return { settings: settingsAfter, removed: true, forgotten, reason: null };
  }

  /** How many catalog rows a removal would forget. Used by the confirm. */
  countUnder(candidate: string): number {
    return slugsUnder(candidate).length;
  }
}

export const scanRootService = new ScanRootService();
