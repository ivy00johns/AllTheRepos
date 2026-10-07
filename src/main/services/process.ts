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
/**
 * cwd resolution is batched: one `lsof` covers `CWD_BATCH_SIZE` PIDs, and
 * `CWD_BATCH_CONCURRENCY` batches are in flight at once. A batch costs more
 * than a single-PID probe, so it gets a wider ceiling.
 */
const CWD_BATCH_SIZE = 32;
const CWD_BATCH_CONCURRENCY = 4;
const LSOF_BATCH_TIMEOUT_MS = 5000;

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
 * Parse a batched `lsof -a -p <pid,pid,...> -F pn -d cwd` listing into a
 * `pid -> cwd` map. A PID lsof cannot read (someone else's process, or one
 * that exited between the `ps` and the `lsof`) is simply absent from the map.
 *
 * The `-a` (AND) flag is load-bearing. Without it lsof ORs its selection
 * options, so `-d cwd` widens the query from "this PID's cwd" to "every
 * process's cwd" — a ~520-block listing on a developer Mac whose first line
 * (`/`) was then read as the listener's own cwd. That silently broke
 * `repoSlug` attribution and, because every row then missed and fell into
 * the parent walk, made a tick take tens of seconds.
 *
 * Exported for unit testing.
 */
export function parseLsofCwdMap(output: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    const prefix = line.charCodeAt(0);
    const value = line.slice(1);
    if (prefix === 0x70 /* p */) {
      const parsed = Number.parseInt(value, 10);
      pid = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      continue;
    }
    // Only truthy once a valid `p` block has opened; f/T/L lines are noise.
    if (pid == null) continue;
    if (prefix !== 0x6e /* n */) continue;
    // First cwd line per PID block wins.
    if (cwds.has(pid)) continue;
    const cwd = value.trim();
    if (cwd.length > 0) cwds.set(pid, cwd);
  }
  return cwds;
}

/**
 * Parse `ps -axo pid=,ppid=` output into a `pid -> ppid` map.
 *
 * One call replaces a `ps` per hop of every listener's parent walk. Lines
 * that are not exactly two integers are skipped: `ps` emits a header line
 * when the `=` suffixes are missing, and a PID can exit mid-scan.
 *
 * Exported for unit testing.
 */
export function parsePsTree(output: string): Map<number, number> {
  const tree = new Map<number, number>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number.parseInt(match[1]!, 10);
    const ppid = Number.parseInt(match[2]!, 10);
    if (pid <= 0) continue;
    tree.set(pid, ppid);
  }
  return tree;
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
// Parent-walk resolution
// ---------------------------------------------------------------------------

/**
 * Every PID whose cwd {@link resolveRepoSlugFor} could consult for these
 * listener PIDs: the listeners themselves, plus up to `PPID_WALK_HOPS`
 * ancestors each.
 *
 * The walk is lazy — it stops at the first hit — so this is a superset of
 * what any individual lookup needs. Knowing the superset up front is what
 * lets the cwds be fetched in one batched `lsof` instead of one call per
 * hop: the walk itself then runs entirely in memory.
 *
 * Exported for unit testing.
 */
export function cwdCandidates(
  pids: number[],
  ppidOf: (pid: number) => number,
): number[] {
  const wanted = new Set<number>();
  for (const pid of pids) {
    wanted.add(pid);
    let ancestor = ppidOf(pid);
    for (let hop = 0; hop < PPID_WALK_HOPS && ancestor > 1; hop++) {
      wanted.add(ancestor);
      const next = ppidOf(ancestor);
      if (!Number.isFinite(next) || next === ancestor || next <= 1) break;
      ancestor = next;
    }
  }
  return [...wanted];
}

/**
 * Repo slug for one listening PID: its own cwd first, then the cwd of up to
 * `PPID_WALK_HOPS` ancestors — a dev server is often a child of a shell that
 * sits in the repo while the server itself was started from elsewhere.
 *
 * Pure over its callbacks, so the semantics the old per-hop subprocess loop
 * had can be pinned by unit tests. `ppidOf` returns 0 for an unknown PID, as
 * the old `ps` probe did, which terminates the walk.
 *
 * Exported for unit testing.
 */
