/**
 * Phase 3b Unit Test — token-usage rollup helper.
 *
 * Covers:
 *   - rollupUsage produces totalTokens summed across filtered sessions.
 *   - byProject sorted desc by tokens, repoSlug resolved via slugByPath.
 *   - byDay zero-filled over [from, to] inclusive.
 *   - byWeek keyed on Monday-start UTC.
 *   - byMonth keyed on YYYY-MM-01.
 *   - Sessions with null lastActivityAt are included in totalTokens but
 *     contribute no time-bucket rows.
 *   - Orphan sessions (projectHash not in registry) excluded from
 *     byProject but still count toward totalTokens.
 *   - from/to range filter excludes out-of-range sessions.
 *
 * Owner: qe-agent (Phase 3b).
 */

import { describe, it, expect } from "vitest";

import { rollupUsage } from "@main/claude/usage";
import type { ClaudeSession } from "@shared/types";
import type { ClaudeRegistry } from "@main/claude/registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkSession(opts: {
  id: string;
  projectHash: string;
  lastActivityAt: string | null;
  totalTokens: number;
}): ClaudeSession {
  return {
    id: opts.id,
    projectHash: opts.projectHash,
    startedAt: opts.lastActivityAt,
    lastActivityAt: opts.lastActivityAt,
    messageCount: 1,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: opts.totalTokens,
    },
    filePath: `/tmp/${opts.id}.jsonl`,
    sizeBytes: 1,
  };
}

function mkRegistry(
  pairs: { hash: string; repoPath: string }[],
): ClaudeRegistry {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();
  const entries = pairs.map(({ hash, repoPath }) => {
    forward.set(repoPath, hash);
    reverse.set(hash, repoPath);
    return { hash, repoPath };
  });
  return { forward, reverse, entries };
}

// ---------------------------------------------------------------------------
// totalTokens + byProject
// ---------------------------------------------------------------------------

describe("rollupUsage — total + byProject", () => {
  it("sums totalTokens across all sessions", () => {
    const registry = mkRegistry([
      { hash: "h1", repoPath: "/r/one" },
      { hash: "h2", repoPath: "/r/two" },
    ]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "a",
          projectHash: "h1",
          lastActivityAt: "2026-05-01T10:00:00.000Z",
          totalTokens: 100,
        }),
        mkSession({
          id: "b",
          projectHash: "h2",
          lastActivityAt: "2026-05-01T10:00:00.000Z",
          totalTokens: 250,
        }),
      ],
      registry,
    });
    expect(out.totalTokens).toBe(350);
  });

  it("byProject is sorted descending by totalTokens", () => {
    const registry = mkRegistry([
      { hash: "h-small", repoPath: "/r/small" },
      { hash: "h-big", repoPath: "/r/big" },
      { hash: "h-mid", repoPath: "/r/mid" },
    ]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "1",
          projectHash: "h-small",
          lastActivityAt: "2026-05-01T10:00:00.000Z",
          totalTokens: 10,
        }),
        mkSession({
          id: "2",
          projectHash: "h-big",
          lastActivityAt: "2026-05-01T10:00:00.000Z",
          totalTokens: 1000,
        }),
        mkSession({
          id: "3",
          projectHash: "h-mid",
          lastActivityAt: "2026-05-01T10:00:00.000Z",
          totalTokens: 500,
        }),
      ],
      registry,
    });
    expect(out.byProject.map((p) => p.hash)).toEqual([
      "h-big",
      "h-mid",
      "h-small",
    ]);
  });

  it("resolves repoSlug via slugByPath", () => {
    const registry = mkRegistry([{ hash: "h1", repoPath: "/r/one" }]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "1",
          projectHash: "h1",
          lastActivityAt: "2026-05-01T10:00:00.000Z",
          totalTokens: 50,
        }),
      ],
      registry,
      slugByPath: (p) => (p === "/r/one" ? "one-slug" : null),
    });
    expect(out.byProject[0]!.repoSlug).toBe("one-slug");
  });

  it("excludes orphan sessions (hash not in registry) from byProject but counts them in totalTokens", () => {
    const registry = mkRegistry([{ hash: "h1", repoPath: "/r/one" }]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "1",
          projectHash: "h1",
          lastActivityAt: "2026-05-01T10:00:00.000Z",
          totalTokens: 100,
        }),
        mkSession({
          id: "orphan",
          projectHash: "h-missing",
          lastActivityAt: "2026-05-01T10:00:00.000Z",
          totalTokens: 999,
        }),
      ],
      registry,
    });
    expect(out.totalTokens).toBe(1099);
    expect(out.byProject).toHaveLength(1);
    expect(out.byProject[0]!.hash).toBe("h1");
  });

  it("sessions with null lastActivityAt are counted in totalTokens but excluded from time buckets", () => {
    const registry = mkRegistry([{ hash: "h1", repoPath: "/r/one" }]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "active",
          projectHash: "h1",
          lastActivityAt: "2026-05-01T10:00:00.000Z",
          totalTokens: 100,
        }),
        mkSession({
          id: "no-time",
          projectHash: "h1",
          lastActivityAt: null,
          totalTokens: 50,
        }),
      ],
      registry,
    });
    expect(out.totalTokens).toBe(150);
    // byDay should ONLY include 2026-05-01 (one entry, 100 tokens)
    const dayTotal = out.byDay.reduce((sum, d) => sum + d.totalTokens, 0);
    expect(dayTotal).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// byDay zero-fill
