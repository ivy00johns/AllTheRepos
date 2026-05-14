/**
 * Chokidar watcher wrap for `~/.claude/projects/`.
 *
 * Emits debounced `(hash, reason)` events when JSONL files are
 * added / changed / removed under any project hash directory. The
 * debounce is per-hash (one `Map<hash, NodeJS.Timeout>`) so two
 * unrelated projects mutating concurrently don't cancel each other.
 *
 * The watcher is owned by ClaudeService — this module is just the
 * thin wrap that handles the lifecycle + debounce logic. ClaudeService
 * is responsible for re-parsing the affected session JSONL and
 * emitting the IPC update event.
 */

import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import type { ClaudeUpdateEvent } from "@shared/types";

const DEBOUNCE_MS = 300;
const STABILITY_MS = 250;

export type WatcherListener = (event: ClaudeUpdateEvent) => void;

/**
 * Start watching the Claude projects root. Returns a handle with
 * `close()` so callers can rebuild the watcher on `boot()` re-call.
 */
export interface WatcherHandle {
  close(): Promise<void>;
}

/**
 * Open a chokidar watcher rooted at `projectsRoot` and translate
 * raw fs events into `(hash, reason)` callbacks for the service.
 *
 * Best-effort — a non-existent root or a chokidar internal failure
 * results in a no-op handle (closing is harmless). The app MUST boot
 * even when `~/.claude/projects/` doesn't exist (e.g. fresh Claude
 * Code install).
 */
export function startWatcher(
  projectsRoot: string,
  listener: WatcherListener,
): WatcherHandle {
  let watcher: FSWatcher | null = null;
  const pending = new Map<string, NodeJS.Timeout>();
  const lastReason = new Map<string, ClaudeUpdateEvent["reason"]>();
  let closed = false;

  try {
    watcher = chokidar.watch(projectsRoot, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: STABILITY_MS, pollInterval: 100 },
      depth: 2,
      persistent: true,
    });
  } catch (err) {
    console.warn(`[claude] failed to start watcher on ${projectsRoot}:`, err);
    return {
      close: async () => {
        /* nothing to close */
      },
    };
  }

  const scheduleFire = (
    hash: string,
    reason: ClaudeUpdateEvent["reason"],
  ): void => {
    if (closed) return;
    // Most-recent wins on reason if the debounce window collapses
    // multiple events. "session-added" stays added; subsequent
    // "session-updated" within 300ms is informational only.
    const prior = lastReason.get(hash);
    if (!prior || reason === "session-removed") {
      lastReason.set(hash, reason);
    } else if (prior !== "session-added") {
      lastReason.set(hash, reason);
    }
    const existing = pending.get(hash);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pending.delete(hash);
      const fireReason = lastReason.get(hash) ?? "session-updated";
      lastReason.delete(hash);
      try {
        listener({ projectHash: hash, reason: fireReason });
      } catch (err) {
        console.warn("[claude] watcher listener threw:", err);
      }
    }, DEBOUNCE_MS);
    pending.set(hash, timer);
  };

  const handleFsEvent = (
    eventName: "add" | "change" | "unlink",
    fullPath: string,
  ): void => {
    if (!fullPath.toLowerCase().endsWith(".jsonl")) return;
    const hash = extractProjectHash(projectsRoot, fullPath);
    if (!hash) return;
    const reason: ClaudeUpdateEvent["reason"] =
      eventName === "add"
        ? "session-added"
        : eventName === "unlink"
          ? "session-removed"
          : "session-updated";
    scheduleFire(hash, reason);
  };

  watcher.on("add", (p) => handleFsEvent("add", p));
  watcher.on("change", (p) => handleFsEvent("change", p));
  watcher.on("unlink", (p) => handleFsEvent("unlink", p));
  watcher.on("error", (err) => {
    console.warn("[claude] watcher error:", err);
  });

  return {
    close: async () => {
      closed = true;
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
      lastReason.clear();
      if (watcher) {
        try {
          await watcher.close();
        } catch (err) {
          console.warn("[claude] watcher close failed:", err);
        }
      }
    },
  };
}

/**
 * Pull the `<hash>` segment out of a path like
 * `<projectsRoot>/<hash>/<sessionId>.jsonl`. Returns null when the
 * path doesn't sit under `projectsRoot` or is at the wrong depth.
 *
 * Exposed for unit tests.
 */
export function extractProjectHash(
  projectsRoot: string,
  fullPath: string,
): string | null {
  const normalizedRoot = path.resolve(projectsRoot);
  const normalizedPath = path.resolve(fullPath);
  if (!normalizedPath.startsWith(normalizedRoot + path.sep)) return null;
  const tail = normalizedPath.slice(normalizedRoot.length + 1);
  const segments = tail.split(path.sep);
  if (segments.length < 2) return null;
  const hash = segments[0];
  if (!hash) return null;
  return hash;
}
