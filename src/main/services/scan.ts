/**
 * Scan orchestrator.
 *
 * Owns the worker thread lifecycle, the `scan:on:progress` event stream,
 * and the single-job-at-a-time invariant from `contracts/ipc.v1.md`:
 *
 *   > `scan:start` is NOT idempotent. Implementers SHOULD reject overlapping
 *   > scans with a 409-shaped error.
 *
 * The IPC handler subscribes to `scanService.events` for `"progress"`
 * (the canonical subscription lives in `src/main/index.ts` per Phase 1
 * wiring) and forwards each `ScanEvent` to every renderer window via
 * `webContents.send(IPC.SCAN.ON_PROGRESS, event)`.
 */

import { EventEmitter } from "node:events";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type {
  CancelScanResult,
  Repo,
  ScanEvent,
  ScanStatusResult,
  StartScanInput,
  StartScanResult,
} from "@shared/types";

import { rowToRepo, upsertRepo, type UpsertRepoInput } from "@main/db/queries";

import { indexRepoEmbedding } from "./embedding";
import { getSettings } from "./settings";
import { inferTags } from "./tag";

// ---------------------------------------------------------------------------
// Worker event envelope (matches the union emitted by scanner.worker.ts)
// ---------------------------------------------------------------------------

interface WorkerDiscovered {
  kind: "discovered";
  fullPath: string;
  slugHint: string;
  metadata: {
    name: string;
    remoteUrl: string | null;
    defaultBranch: string | null;
    currentBranch: string | null;
    lastCommitHash: string | null;
    lastCommitDate: string | null;
    lastCommitMsg: string | null;
    isDirty: boolean;
    sizeBytes: number | null;
    primaryLanguage: string | null;
    languages: Array<{ name: string; bytes: number; color: string }>;
    readmeContent: string | null;
    readmeHash: string | null;
    description: string | null;
  };
}

type WorkerEvent =
  | { kind: "progress"; processed: number; total: number; currentPath: string }
  | WorkerDiscovered
  | { kind: "done"; totalRepos: number; durationMs: number }
  | { kind: "error"; message: string; path: string | null };

// ---------------------------------------------------------------------------
// Job state
// ---------------------------------------------------------------------------

interface ScanJob {
  jobId: string;
  status: "running" | "done" | "error" | "cancelled";
  startedAt: string;
  endedAt: string | null;
  processed: number;
  total: number;
  errorMessage: string | null;
  worker: Worker | null;
}

export class ScanInProgressError extends Error {
  constructor(public readonly jobId: string) {
    super(`scan already in progress: ${jobId}`);
    this.name = "ScanInProgressError";
  }
}

// ---------------------------------------------------------------------------
// Worker path resolution
// ---------------------------------------------------------------------------

