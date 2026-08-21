/**
 * ProcessService — lsof-based listening-port poller + repo binding.
 *
 * Owns the in-memory process snapshot exposed via `IPC.PROCESS.*`. The
 * snapshot is rebuilt from `lsof -nP -iTCP -sTCP:LISTEN -F pcnTL` on a
 * cadence-driven interval (3000ms focused / 15000ms blurred / paused
 * after 60s with no `process:list` consumer activity). Repo binding is
 * done by looking up each PID's cwd (via `lsof -p <pid> -F n -d cwd`)
 * in a prefix trie built from the catalog's `repos.full_path` column,
 * with a fallback walk up the ppid chain (cap 10 hops).
 *
 * The kill state machine is SIGINT -> SIGTERM -> SIGKILL with
 * `escalateMs` between each step (default 3000ms; 1000ms grace after
 * SIGKILL). Polling between escalation steps reuses `ps -p <pid>` for
 * existence and the cached snapshot for listening-state.
 *
 * The service emits `"update"` on its `events: EventEmitter` whenever
 * the snapshot's `(pid, port, repoSlug)` triple-set changes. The
 * subscription is hung in `src/main/index.ts` per the Phase 3a wiring.
 *
 * SECURITY NOTE: this module uses `execFile` (NEVER `exec`) with a
 * literal argv array. The only dynamic arguments are PIDs that have
 * already been Zod-validated as positive integers in the IPC layer.
 */

import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  KillProcessInput,
  KillProcessResult,
  ListProcessesResult,
  ProcessInfo,
  ProcessUpdateEvent,
} from "@shared/types";

import { getSqlite } from "@main/db/client";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FOCUSED_INTERVAL_MS = 3000;
const BLURRED_INTERVAL_MS = 15000;
const IDLE_PAUSE_MS = 60_000;
const PPID_WALK_HOPS = 10;
const KILL_ESCALATE_DEFAULT_MS = 3000;
const KILL_FINAL_GRACE_MS = 1000;
const LSOF_TIMEOUT_MS = 1000;

// ---------------------------------------------------------------------------
// lsof parsers
// ---------------------------------------------------------------------------

/**
 * One listening-socket row produced by `parseLsofListen`. A single PID
 * can produce multiple rows (one per `n` field in the lsof output).
 *
 * Exported for unit testing.
 */
export interface LsofListenRow {
  pid: number;
  command: string;
  port: number;
  // Host portion of "n" (e.g. "*", "127.0.0.1", "[::1]"). Informational.
  host: string;
}

/**
 * Parse `lsof -nP -iTCP -sTCP:LISTEN -F pcnTL` field-prefixed output.
 *
 * The "-F" format prints one field per line, each prefixed by a single
 * character identifying the field. A "p" line starts a new PID block;
 * subsequent lines (c=command, L=login user, n=name "host:port", T=tcp
 * state extras) belong to the most-recent PID until the next "p" line.
 *
 * Exported for unit testing.
 */
export function parseLsofListen(output: string): LsofListenRow[] {
  const rows: LsofListenRow[] = [];
  let cur: {
    pid?: number;
    command?: string;
    ports?: number[];
    hosts?: string[];
  } = {};

  const flush = (): void => {
    if (cur.pid == null) return;
    const ports = cur.ports ?? [];
    const hosts = cur.hosts ?? [];
    for (let i = 0; i < ports.length; i++) {
      rows.push({
        pid: cur.pid,
        command: cur.command ?? "",
        port: ports[i]!,
        host: hosts[i] ?? "",
      });
    }
  };

  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    const prefix = line.charCodeAt(0);
    const value = line.slice(1);
    // "p" — start of a new PID block. Flush prior block first.
    if (prefix === 0x70 /* p */) {
      flush();
      const pid = Number.parseInt(value, 10);
      cur = Number.isFinite(pid) && pid > 0 ? { pid } : {};
      continue;
    }
    if (cur.pid == null) continue;
    if (prefix === 0x63 /* c */) {
      cur.command = value;
    } else if (prefix === 0x6e /* n */) {
      // value is "host:port" possibly with IPv6 brackets or "*:3000".
      // Split on the LAST colon so "[::1]:3000" -> host "[::1]", port "3000".
      const lastColon = value.lastIndexOf(":");
      if (lastColon < 0) continue;
      const host = value.slice(0, lastColon);
      const portStr = value.slice(lastColon + 1);
      const port = Number.parseInt(portStr, 10);
      if (!Number.isFinite(port) || port <= 0 || port > 65535) continue;
      cur.ports = cur.ports ?? [];
      cur.hosts = cur.hosts ?? [];
      cur.ports.push(port);
      cur.hosts.push(host);
    }
    // T (extras) and L (login user) currently informational; ignored.
  }
  flush();
  return rows;
}

