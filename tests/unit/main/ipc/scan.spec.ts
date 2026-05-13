/**
 * Phase 1 Unit Test — main-process `scan:*` IPC handlers.
 *
 * Tests `handleScanStart`, `handleScanStatus`, `handleScanCancel`
 * against a fully mocked `scanService`. The push-style
 * `scan:on:progress` event subscription is owned by `src/main/index.ts`
 * and tested via the Playwright E2E.
 *
 * Owner: qe-agent (Phase 1).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@main/services/scan", () => ({
  scanService: {
    start: vi.fn(),
    status: vi.fn(),
    cancel: vi.fn(),
  },
}));

import { scanService } from "@main/services/scan";
import {
  handleScanStart,
  handleScanStatus,
  handleScanCancel,
} from "@main/ipc/scan";

const startedAt = "2026-05-13T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleScanStart", () => {
  it("delegates an empty input to scanService.start", async () => {
    vi.mocked(scanService.start).mockResolvedValue({
      jobId: "job-1",
      status: "running",
      startedAt,
    });

    const out = await handleScanStart({});
    expect(scanService.start).toHaveBeenCalledWith({});
    expect(out).toEqual({ jobId: "job-1", status: "running", startedAt });
  });

  it("forwards an explicit path override", async () => {
    vi.mocked(scanService.start).mockResolvedValue({
      jobId: "job-2",
      status: "running",
      startedAt,
    });

    await handleScanStart({ paths: ["/Users/foo/Projects"] });
    expect(scanService.start).toHaveBeenCalledWith({
      paths: ["/Users/foo/Projects"],
    });
  });

  it("rejects an empty-string path entry", async () => {
    await expect(handleScanStart({ paths: [""] })).rejects.toThrow();
    expect(scanService.start).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a result that violates the schema (status≠running)", async () => {
    vi.mocked(scanService.start).mockResolvedValue({
      jobId: "x",
      // @ts-expect-error - intentionally bad
      status: "done",
      startedAt,
    });
    await expect(handleScanStart({})).rejects.toThrow();
  });
});

describe("handleScanStatus", () => {
  it("forwards jobId and returns the running status", async () => {
    vi.mocked(scanService.status).mockResolvedValue({
      jobId: "job-1",
      status: "running",
      processed: 3,
      total: 10,
      startedAt,
      endedAt: null,
      errorMessage: null,
    });

    const out = await handleScanStatus({ jobId: "job-1" });
    expect(scanService.status).toHaveBeenCalledWith("job-1");
    expect(out.status).toBe("running");
    expect(out.processed).toBe(3);
  });

  it("handles the unknown-job sentinel", async () => {
    vi.mocked(scanService.status).mockResolvedValue({
      jobId: "ghost",
      status: "unknown",
      processed: 0,
      total: 0,
      startedAt: new Date(0).toISOString(),
      endedAt: null,
      errorMessage: null,
    });

    const out = await handleScanStatus({ jobId: "ghost" });
    expect(out.status).toBe("unknown");
  });

  it("rejects an empty jobId", async () => {
    await expect(handleScanStatus({ jobId: "" })).rejects.toThrow();
    expect(scanService.status).not.toHaveBeenCalled();
  });
});

describe("handleScanCancel", () => {
  it("returns cancelled=true when the service cancelled a running job", async () => {
    vi.mocked(scanService.cancel).mockResolvedValue({
      jobId: "job-1",
      cancelled: true,
    });
    const out = await handleScanCancel({ jobId: "job-1" });
    expect(scanService.cancel).toHaveBeenCalledWith("job-1");
    expect(out.cancelled).toBe(true);
  });

  it("returns cancelled=false when the job was not running", async () => {
    vi.mocked(scanService.cancel).mockResolvedValue({
      jobId: "x",
      cancelled: false,
    });
    const out = await handleScanCancel({ jobId: "x" });
    expect(out.cancelled).toBe(false);
  });

  it("rejects an empty jobId", async () => {
    await expect(handleScanCancel({ jobId: "" })).rejects.toThrow();
    expect(scanService.cancel).not.toHaveBeenCalled();
  });
});
