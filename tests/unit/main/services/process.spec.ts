/**
 * Phase 3a Unit Test — ProcessService internals.
 *
 * Covers the pure test seams exported by `@main/services/process`:
 *   - parseLsofListen (field-prefixed lsof TCP-listen parser)
 *   - parseLsofCwdMap (batched `lsof -a -p <pids>` listing → pid → cwd)
 *   - parsePsTree     (`ps -axo pid=,ppid=` → pid → ppid)
 *   - cwdCandidates / resolveRepoSlugFor (the parent-walk pair — the
 *     resolver must only ever ask for PIDs the candidate set fetched)
 *   - resolveRealPath / lookupRepoSlug (symlinked paths on either side)
 *   - RepoPathTrie   (deepest-prefix slug lookup)
 *   - snapshot equality (signature stability across input order)
 *   - kill state machine (SIGINT → SIGTERM → SIGKILL via global process.kill)
 *
 * We mock `electron` (so importing the module from vitest doesn't crash
 * on the `require("electron")` lazy probe) and `@main/db/client` (so the
 * trie rebuild is a no-op when the DB isn't available).
 *
 * Owner: qe-agent (Phase 3a).
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("electron", () => ({
  app: {
    isFocused: () => true,
    on: vi.fn(),
  },
}));

/**
 * The catalog rows `rebuildTrie` reads. Mutable so a test can seed the trie
 * with a repo path — including a symlinked one — without a database.
 */
const dbState = vi.hoisted(() => ({
  rows: [] as Array<{ slug: string; full_path: string }>,
}));

vi.mock("@main/db/client", () => ({
  getSqlite: () => ({
    prepare: () => ({ all: () => dbState.rows }),
  }),
}));

import {
  parseLsofListen,
  parseLsofCwdMap,
  parsePsTree,
  cwdCandidates,
  resolveRepoSlugFor,
  resolveRealPath,
  lookupRepoSlug,
  RepoPathTrie,
  processService,
} from "@main/services/process";