// ---------------------------------------------------------------------------

describe("rollupUsage — byDay zero-fill", () => {
  it("zero-fills every day between from and to inclusive", () => {
    const registry = mkRegistry([{ hash: "h1", repoPath: "/r/one" }]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "1",
          projectHash: "h1",
          lastActivityAt: "2026-05-02T10:00:00.000Z",
          totalTokens: 100,
        }),
      ],
      registry,
      from: "2026-05-01",
      to: "2026-05-04",
    });
    expect(out.byDay.map((d) => d.date)).toEqual([
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
      "2026-05-04",
    ]);
    expect(out.byDay.find((d) => d.date === "2026-05-01")!.totalTokens).toBe(0);
    expect(out.byDay.find((d) => d.date === "2026-05-02")!.totalTokens).toBe(
      100,
    );
    expect(out.byDay.find((d) => d.date === "2026-05-03")!.totalTokens).toBe(0);
  });

  it("falls back to session range when from/to omitted", () => {
    const registry = mkRegistry([{ hash: "h1", repoPath: "/r/one" }]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "1",
          projectHash: "h1",
          lastActivityAt: "2026-05-01T10:00:00.000Z",
          totalTokens: 10,
        }),
        mkSession({
          id: "2",
          projectHash: "h1",
          lastActivityAt: "2026-05-03T10:00:00.000Z",
          totalTokens: 30,
        }),
      ],
      registry,
    });
    expect(out.byDay.map((d) => d.date)).toEqual([
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
    ]);
  });

  it("excludes sessions outside the from/to range", () => {
    const registry = mkRegistry([{ hash: "h1", repoPath: "/r/one" }]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "before",
          projectHash: "h1",
          lastActivityAt: "2026-04-29T10:00:00.000Z",
          totalTokens: 999,
        }),
        mkSession({
          id: "in",
          projectHash: "h1",
          lastActivityAt: "2026-05-02T10:00:00.000Z",
          totalTokens: 50,
        }),
        mkSession({
          id: "after",
          projectHash: "h1",
          lastActivityAt: "2026-05-15T10:00:00.000Z",
          totalTokens: 999,
        }),
      ],
      registry,
      from: "2026-05-01",
      to: "2026-05-10",
    });
    expect(out.totalTokens).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// byWeek keyed on Monday
// ---------------------------------------------------------------------------