/**
 * Parse `lsof -p <pid> -F n -d cwd` output. There is at most one DIR
 * line; we extract the first "n" field.
 *
 * Exported for unit testing.
 */
export function parseLsofCwd(output: string): string | null {
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    if (line.charCodeAt(0) === 0x6e /* n */) {
      const value = line.slice(1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Path-prefix trie for cwd->repoSlug lookup
// ---------------------------------------------------------------------------

interface TrieNode {
  children: Map<string, TrieNode>;
  /** Slug stored at the node whose accumulated path IS a repo root. */
  slug: string | null;
}

/**
 * Trie keyed by absolute-path segments. `lookup(p)` returns the deepest
 * matching repo slug — so `/Users/j/Repos/foo` is preferred over `/Users/j`.
 *
 * Exported for unit testing.
 */
export class RepoPathTrie {
  private readonly root: TrieNode = { children: new Map(), slug: null };

  insert(absPath: string, slug: string): void {
    const parts = this.segments(absPath);
    let node = this.root;
    for (const part of parts) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map(), slug: null };
        node.children.set(part, child);
      }
      node = child;
    }
    node.slug = slug;
  }

  lookup(absPath: string): string | null {
    if (!absPath || absPath.length === 0) return null;
    const parts = this.segments(absPath);
    let node = this.root;
    let deepest: string | null = null;
    for (const part of parts) {
      const child = node.children.get(part);
      if (!child) break;
      node = child;
      if (node.slug) deepest = node.slug;
    }
    return deepest;
  }

  private segments(absPath: string): string[] {
    // Split on "/" — POSIX-only in 3a (Linux/Windows deferred per contract).
    return absPath.split("/").filter((s) => s.length > 0);
  }
}

// ---------------------------------------------------------------------------
// Electron `app` lazy accessor
// ---------------------------------------------------------------------------

/**
 * Lazy `app` getter: keeps the module importable from unit tests that
 * don't initialize Electron (mirrors `services/scan.ts`'s approach to
 * worker-context safety).
 */
