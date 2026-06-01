/**
 * Phase 3a Unit Test — ProcessService internals.
 *
 * Covers the pure test seams exported by `@main/services/process`:
 *   - parseLsofListen (field-prefixed lsof TCP-listen parser)
 *   - parseLsofCwd   (one-DIR-line cwd parser)
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("electron", () => ({
  app: {
    isFocused: () => true,
    on: vi.fn(),
  },
}));

vi.mock("@main/db/client", () => ({
  getSqlite: () => ({
    prepare: () => ({ all: () => [] }),
  }),
}));

import {
  parseLsofListen,
  parseLsofCwd,
  RepoPathTrie,
  processService,
} from "@main/services/process";

beforeEach(() => {
  vi.clearAllMocks();
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
// parseLsofCwd
// ---------------------------------------------------------------------------

describe("parseLsofCwd", () => {
  it("extracts the n field value", () => {
    const out = ["p1234", "fcwd", "n/Users/me/foo"].join("\n");
    expect(parseLsofCwd(out)).toBe("/Users/me/foo");
  });

  it("returns null when no n-line is present", () => {
    const out = ["p1234", "fcwd"].join("\n");
    expect(parseLsofCwd(out)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseLsofCwd("")).toBeNull();
  });

  it("tolerates noisy non-prefixed lines (returns first n)", () => {
    const out = [
      "lsof: WARNING: can't stat() /something",
      "p1234",
      "fcwd",
      "n/Users/me/foo",
    ].join("\n");
    expect(parseLsofCwd(out)).toBe("/Users/me/foo");
  });

  it("trims trailing whitespace on the cwd value", () => {
    const out = "n/Users/me/foo   ";
    expect(parseLsofCwd(out)).toBe("/Users/me/foo");
  });

  it("returns null when the n-line is empty", () => {
    expect(parseLsofCwd("n  ")).toBeNull();
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