describe("rollupUsage — byWeek (Monday-start)", () => {
  it("buckets dates into Monday-keyed weeks", () => {
    // 2026-05-04 is Monday, 2026-05-05 Tuesday → both in same bucket.
    const registry = mkRegistry([{ hash: "h1", repoPath: "/r/one" }]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "mon",
          projectHash: "h1",
          lastActivityAt: "2026-05-04T08:00:00.000Z",
          totalTokens: 10,
        }),
        mkSession({
          id: "tue",
          projectHash: "h1",
          lastActivityAt: "2026-05-05T08:00:00.000Z",
          totalTokens: 20,
        }),
      ],
      registry,
      from: "2026-05-04",
      to: "2026-05-10",
    });
    expect(out.byWeek.length).toBeGreaterThan(0);
    const mondayBucket = out.byWeek.find((w) => w.weekStart === "2026-05-04")!;
    expect(mondayBucket).toBeTruthy();
    expect(mondayBucket.totalTokens).toBe(30);
  });

  it("shifts a Sunday into the prior Monday's week", () => {
    // 2026-05-10 is a Sunday → weekStart should be 2026-05-04.
    const registry = mkRegistry([{ hash: "h1", repoPath: "/r/one" }]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "sun",
          projectHash: "h1",
          lastActivityAt: "2026-05-10T08:00:00.000Z",
          totalTokens: 77,
        }),
      ],
      registry,
      from: "2026-05-04",
      to: "2026-05-10",
    });
    const mondayBucket = out.byWeek.find((w) => w.weekStart === "2026-05-04")!;
    expect(mondayBucket).toBeTruthy();
    expect(mondayBucket.totalTokens).toBe(77);
  });
});

// ---------------------------------------------------------------------------
// byMonth keyed on YYYY-MM-01
// ---------------------------------------------------------------------------

describe("rollupUsage — byMonth (YYYY-MM-01)", () => {
  it("buckets dates into month-start keys", () => {
    const registry = mkRegistry([{ hash: "h1", repoPath: "/r/one" }]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "may",
          projectHash: "h1",
          lastActivityAt: "2026-05-15T08:00:00.000Z",
          totalTokens: 100,
        }),
        mkSession({
          id: "jun",
          projectHash: "h1",
          lastActivityAt: "2026-06-02T08:00:00.000Z",
          totalTokens: 200,
        }),
      ],
      registry,
      from: "2026-05-01",
      to: "2026-06-30",
    });
    const mayBucket = out.byMonth.find((m) => m.monthStart === "2026-05-01")!;
    const junBucket = out.byMonth.find((m) => m.monthStart === "2026-06-01")!;
    expect(mayBucket.totalTokens).toBe(100);
    expect(junBucket.totalTokens).toBe(200);
  });

  it("zero-fills months without sessions", () => {
    const registry = mkRegistry([{ hash: "h1", repoPath: "/r/one" }]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "may",
          projectHash: "h1",
          lastActivityAt: "2026-05-15T08:00:00.000Z",
          totalTokens: 100,
        }),
      ],
      registry,
      from: "2026-03-01",
      to: "2026-07-01",
    });
    const monthKeys = out.byMonth.map((m) => m.monthStart);
    expect(monthKeys).toEqual([
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
    ]);
    expect(
      out.byMonth.find((m) => m.monthStart === "2026-03-01")!.totalTokens,
    ).toBe(0);
    expect(
      out.byMonth.find((m) => m.monthStart === "2026-05-01")!.totalTokens,
    ).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Per-project weekly series (ATR-020)
// ---------------------------------------------------------------------------