function getElectronApp(): {
  isFocused?: () => boolean;
  on: (event: string, listener: () => void) => void;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("electron") as {
      app?: {
        isFocused?: () => boolean;
        on: (event: string, listener: () => void) => void;
      };
    };
    return mod.app ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

interface CachedSnapshot {
  processes: ProcessInfo[];
  snapshotAt: number;
  /** Sorted "pid|port|slug" triples — used for equality compare. */
  signature: string;
}

class ProcessService {
  /** Public event channel — main/index.ts subscribes via `.events.on("update", cb)`. */
  readonly events: EventEmitter = new EventEmitter();

  private trie: RepoPathTrie | null = null;
  private snapshot: CachedSnapshot = {
    processes: [],
    snapshotAt: 0,
    signature: "",
  };
  private firstSeenAt: Map<number, number> = new Map();
  private interval: NodeJS.Timeout | null = null;
  private isFocused = true;
  private lastConsumerAt = 0;
  private booted = false;
  private appWired = false;
  private tickInFlight = false;

  /**
   * Idempotent: build the catalog trie and prime the snapshot once.
   * Does NOT start the interval — that's triggered by `ensurePolling()`
   * from the IPC handler on the first `process:list` invocation.
   */
  async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    this.rebuildTrie();
    this.wireAppFocusEvents();
    // Prime an initial snapshot so `process:list` doesn't block on its
    // first call — but do NOT await it. The prime is an `lsof` sweep that
    // measured ~18s on a busy machine, and `boot()` is awaited before the
    // main window is created, so awaiting it delayed the first paint by
    // that entire amount (ATR-055). Nothing depends on the prime having
    // finished: `list()` already triggers its own tick when the snapshot
    // is still empty, so the worst case without priming is that the FIRST
    // `process:list` call pays for one tick instead of startup paying for
    // it. Errors are non-fatal — the next tick recovers.
    void this.tick().catch((err: unknown) => {
      console.error("[backend] processService.boot prime tick failed", err);
    });
  }

  /**
   * Returns the cached snapshot. Increments the consumer heartbeat and
   * ensures the poller is running. If we have no snapshot yet, triggers
   * a synchronous tick (capped by `LSOF_TIMEOUT_MS`).
   */
  async list(): Promise<ListProcessesResult> {
    this.lastConsumerAt = Date.now();
    this.ensurePolling();
    if (this.snapshot.snapshotAt === 0) {
      try {
        await this.tick();
      } catch (err) {
        console.error("[backend] processService.list initial tick failed", err);
      }
    }
    return {
      processes: this.snapshot.processes.slice(),
      snapshotAt: this.snapshot.snapshotAt,
    };
  }

  /**
   * Filters `list()` to rows whose `repoSlug === slug`. Returns an empty
   * array (NOT a 404) when no matches — per contract, "no dev server
   * for this repo" is the common case.
   */
  async listForRepo(slug: string): Promise<ListProcessesResult> {
    const full = await this.list();
    return {
      processes: full.processes.filter((p) => p.repoSlug === slug),
      snapshotAt: full.snapshotAt,
    };
  }

  /**
   * Kill state machine: SIGINT -> wait `escalateMs` -> SIGTERM ->
   * wait `escalateMs` -> SIGKILL -> wait `KILL_FINAL_GRACE_MS`. Returns
   * `noop` only when the pid wasn't alive at entry. ESRCH along the way
   * is treated as success. EACCES is rethrown to the handler.
   */
  async kill(input: KillProcessInput): Promise<KillProcessResult> {
    const start = Date.now();
    const escalateMs = input.escalateMs ?? KILL_ESCALATE_DEFAULT_MS;
    const pid = input.pid;

    // Existence check first — already-dead PID returns noop.
    if (!(await this.pidAlive(pid))) {
      return {
        pid,
        finalSignal: "noop",
        stopped: true,
        durationMs: Date.now() - start,
      };
    }

    const signals: Array<"SIGINT" | "SIGTERM" | "SIGKILL"> = [
      "SIGINT",
      "SIGTERM",
      "SIGKILL",
    ];
    let finalSignal: "SIGINT" | "SIGTERM" | "SIGKILL" = "SIGINT";

    for (let i = 0; i < signals.length; i++) {
      const sig = signals[i]!;
      finalSignal = sig;
      try {
        // globalThis `process.kill` — no Node import needed.
        process.kill(pid, sig);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ESRCH") {
          return {
            pid,
            finalSignal: sig,
            stopped: true,
            durationMs: Date.now() - start,
          };
        }
        // EACCES and others bubble to the IPC handler.
        throw err;
      }
      const waitMs = sig === "SIGKILL" ? KILL_FINAL_GRACE_MS : escalateMs;
      if (await this.waitForExit(pid, waitMs)) {
        return {
          pid,
          finalSignal: sig,
          stopped: true,
          durationMs: Date.now() - start,
        };
      }
    }

    // Three signals fired, still alive — last attempt was SIGKILL.
    return {
      pid,
      finalSignal,
      stopped: !(await this.pidAlive(pid)),
      durationMs: Date.now() - start,
    };
  }

  // -------------------------------------------------------------------------
  // Internals — polling lifecycle
  // -------------------------------------------------------------------------

  private wireAppFocusEvents(): void {
    if (this.appWired) return;
    const app = getElectronApp();
    if (!app) return;
    this.appWired = true;
    if (typeof app.isFocused === "function") {
      this.isFocused = app.isFocused();
    }
    app.on("browser-window-focus", () => {
      this.isFocused = true;
      if (this.interval) this.restartInterval();
    });
    app.on("browser-window-blur", () => {
      this.isFocused = false;
      if (this.interval) this.restartInterval();
    });
  }

  private ensurePolling(): void {
    if (this.interval) return;
    this.restartInterval();
  }

  private restartInterval(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    const ms = this.isFocused ? FOCUSED_INTERVAL_MS : BLURRED_INTERVAL_MS;
    this.interval = setInterval(() => {
      void this.maybeTick();
    }, ms);
    // Don't keep the event loop alive solely for this timer.
    this.interval.unref?.();
  }

  private async maybeTick(): Promise<void> {
    // Auto-pause when no consumer has called `list` recently.
    if (
      this.lastConsumerAt > 0 &&
      Date.now() - this.lastConsumerAt > IDLE_PAUSE_MS
    ) {
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      return;
    }
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      await this.tick();
    } catch (err) {
      console.error("[backend] processService tick failed", err);
    } finally {
      this.tickInFlight = false;
    }
  }

  // -------------------------------------------------------------------------
  // Internals — snapshot building
  // -------------------------------------------------------------------------

  private async tick(): Promise<void> {
    const observedAt = Date.now();
    const listenRows = await this.runLsofListen();

    // Lazy trie rebuild — no catalog events to listen to, so refresh once
    // per tick. Cost is one indexed SQLite SELECT.
    this.rebuildTrie();

    const next: ProcessInfo[] = [];
    const seenSig = new Set<string>();
    const nextFirstSeen = new Map<number, number>();

    for (const row of listenRows) {
      if (row.port <= 1024) continue; // skip privileged ports per §5.2 rule
      const ppid = await this.readPpid(row.pid);
      const cwd = await this.readCwd(row.pid);

      // Resolve repoSlug: trie hit on cwd first, then walk ppid chain.
      let repoSlug: string | null = cwd
        ? (this.trie?.lookup(cwd) ?? null)
        : null;
      if (!repoSlug) {
        let ancestor = ppid;
        for (let hop = 0; hop < PPID_WALK_HOPS && ancestor > 1; hop++) {
          const ancestorCwd = await this.readCwd(ancestor);
          if (ancestorCwd) {
            const hit = this.trie?.lookup(ancestorCwd) ?? null;
            if (hit) {
              repoSlug = hit;
              break;
            }
          }
          const nextPpid = await this.readPpid(ancestor);
          if (
            !Number.isFinite(nextPpid) ||
            nextPpid === ancestor ||
            nextPpid <= 1
          )
            break;
          ancestor = nextPpid;
        }
      }

      const firstSeen = this.firstSeenAt.get(row.pid) ?? observedAt;
      nextFirstSeen.set(row.pid, firstSeen);

      const info: ProcessInfo = {
        pid: row.pid,
        ppid: Number.isFinite(ppid) ? ppid : 0,
        command: row.command || "unknown",
        commandLine: row.command || "unknown",
        port: row.port,
        protocol: "tcp",
        cwd: cwd ?? null,
        repoSlug: repoSlug ?? null,
        firstSeenAt: firstSeen,
        observedAt,
      };

      const key = `${info.pid}|${info.port}|${info.repoSlug ?? ""}`;
      if (seenSig.has(key)) continue;
      seenSig.add(key);
      next.push(info);
    }

    next.sort(
      (a, b) =>
        a.pid - b.pid ||
        a.port - b.port ||
        (a.repoSlug ?? "").localeCompare(b.repoSlug ?? ""),
    );

    const signature = next
      .map((p) => `${p.pid}|${p.port}|${p.repoSlug ?? ""}`)
      .join(";");

    const changed =
      signature !== this.snapshot.signature || this.snapshot.snapshotAt === 0;

    this.snapshot = { processes: next, snapshotAt: observedAt, signature };
    this.firstSeenAt = nextFirstSeen;

    if (changed) {
      const payload: ProcessUpdateEvent = {
        processes: next.slice(),
        snapshotAt: observedAt,
      };
      this.events.emit("update", payload);
    }
  }

  private rebuildTrie(): void {
    try {
      const sqlite = getSqlite();
      const rows = sqlite
        .prepare("SELECT slug, full_path FROM repos")
        .all() as Array<{ slug: string; full_path: string }>;
      const trie = new RepoPathTrie();
      for (const row of rows) {
        if (row.full_path && row.slug) {
          trie.insert(row.full_path, row.slug);
        }
      }
      this.trie = trie;
    } catch (err) {
      console.error("[backend] processService rebuildTrie failed", err);
      if (!this.trie) this.trie = new RepoPathTrie();
    }
  }

  // -------------------------------------------------------------------------
  // Internals — subprocess wrappers
  // -------------------------------------------------------------------------
  // NOTE: every shell-out uses `execFile` with a literal argv array. The
  // only dynamic arg is a Zod-validated PID; never a shell-evaluated string.

  private async runLsofListen(): Promise<LsofListenRow[]> {
    try {
      const { stdout } = await execFileP(
        "lsof",
        ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcnTL"],
        { timeout: LSOF_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      );
      return parseLsofListen(stdout);
    } catch (err) {
      // `lsof` exits non-zero when there are zero matches on some hosts;
      // try to parse stdout anyway, then fall back to empty.
      const stdout =
        (err as { stdout?: string | Buffer }).stdout?.toString?.() ?? "";
      if (stdout.length > 0) {
        try {
          return parseLsofListen(stdout);
        } catch {
          /* ignore */
        }
      }
      return [];
    }
  }

  private async readCwd(pid: number): Promise<string | null> {
    try {
      const { stdout } = await execFileP(
        "lsof",
        ["-p", String(pid), "-F", "n", "-d", "cwd"],
        { timeout: LSOF_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      );
      return parseLsofCwd(stdout);
    } catch (err) {
      const stdout =
        (err as { stdout?: string | Buffer }).stdout?.toString?.() ?? "";
      if (stdout.length > 0) {
        try {
          return parseLsofCwd(stdout);
        } catch {
          /* ignore */
        }
      }
      return null;
    }
  }

  private async readPpid(pid: number): Promise<number> {
    try {
      const { stdout } = await execFileP(
        "ps",
        ["-o", "ppid=", "-p", String(pid)],
        { timeout: LSOF_TIMEOUT_MS },
      );
      const ppid = Number.parseInt(stdout.trim(), 10);
      return Number.isFinite(ppid) ? ppid : 0;
    } catch {
      return 0;
    }
  }

  private async pidAlive(pid: number): Promise<boolean> {
    try {
      const { stdout } = await execFileP(
        "ps",
        ["-p", String(pid), "-o", "pid="],
        { timeout: LSOF_TIMEOUT_MS },
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async waitForExit(pid: number, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (!(await this.pidAlive(pid))) return true;
      const remaining = deadline - Date.now();
      const sleepMs = Math.min(200, Math.max(0, remaining));
      if (sleepMs === 0) break;
      await new Promise((r) => setTimeout(r, sleepMs));
    }
    return !(await this.pidAlive(pid));
  }
}

export const processService: ProcessService = new ProcessService();