export function resolveRepoSlugFor(
  pid: number,
  ppidOf: (pid: number) => number,
  cwdOf: (pid: number) => string | null,
  lookup: (cwd: string) => string | null,
): string | null {
  const ownCwd = cwdOf(pid);
  if (ownCwd) {
    const direct = lookup(ownCwd);
    if (direct) return direct;
  }

  let ancestor = ppidOf(pid);
  for (let hop = 0; hop < PPID_WALK_HOPS && ancestor > 1; hop++) {
    const ancestorCwd = cwdOf(ancestor);
    if (ancestorCwd) {
      const hit = lookup(ancestorCwd);
      if (hit) return hit;
    }
    const next = ppidOf(ancestor);
    if (!Number.isFinite(next) || next === ancestor || next <= 1) break;
    ancestor = next;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bounded-concurrency helper
// ---------------------------------------------------------------------------

/**
 * Run `task` over `items` with at most `limit` invocations in flight.
 * Results are collected by the caller, which keeps this free of ordering
 * concerns. A rejecting task rejects the whole call; the tasks passed here
 * swallow their own subprocess errors rather than doing that.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await task(items[index]!);
      }
    },
  );
  await Promise.all(workers);
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
    // first call — but do NOT await it. `boot()` is awaited before the main
    // window is created, so awaiting the prime delayed the first paint by a
    // whole tick (ATR-055); a tick is now three subprocess rounds rather
    // than one per hop per listener, but it is still not startup work.
    // Nothing depends on the prime having finished: `list()` already
    // triggers its own tick when the snapshot is still empty, so the worst
    // case without priming is that the FIRST `process:list` call pays for
    // one tick instead of startup paying for it. Errors are non-fatal — the
    // next tick recovers.
    void this.tick().catch((err: unknown) => {
      console.error("[backend] processService.boot prime tick failed", err);
    });
  }

  /**
   * Returns the cached snapshot. Increments the consumer heartbeat and
   * ensures the poller is running. If we have no snapshot yet, triggers
   * a synchronous tick, whose subprocess rounds each carry their own
   * timeout (`LSOF_TIMEOUT_MS`, `LSOF_BATCH_TIMEOUT_MS`).
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

  /**
   * Build one snapshot. Three subprocess rounds regardless of how many
   * listeners the host has:
   *
   *   1. the listening sockets and the whole `pid -> ppid` map, in parallel;
   *   2. the batched cwd fetch for the listeners plus every ancestor the walk
   *      could reach ({@link cwdCandidates});
   *   3. nothing — the parent walk then runs in memory.
   *
   * It used to be a `ps` and an `lsof` per hop, per listener, serially.
   */
  private async tick(): Promise<void> {
    const observedAt = Date.now();

    // Independent of each other: both are whole-host listings.
    const [listenRows, ppidByPid] = await Promise.all([
      this.runLsofListen(),
      this.readProcessTree(),
    ]);

    // Lazy trie rebuild — no catalog events to listen to, so refresh once
    // per tick. Cost is one indexed SQLite SELECT.
    this.rebuildTrie();
    const trie = this.trie;

    const ppidOf = (pid: number): number => ppidByPid.get(pid) ?? 0;
    // Skip privileged ports per the §5.2 rule, before any cwd work.
    const portRows = listenRows.filter((row) => row.port > 1024);
    const cwdByPid = await this.readCwds(
      cwdCandidates(
        portRows.map((row) => row.pid),
        ppidOf,
      ),
    );
    const cwdOf = (pid: number): string | null => cwdByPid.get(pid) ?? null;
    const lookup = (cwd: string): string | null => trie?.lookup(cwd) ?? null;

    const next: ProcessInfo[] = [];
    const seenSig = new Set<string>();
    const nextFirstSeen = new Map<number, number>();

    for (const row of portRows) {
      const ppid = ppidOf(row.pid);
      const cwd = cwdOf(row.pid);
      const repoSlug = resolveRepoSlugFor(row.pid, ppidOf, cwdOf, lookup);

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

  /**
   * The whole `pid -> ppid` table from one `ps`. Replaces a `ps` per hop of
   * every listener's parent walk. A failed scan yields an empty map, which
   * makes every `ppidOf` return 0 and simply skips the walks this tick.
   */
  private async readProcessTree(): Promise<Map<number, number>> {
    try {
      const { stdout } = await execFileP("ps", ["-axo", "pid=,ppid="], {
        timeout: LSOF_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      return parsePsTree(stdout);
    } catch (err) {
      const stdout =
        (err as { stdout?: string | Buffer }).stdout?.toString?.() ?? "";
      return stdout.length > 0 ? parsePsTree(stdout) : new Map();
    }
  }

  /**
   * Batched cwd resolution: `CWD_BATCH_SIZE` PIDs per `lsof`, up to
   * `CWD_BATCH_CONCURRENCY` calls at once. PIDs that don't come back (gone,
   * or not readable) are left out of the map, so their lookups behave as
   * "cwd unknown" rather than as a wrong path.
   */
  private async readCwds(pids: number[]): Promise<Map<number, string>> {
    const cwds = new Map<number, string>();
    if (pids.length === 0) return cwds;

    const chunks: number[][] = [];
    for (let i = 0; i < pids.length; i += CWD_BATCH_SIZE) {
      chunks.push(pids.slice(i, i + CWD_BATCH_SIZE));
    }

    await mapWithConcurrency(chunks, CWD_BATCH_CONCURRENCY, async (chunk) => {
      const parsed = await this.runLsofCwds(chunk);
      for (const [pid, cwd] of parsed) cwds.set(pid, cwd);
    });
    return cwds;
  }

  /**
   * One batched `lsof` for a chunk of PIDs. `lsof` exits non-zero as soon as
   * any requested PID has disappeared (routine — processes exit between the
   * `ps` and this call), so a non-zero exit is not an error here: whatever it
   * printed is parsed and the missing PIDs stay unknown.
   */
  private async runLsofCwds(pids: number[]): Promise<Map<number, string>> {
    try {
      const { stdout } = await execFileP(
        "lsof",
        ["-a", "-p", pids.join(","), "-F", "pn", "-d", "cwd"],
        { timeout: LSOF_BATCH_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      );
      return parseLsofCwdMap(stdout);
    } catch (err) {
      const stdout =
        (err as { stdout?: string | Buffer }).stdout?.toString?.() ?? "";
      return stdout.length > 0 ? parseLsofCwdMap(stdout) : new Map();
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
