/**
 * Guard against a dead cache-invalidation key in the renderer.
 *
 * The bug this exists for was invisible in every way a test normally looks. The
 * repo list is stored under `["repos", "list", filters]` (`useRepos` →
 * `queryKeys.repos.list`), but nine call sites invalidated `["catalog"]` — a key
 * no query has ever been registered under. TanStack matches keys by prefix, so
 * `["catalog"]` matched nothing at all and every one of those invalidations was
 * a no-op:
 *
 *   - a finished scan left the grid showing the count it had before (the status
 *     bar said "done", the rows were in SQLite, the grid was empty);
 *   - adding or removing a scan root left the rail's tree stale;
 *   - a move, a folder rename, and the git fetch/pull buttons left the cards
 *     pointing at paths that no longer existed;
 *   - the live `catalog:on:changed` stream never refreshed the grid at all.
 *
 * None of it threw, logged, or failed a typecheck: `invalidateQueries` accepts
 * any key an author types, and an unmatched key is a legal no-op. That is why
 * the check is a source scan rather than a behavioural one — it is the only
 * shape that fails when a *future* call site reintroduces the same typo.
 *
 * `["catalog", "<slice>"]` is still allowed: `moveCheck`, `moveLast` and
 * `folderCheck` are real cache entries under that namespace. Only the bare
 * `["catalog"]` — the key that reached nothing — is banned. Invalidate the repo
 * list with `invalidateRepoList(queryClient)` from `@renderer/lib/query-client`.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { queryKeys } from "@renderer/lib/query-client";

const RENDERER = path.resolve(__dirname, "..", "..", "..", "src", "renderer");

/** The exact spelling that reached no query: a one-element `["catalog"]`. */
const DEAD_KEY = '["catalog"]';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("the catalog invalidation key", () => {
  test("no renderer file invalidates the bare `[\"catalog\"]` key", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(RENDERER)) {
      const text = fs.readFileSync(file, "utf8");
      if (text.includes(DEAD_KEY)) {
        const line = text.split("\n").findIndex((l) => l.includes(DEAD_KEY)) + 1;
        offenders.push(`${path.relative(RENDERER, file)}:${line}`);
      }
    }
    expect(
      offenders,
      "these invalidate or target [\"catalog\"], which no query is registered " +
        "under — use invalidateRepoList(queryClient) for the repo list, or " +
        `queryKeys.repos.all to target it directly: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  test("the repo-list prefix actually reaches the key `useRepos` registers", () => {
    // The other half of the guard: a source scan can only say what the call
    // sites *look* like. This asserts the seam they use reaches the entry the
    // catalog sidebar actually stores — so if either side is renamed without
    // the other, this fails rather than the grid silently going stale again.
    const listKey = queryKeys.repos.list({ limit: 200 });
    expect(listKey.slice(0, queryKeys.repos.all.length)).toEqual([
      ...queryKeys.repos.all,
    ]);
    // And the dead key is not a prefix of it, so the old spelling could never
    // have worked — this is what makes the first test worth having.
    expect(listKey[0]).not.toBe("catalog");
  });
});
