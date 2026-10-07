/**
 * Phase 3a Unit Test — main-process `process:*` IPC handlers.
 *
 * Each handler:
 *   1. Zod-parses raw input via the schema.
 *   2. Dispatches to the mocked `processService`.
 *   3. Zod-parses the result before returning.
 *
 * We test the pure `handle*` functions directly (same pattern as
 * `scan.spec.ts` / `catalog.spec.ts`). The `assertRendererFrame` gate
 * is wrapped around these by `registerProcessHandlers` — covered by
 * `tests/unit/main/system/protocol.spec.ts` + the Playwright E2E.
 *
 * Owner: qe-agent (Phase 3a).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@main/services/process", () => ({
  processService: {
    list: vi.fn(),
    listForRepo: vi.fn(),
    refresh: vi.fn(),
    kill: vi.fn(),
    boot: vi.fn(),
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  },
}));

import { processService } from "@main/services/process";
import {
  handleProcessList,
  handleProcessListForRepo,
  handleProcessRefresh,
  handleProcessKill,
} from "@main/ipc/process";

const fixtureRow = {
  pid: 1234,
  ppid: 1,
  command: "node",
  commandLine: "node server.js",
  port: 3000,
  protocol: "tcp" as const,
  cwd: "/Users/me/Projects/foo",
  repoSlug: "foo",
  firstSeenAt: 1_700_000_000_000,
  observedAt: 1_700_000_001_000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// handleProcessList
// ---------------------------------------------------------------------------

describe("handleProcessList", () => {
  it("dispatches to processService.list and returns the snapshot", async () => {
    vi.mocked(processService.list).mockResolvedValue({
      processes: [fixtureRow],
      snapshotAt: 1_700_000_001_000,
    });
    const out = await handleProcessList({});
    expect(processService.list).toHaveBeenCalledTimes(1);
    expect(out.processes).toHaveLength(1);
    expect(out.processes[0]!.pid).toBe(1234);
    expect(out.snapshotAt).toBe(1_700_000_001_000);
  });

  it("tolerates a null payload by defaulting to {}", async () => {
    vi.mocked(processService.list).mockResolvedValue({
      processes: [],
      snapshotAt: 0,
    });
    const out = await handleProcessList(null);
    expect(processService.list).toHaveBeenCalledTimes(1);
    expect(out.processes).toEqual([]);
  });

  it("rejects extra keys via the strict schema", async () => {
    await expect(handleProcessList({ wat: 1 })).rejects.toThrow();
    expect(processService.list).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a result that violates the schema", async () => {
    vi.mocked(processService.list).mockResolvedValue({
      processes: [{ ...fixtureRow, pid: -1 }],
      snapshotAt: 0,
    } as unknown as Awaited<ReturnType<typeof processService.list>>);
    await expect(handleProcessList({})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleProcessListForRepo
// ---------------------------------------------------------------------------

describe("handleProcessListForRepo", () => {
  it("forwards the slug and returns the scoped snapshot", async () => {
    vi.mocked(processService.listForRepo).mockResolvedValue({
      processes: [fixtureRow],
      snapshotAt: 1,
    });
    const out = await handleProcessListForRepo({ slug: "foo" });
    expect(processService.listForRepo).toHaveBeenCalledWith("foo");
    expect(out.processes).toHaveLength(1);
  });

  it("rejects an empty slug", async () => {
    await expect(handleProcessListForRepo({ slug: "" })).rejects.toThrow();
    expect(processService.listForRepo).not.toHaveBeenCalled();
  });

  it("rejects a missing slug", async () => {
    await expect(handleProcessListForRepo({})).rejects.toThrow();
    expect(processService.listForRepo).not.toHaveBeenCalled();
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(
      handleProcessListForRepo({ slug: "foo", wat: 1 }),
    ).rejects.toThrow();
    expect(processService.listForRepo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleProcessRefresh
// ---------------------------------------------------------------------------

describe("handleProcessRefresh", () => {
  it("sweeps via processService.refresh and returns the fresh snapshot", async () => {
    vi.mocked(processService.refresh).mockResolvedValue({
      processes: [fixtureRow],
      snapshotAt: 1_700_000_002_000,
    });
    const out = await handleProcessRefresh({});
    expect(processService.refresh).toHaveBeenCalledTimes(1);
    expect(out.processes[0]!.repoSlug).toBe("foo");
    expect(out.snapshotAt).toBe(1_700_000_002_000);
  });

  it("tolerates a null payload by defaulting to {}", async () => {
    vi.mocked(processService.refresh).mockResolvedValue({
      processes: [],
      snapshotAt: 0,
    });
    const out = await handleProcessRefresh(null);
    expect(processService.refresh).toHaveBeenCalledTimes(1);
    expect(out.processes).toEqual([]);
  });

  it("rejects extra keys before any sweep runs", async () => {
    await expect(handleProcessRefresh({ wat: 1 })).rejects.toThrow();
    expect(processService.refresh).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a result that violates the schema", async () => {
    vi.mocked(processService.refresh).mockResolvedValue({
      processes: [{ ...fixtureRow, port: 70000 }],
      snapshotAt: 0,
    } as unknown as Awaited<ReturnType<typeof processService.refresh>>);
    await expect(handleProcessRefresh({})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleProcessKill
// ---------------------------------------------------------------------------

describe("handleProcessKill", () => {
  it("forwards { pid } to processService.kill and returns its result", async () => {
    vi.mocked(processService.kill).mockResolvedValue({
      pid: 1234,
      finalSignal: "SIGINT",
      stopped: true,
      durationMs: 12,
    });
    const out = await handleProcessKill({ pid: 1234 });
    expect(processService.kill).toHaveBeenCalledWith({ pid: 1234 });
    expect(out.stopped).toBe(true);
    expect(out.finalSignal).toBe("SIGINT");
  });

  it("forwards escalateMs when provided", async () => {
    vi.mocked(processService.kill).mockResolvedValue({
      pid: 1234,
      finalSignal: "SIGTERM",
      stopped: true,
      durationMs: 12,
    });
    await handleProcessKill({ pid: 1234, escalateMs: 5000 });
    expect(processService.kill).toHaveBeenCalledWith({
      pid: 1234,
      escalateMs: 5000,
    });
  });

  it("returns the noop signal for an already-dead PID", async () => {
    vi.mocked(processService.kill).mockResolvedValue({
      pid: 1234,
      finalSignal: "noop",
      stopped: true,
      durationMs: 0,
    });
    const out = await handleProcessKill({ pid: 1234 });
    expect(out.finalSignal).toBe("noop");
  });

  it("rejects pid=0 (positive integer required)", async () => {
    await expect(handleProcessKill({ pid: 0 })).rejects.toThrow();
    expect(processService.kill).not.toHaveBeenCalled();
  });

  it("rejects a negative pid", async () => {
    await expect(handleProcessKill({ pid: -1 })).rejects.toThrow();
    expect(processService.kill).not.toHaveBeenCalled();
  });

  it("rejects escalateMs below 100ms minimum", async () => {
    await expect(
      handleProcessKill({ pid: 1, escalateMs: 50 }),
    ).rejects.toThrow();
    expect(processService.kill).not.toHaveBeenCalled();
  });

  it("rejects extra keys (strict schema)", async () => {
    await expect(handleProcessKill({ pid: 1, wat: true })).rejects.toThrow();
    expect(processService.kill).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a result that violates the schema", async () => {
    vi.mocked(processService.kill).mockResolvedValue({
      pid: 1,
      finalSignal: "SIGUSR1",
      stopped: true,
      durationMs: 0,
    } as unknown as Awaited<ReturnType<typeof processService.kill>>);
    await expect(handleProcessKill({ pid: 1 })).rejects.toThrow();
  });
});
