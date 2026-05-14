/**
 * Token-usage rollup helpers.
 *
 * Given the cached `ClaudeSession[]` flattened across all projects,
 * roll up token totals by:
 *   - total              (sum)
 *   - project hash       (sorted desc by tokens)
 *   - day                (YYYY-MM-DD, zero-filled within range)
 *   - week               (ISO Monday-start YYYY-MM-DD, zero-filled)
 *   - month              (YYYY-MM-01, zero-filled)
 *
 * Date filtering uses `lastActivityAt`. Sessions with a null
 * `lastActivityAt` are included in the total but contribute no
 * day/week/month bucket.
 *
 * All buckets are derived from session.lastActivityAt's UTC date
 * portion — we intentionally don't try to localize because the
 * renderer should choose how to render dates.
 */

import type { ClaudeGlobalUsageResult, ClaudeSession } from "@shared/types";

import type { ClaudeRegistry } from "./registry";

/**
 * Inputs the rollup needs from the service. Kept narrow so unit
 * tests can build it without instantiating the full service.
 */
export interface RollupInputs {
  sessions: ClaudeSession[];
  registry: ClaudeRegistry;
  /** Optional inclusive ISO-8601 date string `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  /** Optional slug lookup so byProject can carry repoSlug. */
  slugByPath?: (repoPath: string) => string | null;
}

/**
 * Build the full `claude:globalUsage` payload from a flat session
 * list + the registry. Pure — no I/O.
 */
export function rollupUsage(input: RollupInputs): ClaudeGlobalUsageResult {
  const { sessions, registry, from, to, slugByPath } = input;
  const fromBound = from ? toDayString(from) : null;
  const toBound = to ? toDayString(to) : null;

  // ---- Filter -----------------------------------------------------------
  const filtered: ClaudeSession[] = [];
  for (const session of sessions) {
    if (session.lastActivityAt == null) {
      filtered.push(session);
      continue;
    }
    const day = toDayString(session.lastActivityAt);
    if (!day) {
      filtered.push(session);
      continue;
    }
    if (fromBound && day < fromBound) continue;
    if (toBound && day > toBound) continue;
    filtered.push(session);
  }

  // ---- Total ------------------------------------------------------------
  let totalTokens = 0;
  for (const s of filtered) totalTokens += s.tokenUsage.totalTokens;

  // ---- By project -------------------------------------------------------
  const byProjectMap = new Map<
    string,
    {
      hash: string;
      repoPath: string;
      repoSlug: string | null;
      totalTokens: number;
    }
  >();
  for (const session of filtered) {
    const hash = session.projectHash;
    const repoPath = registry.reverse.get(hash) ?? "";
    if (!repoPath) continue; // skip orphaned sessions with no registry entry
    let entry = byProjectMap.get(hash);
    if (!entry) {
      entry = {
        hash,
        repoPath,
        repoSlug: slugByPath ? slugByPath(repoPath) : null,
        totalTokens: 0,
      };
      byProjectMap.set(hash, entry);
    }
    entry.totalTokens += session.tokenUsage.totalTokens;
  }
  const byProject = Array.from(byProjectMap.values()).sort(
    (a, b) => b.totalTokens - a.totalTokens,
  );

  // ---- Time buckets -----------------------------------------------------
  const datedSessions: { date: string; tokens: number }[] = [];
  for (const session of filtered) {
    if (!session.lastActivityAt) continue;
    const day = toDayString(session.lastActivityAt);
    if (!day) continue;
    datedSessions.push({ date: day, tokens: session.tokenUsage.totalTokens });
  }

  const rangeStart =
    fromBound ??
    earliestDate(datedSessions) ??
    toDayString(new Date().toISOString());
  const rangeEnd =
    toBound ??
    latestDate(datedSessions) ??
    toDayString(new Date().toISOString());

  const byDay = bucketByDay(datedSessions, rangeStart, rangeEnd);
  const byWeek = bucketByWeek(datedSessions, rangeStart, rangeEnd);
  const byMonth = bucketByMonth(datedSessions, rangeStart, rangeEnd);

  return { totalTokens, byProject, byDay, byWeek, byMonth };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Normalize any ISO-ish string into a `YYYY-MM-DD` (UTC). Returns
 * null on parse failure.
 */
function toDayString(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // Accept both raw `YYYY-MM-DD` and full ISO strings.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function earliestDate(rows: { date: string }[]): string | null {
  if (rows.length === 0) return null;
  let min = rows[0].date;
  for (const r of rows) if (r.date < min) min = r.date;
  return min;
}

function latestDate(rows: { date: string }[]): string | null {
  if (rows.length === 0) return null;
  let max = rows[0].date;
  for (const r of rows) if (r.date > max) max = r.date;
  return max;
}

function parseDay(day: string): Date {
  // Force UTC midnight to avoid TZ drift.
  return new Date(`${day}T00:00:00.000Z`);
}

function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function bucketByDay(
  rows: { date: string; tokens: number }[],
  start: string | null,
  end: string | null,
): ClaudeGlobalUsageResult["byDay"] {
  if (!start || !end || start > end) return [];
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.date < start || r.date > end) continue;
    totals.set(r.date, (totals.get(r.date) ?? 0) + r.tokens);
  }
  const out: { date: string; totalTokens: number }[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push({ date: cursor, totalTokens: totals.get(cursor) ?? 0 });
    cursor = addDays(cursor, 1);
  }
  return out;
}

/**
 * ISO-week Monday-start. Sunday becomes the start of NEXT week's
 * Monday minus 6 days — standard JS UTC math.
 */
function weekStart(day: string): string {
  const d = parseDay(day);
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat. Shift Sun -> 7 so Monday is 1.
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

function bucketByWeek(
  rows: { date: string; tokens: number }[],
  start: string | null,
  end: string | null,
): ClaudeGlobalUsageResult["byWeek"] {
  if (!start || !end || start > end) return [];
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.date < start || r.date > end) continue;
    const wk = weekStart(r.date);
    totals.set(wk, (totals.get(wk) ?? 0) + r.tokens);
  }
  const out: { weekStart: string; totalTokens: number }[] = [];
  let cursor = weekStart(start);
  const endCursor = weekStart(end);
  while (cursor <= endCursor) {
    out.push({ weekStart: cursor, totalTokens: totals.get(cursor) ?? 0 });
    cursor = addDays(cursor, 7);
  }
  return out;
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function nextMonth(monthStartStr: string): string {
  const d = parseDay(monthStartStr);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function bucketByMonth(
  rows: { date: string; tokens: number }[],
  start: string | null,
  end: string | null,
): ClaudeGlobalUsageResult["byMonth"] {
  if (!start || !end || start > end) return [];
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.date < start || r.date > end) continue;
    const m = monthStart(r.date);
    totals.set(m, (totals.get(m) ?? 0) + r.tokens);
  }
  const out: { monthStart: string; totalTokens: number }[] = [];
  let cursor = monthStart(start);
  const endCursor = monthStart(end);
  while (cursor <= endCursor) {
    out.push({ monthStart: cursor, totalTokens: totals.get(cursor) ?? 0 });
    cursor = nextMonth(cursor);
  }
  return out;
}
