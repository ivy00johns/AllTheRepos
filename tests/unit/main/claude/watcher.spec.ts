/**
 * Phase 3b Unit Test — chokidar watcher wrap for `~/.claude/projects/`.
 *
 * Covers:
 *   - extractProjectHash: well-formed path → hash; path not under root
 *     → null; root itself → null; too-shallow path → null.
 *   - startWatcher: subscribes to add / change / unlink + error; filters
 *     non-.jsonl files; debounces per-hash 300ms; close() cleans up
 *     timers and the watcher.
 *
 * chokidar is mocked: we capture the event-handler callbacks and
 * trigger them synthetically to verify routing + debouncing.
 *
 * Owner: qe-agent (Phase 3b).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";

// ---------------------------------------------------------------------------
// Mock chokidar
// ---------------------------------------------------------------------------

type FsHandler = (p: string) => void;
type ErrHandler = (err: unknown) => void;

interface MockWatcherHandle {
  handlers: Record<string, FsHandler | ErrHandler>;
  closeMock: ReturnType<typeof vi.fn>;
}

const watcherRegistry: MockWatcherHandle[] = [];

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => {
      const handlers: Record<string, FsHandler | ErrHandler> = {};
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const obj: Record<string, unknown> = {
        on: vi.fn((event: string, cb: FsHandler | ErrHandler) => {
          handlers[event] = cb;
          return obj;
        }),
        close: closeMock,
      };
      const entry: MockWatcherHandle = { handlers, closeMock };
      watcherRegistry.push(entry);
      return obj;
    }),
  },
}));

import { extractProjectHash, startWatcher } from "@main/claude/watcher";

// ---------------------------------------------------------------------------
// extractProjectHash
// ---------------------------------------------------------------------------

describe("extractProjectHash", () => {
  const root = path.resolve("/Users/john/.claude/projects");

  it("extracts the hash segment from a session JSONL path", () => {
    const p = path.join(root, "abc123", "session.jsonl");
    expect(extractProjectHash(root, p)).toBe("abc123");
  });

  it("works for paths at depth > 2 too — first segment after root", () => {
    const p = path.join(root, "abc123", "sub", "session.jsonl");
    expect(extractProjectHash(root, p)).toBe("abc123");
  });

  it("returns null when the path is not under the root", () => {
    const p = path.resolve("/Users/john/elsewhere/some.jsonl");
    expect(extractProjectHash(root, p)).toBeNull();
  });

  it("returns null when the path IS the root itself", () => {
    expect(extractProjectHash(root, root)).toBeNull();
  });

  it("returns null when the tail has fewer than 2 segments", () => {
    expect(extractProjectHash(root, path.join(root, "lonely-file"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// startWatcher
// ---------------------------------------------------------------------------

describe("startWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    watcherRegistry.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function getLastHandle(): MockWatcherHandle {
    const last = watcherRegistry[watcherRegistry.length - 1];
    if (!last) throw new Error("no watcher registered");
    return last;
  }

  it("subscribes to add / change / unlink / error events", () => {
    const root = path.resolve("/Users/john/.claude/projects");
    startWatcher(root, () => {});
    const handle = getLastHandle();
    expect(typeof handle.handlers.add).toBe("function");
    expect(typeof handle.handlers.change).toBe("function");
    expect(typeof handle.handlers.unlink).toBe("function");
    expect(typeof handle.handlers.error).toBe("function");
  });

  it("filters non-.jsonl events (no listener fire)", () => {
    const root = path.resolve("/Users/john/.claude/projects");
    const listener = vi.fn();
    startWatcher(root, listener);
    const handle = getLastHandle();

    (handle.handlers.add as FsHandler)(path.join(root, "abc", "notes.txt"));
    vi.advanceTimersByTime(500);
    expect(listener).not.toHaveBeenCalled();
  });

  it("debounces per-hash for 300ms — only one fire for two rapid events", () => {
    const root = path.resolve("/Users/john/.claude/projects");
    const listener = vi.fn();
    startWatcher(root, listener);
    const handle = getLastHandle();

    (handle.handlers.change as FsHandler)(path.join(root, "hash1", "s1.jsonl"));
    vi.advanceTimersByTime(100);
    (handle.handlers.change as FsHandler)(path.join(root, "hash1", "s2.jsonl"));
    vi.advanceTimersByTime(299);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      projectHash: "hash1",
      reason: "session-updated",
    });
  });

  it("debounces are independent per hash", () => {
    const root = path.resolve("/Users/john/.claude/projects");
    const listener = vi.fn();
    startWatcher(root, listener);
    const handle = getLastHandle();

    (handle.handlers.add as FsHandler)(path.join(root, "hashA", "s.jsonl"));
    (handle.handlers.change as FsHandler)(path.join(root, "hashB", "s.jsonl"));
    vi.advanceTimersByTime(301);
    expect(listener).toHaveBeenCalledTimes(2);
    const hashes = listener.mock.calls.map((call) => call[0].projectHash);
    expect(hashes.sort()).toEqual(["hashA", "hashB"]);
  });

  it("translates event names: add → session-added, change → session-updated, unlink → session-removed", () => {
    const root = path.resolve("/Users/john/.claude/projects");
    const listener = vi.fn();
    startWatcher(root, listener);
    const handle = getLastHandle();

    (handle.handlers.add as FsHandler)(path.join(root, "h1", "s.jsonl"));
    vi.advanceTimersByTime(301);
    expect(listener.mock.calls[0]![0].reason).toBe("session-added");

    (handle.handlers.unlink as FsHandler)(path.join(root, "h2", "s.jsonl"));
    vi.advanceTimersByTime(301);
    expect(listener.mock.calls[1]![0].reason).toBe("session-removed");

    (handle.handlers.change as FsHandler)(path.join(root, "h3", "s.jsonl"));
    vi.advanceTimersByTime(301);
    expect(listener.mock.calls[2]![0].reason).toBe("session-updated");
  });

  it("session-removed wins when it collapses with prior events in the debounce window", () => {
    const root = path.resolve("/Users/john/.claude/projects");
    const listener = vi.fn();
    startWatcher(root, listener);
    const handle = getLastHandle();

    (handle.handlers.add as FsHandler)(path.join(root, "hashX", "s.jsonl"));
    (handle.handlers.unlink as FsHandler)(path.join(root, "hashX", "s.jsonl"));
    vi.advanceTimersByTime(301);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].reason).toBe("session-removed");
  });

  it("close() clears pending timers and calls watcher.close()", async () => {
    const root = path.resolve("/Users/john/.claude/projects");
    const listener = vi.fn();
    const handle = startWatcher(root, listener);
    const captured = getLastHandle();
    (captured.handlers.change as FsHandler)(path.join(root, "h", "s.jsonl"));

    await handle.close();
    vi.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled();
    expect(captured.closeMock).toHaveBeenCalledTimes(1);
  });

  it("ignores fs events whose path is outside the projects root", () => {
    const root = path.resolve("/Users/john/.claude/projects");
    const listener = vi.fn();
    startWatcher(root, listener);
    const handle = getLastHandle();
    (handle.handlers.change as FsHandler)(
      path.resolve("/Users/john/.claude/elsewhere/s.jsonl"),
    );
    vi.advanceTimersByTime(500);
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores fs events with too-shallow paths (file directly under root)", () => {
    const root = path.resolve("/Users/john/.claude/projects");
    const listener = vi.fn();
    startWatcher(root, listener);
    const handle = getLastHandle();
    (handle.handlers.change as FsHandler)(path.join(root, "stray.jsonl"));
    vi.advanceTimersByTime(500);
    expect(listener).not.toHaveBeenCalled();
  });
});