beforeEach(() => {
  vi.clearAllMocks();
  dbState.rows = [];
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// parseLsofListen
// ---------------------------------------------------------------------------

describe("parseLsofListen", () => {
  it("parses a single PID with a single listening port", () => {
    const out = ["p1234", "cnode", "n*:3000", "TST=LISTEN"].join("\n");
    const rows = parseLsofListen(out);
    expect(rows).toEqual([
      { pid: 1234, command: "node", port: 3000, host: "*" },
    ]);
  });

  it("parses a single PID emitting multiple listening ports", () => {
    const out = ["p1234", "cnode", "n127.0.0.1:3000", "n127.0.0.1:3001"].join(
      "\n",
    );
    const rows = parseLsofListen(out);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ pid: 1234, port: 3000, host: "127.0.0.1" });
    expect(rows[1]).toMatchObject({ pid: 1234, port: 3001, host: "127.0.0.1" });
  });

  it("parses multiple PID blocks and keeps each block's command", () => {
    const out = ["p100", "ccmd-a", "n*:8080", "p200", "ccmd-b", "n*:9090"].join(
      "\n",
    );
    const rows = parseLsofListen(out);
    expect(rows).toEqual([
      { pid: 100, command: "cmd-a", port: 8080, host: "*" },
      { pid: 200, command: "cmd-b", port: 9090, host: "*" },
    ]);
  });

  it("preserves IPv6 brackets in the host portion", () => {
    const out = ["p1", "cipv6", "n[::]:3000"].join("\n");
    const rows = parseLsofListen(out);
    expect(rows).toEqual([
      { pid: 1, command: "ipv6", port: 3000, host: "[::]" },
    ]);
  });

  it("skips lines with no colon in the n-field (malformed)", () => {
    const out = ["p1", "cnode", "nnoport"].join("\n");
    expect(parseLsofListen(out)).toEqual([]);
  });

  it("skips n-fields whose port is non-numeric", () => {
    const out = ["p1", "cnode", "n*:notaport"].join("\n");
    expect(parseLsofListen(out)).toEqual([]);
  });

  it("skips n-fields whose port is out of 1-65535 range", () => {
    const out = ["p1", "cnode", "n*:99999", "n*:0", "n*:3000"].join("\n");
    const rows = parseLsofListen(out);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.port).toBe(3000);
  });

  it("skips n-fields when the preceding p-line was missing/invalid", () => {
    // No `p` line at all — every subsequent line gets dropped.
    const out = ["cnode", "n*:3000"].join("\n");
    expect(parseLsofListen(out)).toEqual([]);
  });

  it("returns [] for empty input", () => {
    expect(parseLsofListen("")).toEqual([]);
  });

  it("ignores unrelated field prefixes (T, L)", () => {
    const out = ["p1234", "cnode", "Llinda", "TST=LISTEN", "n*:3000"].join(
      "\n",
    );
    expect(parseLsofListen(out)).toEqual([
      { pid: 1234, command: "node", port: 3000, host: "*" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// parseLsofCwdMap
// ---------------------------------------------------------------------------

describe("parseLsofCwdMap", () => {
  it("maps each PID block to its cwd", () => {
    const out = [
      "p1234",
      "fcwd",
      "n/Users/me/foo",
      "p2345",
      "fcwd",
      "n/Users/me/bar",
    ].join("\n");
    expect([...parseLsofCwdMap(out)]).toEqual([
      [1234, "/Users/me/foo"],
      [2345, "/Users/me/bar"],
    ]);
  });

  it("keeps the first cwd line of a PID block", () => {
    const out = ["p1234", "fcwd", "n/Users/me/foo", "n/Users/me/later"].join(
      "\n",
    );
    expect(parseLsofCwdMap(out).get(1234)).toBe("/Users/me/foo");
  });

  it("omits a PID whose cwd line is blank", () => {
    const out = [
      "p1234",
      "fcwd",
      "n   ",
      "p2345",
      "fcwd",
      "n/Users/me/bar",
    ].join("\n");
    const map = parseLsofCwdMap(out);
    expect(map.has(1234)).toBe(false);
    expect(map.get(2345)).toBe("/Users/me/bar");
  });

  it("omits a PID with no cwd line at all", () => {
    expect(parseLsofCwdMap(["p1234", "fcwd"].join("\n")).size).toBe(0);
  });

  it("drops n-lines that precede any p-block", () => {
    const out = [
      "lsof: WARNING: can't stat() /something",
      "n/Users/me/orphan",
      "p1234",
      "fcwd",
      "n/Users/me/bar",
    ].join("\n");
    const map = parseLsofCwdMap(out);
    expect(map.size).toBe(1);
    expect(map.get(1234)).toBe("/Users/me/bar");
  });

  it("ignores a malformed p-line and resumes at the next block", () => {
    const out = [
      "pnotapid",
      "fcwd",
      "n/Users/me/foo",
      "p7",
      "fcwd",
      "n/Users/me/bar",
    ].join("\n");
    const map = parseLsofCwdMap(out);
    expect(map.size).toBe(1);
    expect(map.get(7)).toBe("/Users/me/bar");
  });

  it("trims trailing whitespace on the cwd value", () => {
    expect(parseLsofCwdMap("p1\nfcwd\nn/Users/me/foo   ").get(1)).toBe(
      "/Users/me/foo",
    );
  });

  it("returns an empty map for empty input", () => {
    expect(parseLsofCwdMap("").size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parsePsTree
// ---------------------------------------------------------------------------

describe("parsePsTree", () => {
  it("maps pid -> ppid", () => {
    const out = ["    1     0", "  360     1", "  438     1"].join("\n");
    expect([...parsePsTree(out)]).toEqual([
      [1, 0],
      [360, 1],
      [438, 1],
    ]);
  });

  it("skips a header line", () => {
    expect(parsePsTree("  PID  PPID\n  1     0\n").size).toBe(1);
  });

  it("skips lines that are not two integers", () => {
    const out = ["  1     0", "garbage", "  2     x", "3", ""].join("\n");
    expect([...parsePsTree(out)]).toEqual([[1, 0]]);
  });

  it("skips pid 0 (its own row would make every lookup terminate)", () => {
    expect(parsePsTree("0 0").size).toBe(0);
  });

  it("returns an empty map for empty input", () => {
    expect(parsePsTree("").size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RepoPathTrie
// ---------------------------------------------------------------------------

describe("RepoPathTrie", () => {
  it("returns null on an empty trie", () => {
    const trie = new RepoPathTrie();
    expect(trie.lookup("/anywhere")).toBeNull();
  });

  it("returns null on empty input path", () => {
    const trie = new RepoPathTrie();
    trie.insert("/a/b", "ab");
    expect(trie.lookup("")).toBeNull();
  });

  it("matches when cwd is an exact repo root", () => {
    const trie = new RepoPathTrie();
    trie.insert("/Users/me/Projects/foo", "foo");
    expect(trie.lookup("/Users/me/Projects/foo")).toBe("foo");
  });

  it("matches when cwd is a sub-directory of a repo root", () => {
    const trie = new RepoPathTrie();
    trie.insert("/Users/me/Projects/foo", "foo");
    expect(trie.lookup("/Users/me/Projects/foo/src/lib")).toBe("foo");
  });

  it("does NOT match when cwd is an ancestor of the repo root (above the repo)", () => {
    const trie = new RepoPathTrie();
    trie.insert("/a/b/c", "c");
    expect(trie.lookup("/a/b")).toBeNull();
  });

  it("prefers the deepest-prefix match (nested repos)", () => {
    const trie = new RepoPathTrie();
    trie.insert("/repos", "outer");
    trie.insert("/repos/foo", "foo");
    expect(trie.lookup("/repos/foo/src")).toBe("foo");
  });

  it("returns the outer slug when the inner repo is not yet entered", () => {
    const trie = new RepoPathTrie();
    trie.insert("/repos", "outer");
    trie.insert("/repos/foo", "foo");
    expect(trie.lookup("/repos/bar")).toBe("outer");
  });

  it("returns null on a sibling path that shares no parent segment", () => {
    const trie = new RepoPathTrie();
    trie.insert("/a/b/c", "c");
    expect(trie.lookup("/x/y/z")).toBeNull();
  });

  it("respects insertion order — last insert wins at the same node", () => {
    const trie = new RepoPathTrie();
    trie.insert("/a/b", "first");
    trie.insert("/a/b", "second");
    expect(trie.lookup("/a/b")).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// cwdCandidates + resolveRepoSlugFor
//
// These two are a pair: the resolver decides which PIDs it wants cwds for,
// and the candidate set is what the service fetches in one batched `lsof`
// before the walk runs in memory. If the resolver ever asks about a PID the
// candidate set left out, the walk silently loses a hop — so the last test
// here asserts the invariant directly.
// ---------------------------------------------------------------------------

/** Build a `ppidOf` from a plain tree, mirroring the service's 0-for-unknown. */
function ppidOfFrom(tree: Record<number, number>): (pid: number) => number {
  return (pid) => tree[pid] ?? 0;
}

/** A linear chain `start -> start+1 -> ... -> end`, ending at 0. */
function chain(start: number, hops: number): Record<number, number> {
  const tree: Record<number, number> = {};
  for (let i = 0; i < hops; i++) tree[start + i] = start + i + 1;
  tree[start + hops] = 0;
  return tree;
}

describe("cwdCandidates", () => {
  it("includes the listener itself", () => {
    expect(cwdCandidates([10], ppidOfFrom({ 10: 0 }))).toEqual([10]);
  });

  it("includes the ancestors of a short chain", () => {
    const got = cwdCandidates([10], ppidOfFrom({ 10: 20, 20: 30, 30: 0 }));
    expect(got.sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it("stops after PPID_WALK_HOPS ancestors", () => {
    // 10 -> 11 -> ... -> 26: fifteen ancestors available, ten wanted.
    const got = cwdCandidates([10], ppidOfFrom(chain(10, 15)));
    expect(got).toHaveLength(11);
    expect(got).toContain(20);
    expect(got).not.toContain(21);
  });

  it("stops at pid 1 and does not include it", () => {
    expect(
      cwdCandidates([10], ppidOfFrom({ 10: 1 })).sort((a, b) => a - b),
    ).toEqual([10]);
  });

  it("terminates on a self-parent cycle", () => {
    expect(cwdCandidates([10], ppidOfFrom({ 10: 10 }))).toEqual([10]);
  });

  it("dedupes an ancestor shared by two listeners", () => {
    const got = cwdCandidates(
      [10, 11],
      ppidOfFrom({ 10: 20, 11: 20, 20: 0 }),
    );
    expect(got.sort((a, b) => a - b)).toEqual([10, 11, 20]);
  });
});

describe("resolveRepoSlugFor", () => {
  function trieFor(...paths: string[]): RepoPathTrie {
    const trie = new RepoPathTrie();
    for (const path of paths) trie.insert(path, path.split("/").pop()!);
    return trie;
  }

  it("matches the listener's own cwd", () => {
    const trie = trieFor("/repos/foo");
    const slug = resolveRepoSlugFor(
      10,
      () => 0,
      () => "/repos/foo/src",
      (cwd) => trie.lookup(cwd),
    );
    expect(slug).toBe("foo");
  });

  it("falls back to an ancestor's cwd when the listener's is elsewhere", () => {
    const trie = trieFor("/repos/foo");
    const cwds: Record<number, string> = { 10: "/", 20: "/repos/foo" };
    const slug = resolveRepoSlugFor(
      10,
      ppidOfFrom({ 10: 20, 20: 0 }),
      (pid) => cwds[pid] ?? null,
      (cwd) => trie.lookup(cwd),
    );
    expect(slug).toBe("foo");
  });

  it("reaches an ancestor exactly PPID_WALK_HOPS away", () => {
    // chain(10, 10) walks 11..20, so 20 is the tenth and last hop.
    const trie = trieFor("/repos/deep");
    const cwds: Record<number, string> = { 20: "/repos/deep" };
    const slug = resolveRepoSlugFor(
      10,
      ppidOfFrom(chain(10, 10)),
      (pid) => cwds[pid] ?? null,
      (cwd) => trie.lookup(cwd),
    );
    expect(slug).toBe("deep");
  });

  it("does not reach one hop beyond PPID_WALK_HOPS", () => {
    const trie = trieFor("/repos/toofar");
    const cwds: Record<number, string> = { 21: "/repos/toofar" };
    const slug = resolveRepoSlugFor(
      10,
      ppidOfFrom(chain(10, 15)),
      (pid) => cwds[pid] ?? null,
      (cwd) => trie.lookup(cwd),
    );
    expect(slug).toBeNull();
  });

  it("returns null when no cwd in the chain matches a repo", () => {
    const trie = trieFor("/repos/foo");
    const slug = resolveRepoSlugFor(
      10,
      ppidOfFrom({ 10: 20, 20: 0 }),
      () => "/somewhere/else",
      (cwd) => trie.lookup(cwd),
    );
    expect(slug).toBeNull();
  });

  it("returns null when neither the cwd nor the parent is known", () => {
    expect(
      resolveRepoSlugFor(
        10,
        () => 0,
        () => null,
        () => "anything",
      ),
    ).toBeNull();
  });

  it("terminates on a self-parent cycle", () => {
    const trie = trieFor("/repos/foo");
    const slug = resolveRepoSlugFor(
      10,
      ppidOfFrom({ 10: 10 }),
      () => "/elsewhere",
      (cwd) => trie.lookup(cwd),
    );
    expect(slug).toBeNull();
  });

  it("prefers the listener's own repo over an ancestor's", () => {
    const trie = trieFor("/repos/inner", "/repos/outer");
    const cwds: Record<number, string> = { 10: "/repos/inner", 20: "/repos/outer" };
    const slug = resolveRepoSlugFor(
      10,
      ppidOfFrom({ 10: 20, 20: 0 }),
      (pid) => cwds[pid] ?? null,
      (cwd) => trie.lookup(cwd),
    );
    expect(slug).toBe("inner");
  });

  it("consults only PIDs the candidate set already prefetched", () => {
    const tree = chain(10, 12);
    const ppidOf = ppidOfFrom(tree);
    const consulted: number[] = [];
    resolveRepoSlugFor(
      10,
      ppidOf,
      (pid) => {
        consulted.push(pid);
        return null;
      },
      () => null,
    );

    expect(consulted.length).toBeGreaterThan(1);
    const candidates = new Set(cwdCandidates([10], ppidOf));
    for (const pid of consulted) expect(candidates.has(pid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Symlinked repo paths
//
// A cwd arrives as the path the kernel resolved; a catalog row holds whatever
// the scanner was handed. When those differ — a `~/Code` symlinked onto
// another volume, anything under `/tmp` on macOS — an unresolved comparison
// never matches, and the port silently shows no repo. The trie is keyed on
// resolved paths and a cwd is resolved before the fallback probe, which is
// what these pin.
// ---------------------------------------------------------------------------

describe("resolveRealPath", () => {
  it("resolves a symlink to its target", () => {
    const root = mkdtempSync(join(tmpdir(), "atr-realpath-"));
    try {
      const target = join(root, "real-repo");
      mkdirSync(target, { recursive: true });
      const link = join(root, "linked-repo");
      symlinkSync(target, link);

      expect(resolveRealPath(link)).toBe(resolveRealPath(target));
      expect(resolveRealPath(link)).not.toBe(link);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the path unchanged when it cannot be resolved", () => {
    const missing = join(tmpdir(), "atr-does-not-exist-9f3a1c");
    expect(resolveRealPath(missing)).toBe(missing);
  });
});

describe("lookupRepoSlug", () => {
  it("returns null without a trie", () => {
    expect(lookupRepoSlug(null, "/anything")).toBeNull();
  });

  it("prefers the cwd as reported", () => {
    const trie = new RepoPathTrie();
    trie.insert("/repos/foo", "foo");
    expect(lookupRepoSlug(trie, "/repos/foo/src")).toBe("foo");
  });

  it("falls back to the resolved cwd when the reported one misses", () => {
    const trie = new RepoPathTrie();
    trie.insert("/private/var/repos/foo", "foo");
    const resolve = (path: string) => path.replace("/var/", "/private/var/");
    expect(lookupRepoSlug(trie, "/var/repos/foo", resolve)).toBe("foo");
  });

  it("does not re-probe when the resolver is the identity", () => {
    const trie = new RepoPathTrie();
    const seen: string[] = [];
    const spy = new Proxy(trie, {
      get(target, prop, receiver) {
        if (prop === "lookup") {
          return (path: string) => {
            seen.push(path);
            return target.lookup(path);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as RepoPathTrie;
    expect(lookupRepoSlug(spy, "/elsewhere", (path) => path)).toBeNull();
    expect(seen).toEqual(["/elsewhere"]);
  });
});

describe("symlinked repo matching (catalog path -> listener cwd)", () => {
  it("matches a repo registered through a symlink from the canonical cwd", () => {
    const root = mkdtempSync(join(tmpdir(), "atr-symlink-"));
    try {
      const realRepo = join(root, "real-repo");
      mkdirSync(join(realRepo, "src", "lib"), { recursive: true });
      const linkedRepo = join(root, "linked-repo");
      symlinkSync(realRepo, linkedRepo);

      // What the scanner stored: the symlinked path. (On macOS `/var` is
      // itself a symlink, so even this is not the canonical form.)
      const trie = new RepoPathTrie();
      trie.insert(resolveRealPath(linkedRepo), "slug");

      // What lsof reports for a server running in that repo: the resolved cwd.
      const listenerCwd = resolveRealPath(join(linkedRepo, "src", "lib"));
      expect(lookupRepoSlug(trie, listenerCwd)).toBe("slug");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("would not match without resolution — the raw paths differ", () => {
    const root = mkdtempSync(join(tmpdir(), "atr-symlink-raw-"));
    try {
      const realRepo = join(root, "real-repo");
      mkdirSync(realRepo, { recursive: true });
      const linkedRepo = join(root, "linked-repo");
      symlinkSync(realRepo, linkedRepo);

      // The trie keyed on the raw catalog path is the pre-fix behaviour: the
      // listener's canonical cwd is a different string, so nothing matches.
      const trie = new RepoPathTrie();
      trie.insert(linkedRepo, "slug");
      expect(trie.lookup(resolveRealPath(linkedRepo))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Snapshot equality (signature derivation)
//
// The service emits an `update` event when its (pid, port, repoSlug)
// signature changes. We can't call private `tick()` directly, but we
// CAN derive the equivalent signature ourselves and assert it matches
// across input order. This locks the contract that two snapshots with
// the same triple-set compare equal — the same comparison the service
// uses internally.
// ---------------------------------------------------------------------------

function signatureFor(
  rows: Array<{ pid: number; port: number; repoSlug: string | null }>,
): string {
  // Mirror the in-service sort + join.
  const sorted = rows
    .slice()
    .sort(
      (a, b) =>
        a.pid - b.pid ||
        a.port - b.port ||
        (a.repoSlug ?? "").localeCompare(b.repoSlug ?? ""),
    );
  return sorted.map((r) => `${r.pid}|${r.port}|${r.repoSlug ?? ""}`).join(";");
}

describe("Snapshot equality (signature)", () => {
  it("compares equal regardless of input order", () => {
    const a = [
      { pid: 1, port: 3000, repoSlug: "foo" },
      { pid: 2, port: 4000, repoSlug: "bar" },
    ];
    const b = [
      { pid: 2, port: 4000, repoSlug: "bar" },
      { pid: 1, port: 3000, repoSlug: "foo" },
    ];
    expect(signatureFor(a)).toBe(signatureFor(b));
  });

  it("differs when a repoSlug changes", () => {
    const a = [{ pid: 1, port: 3000, repoSlug: "foo" }];
    const b = [{ pid: 1, port: 3000, repoSlug: "bar" }];
    expect(signatureFor(a)).not.toBe(signatureFor(b));
  });

  it("differs when a port changes", () => {
    const a = [{ pid: 1, port: 3000, repoSlug: "foo" }];
    const b = [{ pid: 1, port: 3001, repoSlug: "foo" }];
    expect(signatureFor(a)).not.toBe(signatureFor(b));
  });

  it("compares equal on an empty snapshot", () => {
    expect(signatureFor([])).toBe(signatureFor([]));
  });
});

// ---------------------------------------------------------------------------
// refresh()
//
// Real subprocesses on purpose, like the kill machine below: the point of
// refresh is that it sweeps rather than reading the cache, and a mocked sweep
// would prove nothing. Cheap now that a tick is three batched rounds.
// ---------------------------------------------------------------------------

describe("refresh", () => {
  it("sweeps and resolves with a fresh snapshot", async () => {
    const result = await processService.refresh();
    expect(Array.isArray(result.processes)).toBe(true);
    expect(result.snapshotAt).toBeGreaterThan(0);
  }, 30_000);

  it("resolves the same way when a sweep is already in flight", async () => {
    // Two callers at once must join one sweep rather than stack two.
    const [a, b] = await Promise.all([
      processService.refresh(),
      processService.refresh(),
    ]);
    expect(a.snapshotAt).toBeGreaterThan(0);
    expect(b.snapshotAt).toBeGreaterThan(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Binding end to end (mocked catalog, real lsof/ps)
//
// The pieces above are tested in isolation; this drives the whole path through
// the service — catalog row -> trie -> the cwd lsof reports for a real
// listener — which is the only place the wiring itself is covered. It is also
// the test that notices if `rebuildTrie` stops keying on resolved paths.
// ---------------------------------------------------------------------------

/**
 * Sweep until the listener is in the snapshot, rather than sampling once.
 *
 * A port bound a moment ago can be missing from the first sample — one sweep is
 * three batched lsof rounds, and the kernel's live-listener set is read a beat
 * after the child printed its port. That is a race in the test rather than in
 * the service: what these cases are about is that binding is *detected*, not
 * that the first sweep detected it. Bounded, so a listener the service genuinely
 * cannot see still fails on the assertion instead of hanging here.
 */
async function refreshUntilPort(
  port: number,
  timeoutMs = 10_000,
): Promise<Awaited<ReturnType<typeof processService.refresh>>> {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await processService.refresh();
  while (!snapshot.processes.some((row) => row.port === port) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    snapshot = await processService.refresh();
  }
  return snapshot;
}

/** A child that listens on an ephemeral port and prints it. */
function spawnListener(cwd: string): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "const s=require('http').createServer((q,r)=>r.end('ok'));s.listen(0,()=>{console.log('PORT='+s.address().port);});",
    ],
    { cwd, stdio: ["ignore", "pipe", "ignore"] },
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("listener never printed PORT")),
      5_000,
    );
    child.stdout!.on("data", (buf: Buffer) => {
      const m = buf.toString("utf8").match(/PORT=(\d+)/);
      if (m?.[1]) {
        clearTimeout(timer);
        resolve({ child, port: parseInt(m[1], 10) });
      }
    });
    child.once("error", reject);
  });
}

/**
 * The two tests below are the only ones that need `lsof` on the machine:
 * `refresh()` shells out to it, so without it the sweep finds no listeners at
 * all and they fail on their own subject rather than on the missing tool.
 * macOS ships `lsof` and the Ubuntu runner image is given it; a slim container
 * has neither, and there they stop with a reason instead of going red — the
 * same shape `tests/unit/main/ipc/system.spec.ts` uses for a missing handler.
 */
// `spawnSync` reports through `error` whenever the command could not be run at
// all, and a binary that is not on PATH is the case that matters here.
const lsofMissing =
  spawnSync("lsof", ["-v"], { stdio: "ignore" }).error !== undefined;
if (lsofMissing) {
  console.warn(
    "[process.spec] lsof is not on PATH — skipping the two end-to-end listener-binding tests",
  );
}

describe.skipIf(lsofMissing)("listener binding through the service", () => {
  it("binds a listener to the repo it runs in", async () => {
    const root = mkdtempSync(join(tmpdir(), "atr-bind-"));
    let child: ChildProcess | null = null;
    try {
      const repo = join(root, "plain-repo");
      mkdirSync(repo, { recursive: true });
      dbState.rows = [{ slug: "plain-slug", full_path: repo }];

      const spawned = await spawnListener(repo);
      child = spawned.child;

      const result = await refreshUntilPort(spawned.port);
      const row = result.processes.find((p) => p.port === spawned.port);
      expect(row, `no row for port ${spawned.port}`).toBeDefined();
      expect(row!.repoSlug).toBe("plain-slug");
    } finally {
      child?.kill("SIGKILL");
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("binds a listener in a repo the catalog holds via a symlink", async () => {
    const root = mkdtempSync(join(tmpdir(), "atr-bind-link-"));
    let child: ChildProcess | null = null;
    try {
      const realRepo = join(root, "real-repo");
      mkdirSync(realRepo, { recursive: true });
      const linkedRepo = join(root, "linked-repo");
      symlinkSync(realRepo, linkedRepo);

      // The catalog holds the path the scanner walked — the symlink.
      dbState.rows = [{ slug: "linked-slug", full_path: linkedRepo }];

      const spawned = await spawnListener(linkedRepo);
      child = spawned.child;

      const result = await refreshUntilPort(spawned.port);
      const row = result.processes.find((p) => p.port === spawned.port);
      expect(row, `no row for port ${spawned.port}`).toBeDefined();
      // lsof reports the kernel's path, which is not the catalog's string.
      expect(row!.cwd).toBe(resolveRealPath(linkedRepo));
      expect(row!.repoSlug).toBe("linked-slug");
    } finally {
      child?.kill("SIGKILL");
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Kill state machine
//
// We mock the global `process.kill`. The state machine should NOT
// progress past SIGINT if SIGINT succeeded and the PID exits before
// the escalateMs window. ESRCH on the first signal returns the noop
// path (after the initial pidAlive check passes).
//
// `processService.kill` reaches out to `ps -p <pid>` for the pidAlive
// probe (via execFile). We stub `process.kill` directly and let the
// `ps` lookups go through real subprocess — but we use a definitely-
// dead PID so `ps` returns empty stdout and pidAlive=false.
// ---------------------------------------------------------------------------

describe("kill state machine", () => {
  it("returns noop when the pid is not alive at entry", async () => {
    // 999_999 is virtually never assigned at the time of test (Linux
    // pid_max default is 32k; macOS default is 99_999 — but if the
    // user's host has scaled pid_max up, this can flake. We pick
    // 999_999_999 (impossible on every POSIX) to make this stable.
    const result = await processService.kill({ pid: 999_999_999 });
    expect(result.finalSignal).toBe("noop");
    expect(result.stopped).toBe(true);
    expect(result.pid).toBe(999_999_999);
  });

  it("returns SIGINT/stopped=true when the first signal succeeds and PID is gone", async () => {
    // Spawn a real, harmless child that listens on a pipe and exits on
    // SIGINT. We avoid `process.kill` mocks for the happy path because
    // the in-service `pidAlive` reads from `ps` — easier to assert via
    // a real living process.
    const { spawn } = await import("node:child_process");
    const child = spawn(
      process.execPath,
      [
        "-e",
        "setInterval(()=>{},10000); process.on('SIGINT',()=>process.exit(0));",
      ],
      { stdio: "ignore" },
    );
    try {
      // Wait for the child to be alive.
      await new Promise((r) => setTimeout(r, 200));
      const pid = child.pid!;
      expect(pid).toBeGreaterThan(0);

      const result = await processService.kill({ pid, escalateMs: 500 });
      expect(result.finalSignal).toBe("SIGINT");
      expect(result.stopped).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }, 10_000);

  it("escalates to SIGTERM when SIGINT is ignored", async () => {
    const { spawn } = await import("node:child_process");
    // Child ignores SIGINT, exits on SIGTERM. It prints "READY" to stdout
    // once both signal handlers are installed so the test can await that
    // marker deterministically instead of racing a fixed sleep (which
    // flakes under full-suite scheduling pressure).
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGINT',()=>{}); process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},10000); process.stdout.write('READY\\n');",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    try {
      // Wait until the child has installed its SIGINT/SIGTERM handlers
      // (signalled by the READY marker on stdout) before we start killing.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("timed out waiting for child READY marker")),
          5_000,
        );
        let buf = "";
        child.stdout!.setEncoding("utf8");
        child.stdout!.on("data", (chunk: string) => {
          buf += chunk;
          if (buf.includes("READY")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      const pid = child.pid!;
      const result = await processService.kill({ pid, escalateMs: 300 });
      expect(result.stopped).toBe(true);
      expect(["SIGTERM", "SIGKILL"]).toContain(result.finalSignal);
    } finally {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }, 10_000);

  it("treats EACCES from process.kill as a thrown error (bubbles out)", async () => {
    // Mock the global process.kill to throw EACCES.
    const original = process.kill;
    const eacces = Object.assign(new Error("EACCES"), {
      code: "EACCES",
    }) as NodeJS.ErrnoException;
    // Need pid to look alive at entry. We use our own pid (init/launcher).
    const selfPid = process.pid;
    let calls = 0;
    (process.kill as unknown as (pid: number, sig?: string) => boolean) = (
      _pid,
      _sig,
    ) => {
      calls++;
      throw eacces;
    };
    try {
      await expect(
        processService.kill({ pid: selfPid, escalateMs: 200 }),
      ).rejects.toThrow(/EACCES/);
      expect(calls).toBeGreaterThanOrEqual(1);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).kill = original;
    }
  }, 10_000);

  it("treats ESRCH from process.kill as a successful kill (PID already gone)", async () => {
    const original = process.kill;
    const esrch = Object.assign(new Error("ESRCH"), {
      code: "ESRCH",
    }) as NodeJS.ErrnoException;
    const selfPid = process.pid;
    (process.kill as unknown as (pid: number, sig?: string) => boolean) = (
      _pid,
      _sig,
    ) => {
      throw esrch;
    };
    try {
      const result = await processService.kill({
        pid: selfPid,
        escalateMs: 200,
      });
      expect(result.stopped).toBe(true);
      expect(result.finalSignal).toBe("SIGINT");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).kill = original;
    }
  }, 10_000);
});