function resolveWorkerPath(): string {
  // In production the worker is bundled alongside the main entry under
  // `out/main/workers/scanner.worker.js`. In dev electron-vite emits the
  // same layout into the dev-server's main bundle directory.
  //
  // `import.meta.url` resolves to wherever this module was loaded from,
  // which is exactly that `out/main/` directory.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "workers", "scanner.worker.js");
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class ScanService {
  /** Public event channel — IPC handler subscribes via `.events.on("progress", cb)`. */
  readonly events: EventEmitter = new EventEmitter();

  private activeJob: ScanJob | null = null;
  private recentJobs: Map<string, ScanJob> = new Map();

  /** No-op for Phase 1. Phase 4 may resume an unfinished job here. */
  async boot(): Promise<void> {
    // intentional no-op
  }

  start(input: StartScanInput): Promise<StartScanResult> {
    if (this.activeJob && this.activeJob.status === "running") {
      return Promise.reject(new ScanInProgressError(this.activeJob.jobId));
    }

    const settings = getSettings();
    const paths =
      input.paths && input.paths.length > 0 ? input.paths : settings.scanPaths;
    const ignorePaths = this.readIgnorePaths();

    const jobId = randomUUID();
    const startedAt = new Date().toISOString();
    const job: ScanJob = {
      jobId,
      status: "running",
      startedAt,
      endedAt: null,
      processed: 0,
      total: 0,
      errorMessage: null,
      worker: null,
    };
    this.activeJob = job;
    this.recentJobs.set(jobId, job);

    const workerPath = resolveWorkerPath();
    const worker = new Worker(workerPath, {
      workerData: { paths, ignorePaths },
    });
    job.worker = worker;

    worker.on("message", (msg: WorkerEvent) => {
      this.handleWorkerMessage(job, msg);
    });
    worker.on("error", (err) => {
      job.status = "error";
      job.errorMessage = err instanceof Error ? err.message : String(err);
      this.emitEvent({
        kind: "error",
        message: job.errorMessage,
        path: null,
      });
      this.finalize(job);
    });
    worker.on("exit", (code) => {
      if (job.status === "running") {
        if (code !== 0) {
          job.status = "error";
          job.errorMessage = `worker exited with code ${code}`;
          this.emitEvent({
            kind: "error",
            message: job.errorMessage,
            path: null,
          });
        } else {
          job.status = "done";
        }
        this.finalize(job);
      }
    });

    return Promise.resolve({ jobId, status: "running", startedAt });
  }

  async cancel(jobId: string): Promise<CancelScanResult> {
    const job = this.recentJobs.get(jobId);
    if (!job) return { jobId, cancelled: false };
    if (job.status !== "running") return { jobId, cancelled: false };

    if (job.worker) {
      try {
        job.worker.postMessage({ type: "cancel" });
      } catch {
        /* worker may already be torn down */
      }
    }
    job.status = "cancelled";
    this.finalize(job);
    return { jobId, cancelled: true };
  }

  async status(jobId: string): Promise<ScanStatusResult> {
    const job = this.recentJobs.get(jobId);
    if (!job) {
      return {
        jobId,
        status: "unknown",
        processed: 0,
        total: 0,
        startedAt: new Date(0).toISOString(),
        endedAt: null,
        errorMessage: null,
      };
    }
    return {
      jobId: job.jobId,
      status: job.status,
      processed: job.processed,
      total: job.total,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      errorMessage: job.errorMessage,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private readIgnorePaths(): string[] {
    // For now the ignore list comes from settings (Phase 2 will add a richer
    // UI). The data-layer contract does not yet ship an explicit field; we
    // read `ignorePaths` off the Settings blob defensively in case a future
    // settings revision adds it.
    const settings = getSettings() as unknown as { ignorePaths?: string[] };
    return Array.isArray(settings.ignorePaths) ? settings.ignorePaths : [];
  }

  private handleWorkerMessage(job: ScanJob, msg: WorkerEvent): void {
    switch (msg.kind) {
      case "progress": {
        job.processed = msg.processed;
        job.total = msg.total;
        this.emitEvent({
          kind: "progress",
          processed: msg.processed,
          total: msg.total,
          currentPath: msg.currentPath,
        });
        break;
      }
      case "discovered": {
        // Main-thread DB write — keeps the worker SQLite-free.
        try {
          const heuristicTags = inferTags({
            fullPath: msg.fullPath,
            languages: msg.metadata.languages,
            readmeContent: msg.metadata.readmeContent,
          });
          const input: UpsertRepoInput = {
            slug: msg.slugHint,
            name: msg.metadata.name,
            fullPath: msg.fullPath,
            remoteUrl: msg.metadata.remoteUrl,
            defaultBranch: msg.metadata.defaultBranch,
            currentBranch: msg.metadata.currentBranch,
            lastCommitHash: msg.metadata.lastCommitHash,
            lastCommitDate: msg.metadata.lastCommitDate,
            lastCommitMsg: msg.metadata.lastCommitMsg,
            isDirty: msg.metadata.isDirty,
            primaryLanguage: msg.metadata.primaryLanguage,
            languages: msg.metadata.languages,
            heuristicTags,
            description: msg.metadata.description,
            readmeContent: msg.metadata.readmeContent,
            readmeHash: msg.metadata.readmeHash,
            sizeBytes: msg.metadata.sizeBytes,
          };
          const { row } = upsertRepo(input);
          const repo: Repo = rowToRepo(row);
          this.emitEvent({ kind: "repo", repo });

          // ATR-018: wire the embedding write-path. Fire-and-forget so a slow
          // or unreachable embedding provider never blocks the scan. The repo
          // is already FTS-indexed via the upsert above; the vector index is a
          // best-effort, content-hash-gated enrichment that degrades to a no-op
          // when Ollama/OpenAI is down. `indexRepoEmbedding` never throws, but
          // the extra `.catch` guards against any unforeseen rejection.
          void indexRepoEmbedding({
            repoId: row.id,
            slug: row.slug,
            name: row.name,
            description: row.description,
            readmeContent: msg.metadata.readmeContent,
          }).catch((err) => {
            console.error("[backend] embedding index error", err);
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.emitEvent({ kind: "error", message, path: msg.fullPath });
        }
        break;
      }
      case "done": {
        job.status = "done";
        job.total = msg.totalRepos;
        this.emitEvent({
          kind: "done",
          totalRepos: msg.totalRepos,
          durationMs: msg.durationMs,
        });
        this.finalize(job);
        break;
      }
      case "error": {
        // Per-path error from the worker — non-fatal, the scan keeps going.
        this.emitEvent({
          kind: "error",
          message: msg.message,
          path: msg.path,
        });
        break;
      }
    }
  }

  private emitEvent(ev: ScanEvent): void {
    // Phase 1 contract: payload omits jobId (one job at a time). The IPC
    // handler in `src/main/index.ts` listens on `"progress"` and forwards
    // the event to every BrowserWindow.
    this.events.emit("progress", ev);
  }

  private finalize(job: ScanJob): void {
    if (job.endedAt) return;
    job.endedAt = new Date().toISOString();
    if (this.activeJob && this.activeJob.jobId === job.jobId) {
      this.activeJob = null;
    }
    if (job.worker) {
      job.worker.terminate().catch(() => {
        /* ignore */
      });
      job.worker = null;
    }
  }
}

export const scanService: ScanService = new ScanService();
