/**
 * ATR-018 Unit Test — scan path wires the embedding write-path WITHOUT
 * blocking or failing the scan (FTS indexing is unaffected when Ollama is DOWN).
 *
 * Native-free: `node:worker_threads` is mocked so no real worker/scanner native
 * module loads; `@main/db/queries` (better-sqlite3), `./tag`, `./settings`, and
 * `./embedding` are all stubbed. We capture the worker `message` handler that
 * `scanService.start()` installs, feed it a synthetic `discovered` event, and
 * assert:
 *   - the repo is upserted (the FTS index path — the scan's primary effect) and
 *     a `repo` scan event is emitted;
 *   - `indexRepoEmbedding` is invoked with the upserted row's id/slug/name/
 *     description + the worker-provided full readme content;
 *   - when `indexRepoEmbedding` REJECTS (defensive — it normally never throws),
 *     the `discovered` handler still completed and emitted the `repo` event,
 *     i.e. embedding failure does not break the scan / FTS.
 *
 * Owner: Lane A.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EventEmitter as NodeEventEmitter } from "node:events";

// --- Worker mock -----------------------------------------------------------
// Capture the most-recently-constructed fake worker so the test can invoke the
// `message` listener `ScanService` registers. `vi.hoisted` lets the class be
// referenced inside the (hoisted) `vi.mock` factory below. We `require`
// EventEmitter INSIDE the factory because ESM import bindings are not yet
// initialized when the hoisted block runs.
const { FakeWorker } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } =
    require("node:events") as typeof import("node:events");
  class FakeWorker extends EventEmitter {
    static last: (NodeEventEmitter & { send(msg: unknown): void }) | null =
      null;
    postMessage = vi.fn();
    terminate = vi.fn().mockResolvedValue(0);
    constructor() {
      super();
      FakeWorker.last = this as unknown as NodeEventEmitter & {
        send(msg: unknown): void;
      };
    }
    /** Drive a worker → main message through the registered listener(s). */
    send(msg: unknown) {
      (this as unknown as NodeEventEmitter).emit("message", msg);
    }
  }
  return { FakeWorker };
});

vi.mock("node:worker_threads", () => ({
  Worker: FakeWorker,
}));

// --- DB / tag / settings / embedding mocks ---------------------------------
const upsertRepo = vi.fn();
const rowToRepo = vi.fn((row: { slug: string }) => ({ slug: row.slug }));

vi.mock("@main/db/queries", () => ({
  upsertRepo: (input: unknown) => upsertRepo(input),
  rowToRepo: (row: unknown) => rowToRepo(row as { slug: string }),
}));

vi.mock("@main/services/tag", () => ({
  inferTags: () => [{ value: "node", source: "heuristic" }],
}));

vi.mock("@main/services/settings", () => ({
  getSettings: () => ({
    scanPaths: ["/tmp/repos"],
    ollamaBaseUrl: "http://localhost:11434",
    ollamaEmbedModel: "nomic-embed-text",
    openaiEmbedModel: null,
    defaultEditor: "none",
    schemaVersion: 1,
  }),
}));

const indexRepoEmbedding = vi.fn();
vi.mock("@main/services/embedding", () => ({
  indexRepoEmbedding: (repo: unknown) => indexRepoEmbedding(repo),
}));

import { scanService } from "@main/services/scan";
import type { ScanEvent } from "@shared/types";

const UPSERTED_ROW = {
  id: 7,
  slug: "acme-tool",
  name: "Acme Tool",
  description: "A handy tool",
  // readme_content on the DB row would be the full readme; the scan path passes
  // the worker's `metadata.readmeContent` to the embedder explicitly.
  readmeContent: "stored readme",
};

const DISCOVERED = {
  kind: "discovered" as const,
  fullPath: "/tmp/repos/acme-tool",
  slugHint: "acme-tool",
  metadata: {
    name: "Acme Tool",
    remoteUrl: null,
    defaultBranch: "main",
    currentBranch: "main",
    lastCommitHash: null,
    lastCommitDate: null,
    lastCommitMsg: null,
    isDirty: false,
    sizeBytes: 1234,
    primaryLanguage: "TypeScript",
    languages: [{ name: "TypeScript", bytes: 1000, color: "#3178c6" }],
    readmeContent: "# Acme Tool\n\nfresh readme from disk",
    readmeHash: "abc123",
    description: "A handy tool",
  },
};

function captureRepoEvents(): ScanEvent[] {
  const events: ScanEvent[] = [];
  scanService.events.on("progress", (ev: ScanEvent) => events.push(ev));
  return events;
}

describe("scan path → embedding wiring (ATR-018)", () => {
  let activeJobId: string | null = null;

  beforeEach(() => {
    upsertRepo
      .mockReset()
      .mockReturnValue({ row: UPSERTED_ROW, created: true });
    rowToRepo.mockClear();
    indexRepoEmbedding.mockReset().mockResolvedValue("embedded");
    scanService.events.removeAllListeners("progress");
    FakeWorker.last = null;
    activeJobId = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    // Release the single-job-at-a-time lock so the next test can `start()`.
    if (activeJobId) await scanService.cancel(activeJobId);
    vi.restoreAllMocks();
  });

  it("upserts the repo, emits a `repo` event, and invokes indexRepoEmbedding with the right shape", async () => {
    const events = captureRepoEvents();

    const { jobId } = await scanService.start({ paths: ["/tmp/repos"] });
    activeJobId = jobId;
    const worker = FakeWorker.last!;
    expect(worker).toBeTruthy();

    worker.send(DISCOVERED);
    // Let the fire-and-forget embedding microtask settle.
    await Promise.resolve();
    await Promise.resolve();

    // FTS path: the repo was upserted and a `repo` event emitted.
    expect(upsertRepo).toHaveBeenCalledTimes(1);
    const repoEvent = events.find((e) => e.kind === "repo");
    expect(repoEvent).toBeTruthy();

    // Embedding path: called with the upserted row's id/slug/name/description
    // and the worker's freshly-read full readme content.
    expect(indexRepoEmbedding).toHaveBeenCalledTimes(1);
    expect(indexRepoEmbedding).toHaveBeenCalledWith({
      repoId: 7,
      slug: "acme-tool",
      name: "Acme Tool",
      description: "A handy tool",
      readmeContent: "# Acme Tool\n\nfresh readme from disk",
    });
  });

  it("does NOT fail the scan when indexRepoEmbedding rejects (embedding DOWN)", async () => {
    indexRepoEmbedding.mockRejectedValue(new Error("unexpected embed failure"));
    const events = captureRepoEvents();

    const { jobId } = await scanService.start({ paths: ["/tmp/repos"] });
    activeJobId = jobId;
    const worker = FakeWorker.last!;

    // The synchronous `discovered` handling must not throw even though the
    // (fire-and-forget) embedding promise rejects.
    expect(() => worker.send(DISCOVERED)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    // The repo was still indexed (upsert + repo event) — FTS unaffected.
    expect(upsertRepo).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.kind === "repo")).toBe(true);
    // No error scan-event was emitted for the discovered repo.
    expect(events.some((e) => e.kind === "error")).toBe(false);
  });
});
