/**
 * Scanner worker thread.
 *
 * Mirrors `lib/git/scanner.ts` from the legacy app, but split across the
 * worker/main boundary:
 *   - Worker (this file): walks the filesystem, reads per-repo metadata,
 *     emits `ScanEvent`s back via `parentPort.postMessage`. NEVER touches
 *     the DB.
 *   - Main thread (`services/scan.ts`): listens for events, performs the
 *     DB upsert + heuristic tagging, fans out `scan:on:progress` IPC events.
 *
 * Splitting the work this way avoids:
 *   - Loading `better-sqlite3` in the worker (its prebuilt ABI is touchy
 *     to load from worker threads under ESM, and is unnecessary here).
 *   - Concurrent SQLite writers (the WAL lock would serialize them anyway,
 *     so doing all writes from main is simpler and just as fast).
 *
 * Native-module loading note: `find-git-repositories` is a CommonJS native
 * module. Worker threads in ESM-mode cannot `import` it directly — use
 * `createRequire(import.meta.url)` (memory observation 595 documents the
 * pattern from the MVP).
 */

import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

import type { ScanEvent } from "@shared/types";

import { readRepoMetadata, canonicalPath, slugFromNameAndPath } from "../services/metadata";

// ---------------------------------------------------------------------------
// Worker boot
// ---------------------------------------------------------------------------

if (!parentPort) {
  throw new Error("[scanner.worker] must be loaded as a worker thread");
}

interface WorkerInit {
  paths: string[];
  ignorePaths: string[];
}

// `find-git-repositories` is a CommonJS native module. The Vite ESM bundle
// cannot `import` it; load via createRequire instead.
const requireCjs = createRequire(import.meta.url);
type FindGitRepos = (
  rootPath: string,
  cb?: (paths: string[]) => void,
) => Promise<string[]>;
const findGitRepos = requireCjs("find-git-repositories") as FindGitRepos;

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

/**
 * Worker → main event envelope.
 *
 * - `progress` / `error` / `done` mirror `ScanEvent` from `contracts/types.ts`.
 * - `discovered` carries the metadata blob the main thread needs to perform
 *   the DB upsert. It is internal to the worker↔main boundary; the IPC
 *   stream uses `repo` once main has inserted the row.
 */
export type WorkerEvent =
  | { kind: "progress"; processed: number; total: number; currentPath: string }
  | {
      kind: "discovered";
      fullPath: string;
      metadata: Awaited<ReturnType<typeof readRepoMetadata>>["metadata"];
      slugHint: string;
    }
  | { kind: "done"; totalRepos: number; durationMs: number }
  | ({ kind: "error" } & { message: string; path: string | null });

function emit(ev: WorkerEvent): void {
  parentPort!.postMessage(ev);
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

let cancelled = false;

parentPort.on("message", (msg: unknown) => {
  if (msg && typeof msg === "object" && (msg as { type?: string }).type === "cancel") {
    cancelled = true;
  }
});

// ---------------------------------------------------------------------------
// Main scan loop
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const init = (workerData ?? { paths: [], ignorePaths: [] }) as WorkerInit;
  const paths = init.paths ?? [];
  const ignoreSet = new Set(
    (init.ignorePaths ?? []).map((p) => canonicalPath(p)),
  );
  const startedAt = Date.now();

  const discovered: string[] = [];
  const seen = new Set<string>();

  // Phase 1: discover all `.git` directories.
  for (const raw of paths) {
    if (cancelled) break;
    if (!raw || typeof raw !== "string") continue;
    const root = canonicalPath(raw);
    if (ignoreSet.has(root)) continue;
    try {
      // `find-git-repositories` requires a progress callback even when its
      // promise resolves to the full list. Pass a no-op so it doesn't throw
      // (memory observation 599 — MVP scanner pattern).
      const found = (await findGitRepos(root, () => {})) as string[];
      for (const gitDir of found) {
        const repoRoot = canonicalPath(
          gitDir.endsWith("/.git") ? gitDir.slice(0, -5) : gitDir,
        );
        if (seen.has(repoRoot)) continue;
        if (ignoreSet.has(repoRoot)) continue;
        seen.add(repoRoot);
        discovered.push(gitDir);
      }
    } catch (err) {
      emit({
        kind: "error",
        path: root,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const totalFound = discovered.length;

  // Phase 2: read metadata + emit per-repo events.
  for (let i = 0; i < discovered.length; i++) {
    if (cancelled) break;
    const gitDir = discovered[i];
    const processed = i + 1;
    try {
      const { fullPath, metadata } = await readRepoMetadata(gitDir);

      emit({
        kind: "progress",
        processed,
        total: totalFound,
        currentPath: fullPath,
      });

      emit({
        kind: "discovered",
        fullPath,
        metadata,
        slugHint: slugFromNameAndPath(metadata.name, fullPath),
      });
    } catch (err) {
      emit({
        kind: "error",
        path: gitDir,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  emit({
    kind: "done",
    totalRepos: totalFound,
    durationMs: Date.now() - startedAt,
  });
}

run().catch((err) => {
  emit({
    kind: "error",
    path: null,
    message: err instanceof Error ? err.message : String(err),
  });
  emit({ kind: "done", totalRepos: 0, durationMs: 0 });
});

// Mark the file as a module for tsc.
export type { ScanEvent };