describe("rollupUsage — per-project byWeek (ATR-020)", () => {
  it("attaches each project's OWN weekly series, aligned with the global range", () => {
    const registry = mkRegistry([
      { hash: "h1", repoPath: "/r/one" },
      { hash: "h2", repoPath: "/r/two" },
    ]);
    const out = rollupUsage({
      sessions: [
        // h1: 100 in week of 2026-05-04 (Monday)
        mkSession({
          id: "a",
          projectHash: "h1",
          lastActivityAt: "2026-05-04T10:00:00.000Z",
          totalTokens: 100,
        }),
        // h2: 200 in week of 2026-05-11 (Monday)
        mkSession({
          id: "b",
          projectHash: "h2",
          lastActivityAt: "2026-05-11T10:00:00.000Z",
          totalTokens: 200,
        }),
      ],
      registry,
      from: "2026-05-04",
      to: "2026-05-17",
    });

    // Both projects share the SAME week keys as the global byWeek so a
    // renderer can line them up.
    const globalWeeks = out.byWeek.map((w) => w.weekStart);
    for (const proj of out.byProject) {
      expect(proj.byWeek).toBeDefined();
      expect(proj.byWeek!.map((w) => w.weekStart)).toEqual(globalWeeks);
    }

    const h1 = out.byProject.find((p) => p.hash === "h1")!;
    const h2 = out.byProject.find((p) => p.hash === "h2")!;

    // h1 has 100 in the first week, 0 in the second.
    expect(
      h1.byWeek!.find((w) => w.weekStart === "2026-05-04")!.totalTokens,
    ).toBe(100);
    expect(
      h1.byWeek!.find((w) => w.weekStart === "2026-05-11")!.totalTokens,
    ).toBe(0);
    // h2 has 0 in the first week, 200 in the second.
    expect(
      h2.byWeek!.find((w) => w.weekStart === "2026-05-04")!.totalTokens,
    ).toBe(0);
    expect(
      h2.byWeek!.find((w) => w.weekStart === "2026-05-11")!.totalTokens,
    ).toBe(200);
  });

  it("per-project weekly totals sum to the global weekly totals", () => {
    const registry = mkRegistry([
      { hash: "h1", repoPath: "/r/one" },
      { hash: "h2", repoPath: "/r/two" },
    ]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "a",
          projectHash: "h1",
          lastActivityAt: "2026-05-04T10:00:00.000Z",
          totalTokens: 100,
        }),
        mkSession({
          id: "b",
          projectHash: "h2",
          lastActivityAt: "2026-05-04T12:00:00.000Z",
          totalTokens: 250,
        }),
      ],
      registry,
      from: "2026-05-04",
      to: "2026-05-10",
    });
    const monday = "2026-05-04";
    const globalMonday = out.byWeek.find((w) => w.weekStart === monday)!;
    const perProjectSum = out.byProject.reduce((acc, p) => {
      const wk = p.byWeek!.find((w) => w.weekStart === monday);
      return acc + (wk?.totalTokens ?? 0);
    }, 0);
    expect(perProjectSum).toBe(globalMonday.totalTokens);
    expect(globalMonday.totalTokens).toBe(350);
  });

  it("gives a project with no dated sessions a zero-filled series (no fabrication)", () => {
    // A project whose only session has a null lastActivityAt contributes
    // tokens to byProject.totalTokens but produces a flat (all-zero)
    // weekly series.
    const registry = mkRegistry([
      { hash: "h1", repoPath: "/r/one" },
      { hash: "h2", repoPath: "/r/two" },
    ]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "dated",
          projectHash: "h1",
          lastActivityAt: "2026-05-04T10:00:00.000Z",
          totalTokens: 100,
        }),
        mkSession({
          id: "undated",
          projectHash: "h2",
          lastActivityAt: null,
          totalTokens: 999,
        }),
      ],
      registry,
      from: "2026-05-04",
      to: "2026-05-10",
    });
    const h2 = out.byProject.find((p) => p.hash === "h2")!;
    expect(h2.totalTokens).toBe(999);
    expect(h2.byWeek).toBeDefined();
    // Every bucket is zero — a flat sparkline, not a scaled fake.
    expect(h2.byWeek!.every((w) => w.totalTokens === 0)).toBe(true);
  });

  it("excludes out-of-range sessions from the per-project weekly series", () => {
    const registry = mkRegistry([{ hash: "h1", repoPath: "/r/one" }]);
    const out = rollupUsage({
      sessions: [
        mkSession({
          id: "in",
          projectHash: "h1",
          lastActivityAt: "2026-05-05T10:00:00.000Z",
          totalTokens: 50,
        }),
        mkSession({
          id: "after",
          projectHash: "h1",
          lastActivityAt: "2026-06-01T10:00:00.000Z",
          totalTokens: 999,
        }),
      ],
      registry,
      from: "2026-05-04",
      to: "2026-05-10",
    });
    const h1 = out.byProject.find((p) => p.hash === "h1")!;
    const seriesSum = h1.byWeek!.reduce((acc, w) => acc + w.totalTokens, 0);
    // The out-of-range session is filtered before bucketing, so the
    // weekly series only carries the in-range 50.
    expect(seriesSum).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

describe("rollupUsage — empty inputs", () => {
  it("returns 0 totalTokens + empty byProject when sessions is empty", () => {
    const registry = mkRegistry([]);
    const out = rollupUsage({ sessions: [], registry });
    expect(out.totalTokens).toBe(0);
    expect(out.byProject).toEqual([]);
    // byDay/byWeek/byMonth might be derived from "today" — just confirm
    // they don't crash and aren't undefined.
    expect(Array.isArray(out.byDay)).toBe(true);
    expect(Array.isArray(out.byWeek)).toBe(true);
    expect(Array.isArray(out.byMonth)).toBe(true);
  });
});
