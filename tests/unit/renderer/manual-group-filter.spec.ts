/**
 * Unit test for the manual-group membership filter (ATR-011).
 *
 * Environment constraints (same as `use-set-repo-tags.spec.ts`):
 *   - vitest runs `environment: "node"`, single-fork — no jsdom.
 *   - The renderer's runtime deps (`@tanstack/react-query`, React DOM)
 *     do not resolve / render under bare vitest, so this spec imports
 *     NOTHING from app code or UI deps. It re-implements the two pieces
 *     of pure logic the fix introduces and pins their contract:
 *
 *       1. `useGroupMemberSlugs`'s queryFn: read `catalog:list({ groupId })`
 *          to completion — a 200-row page at a time — and project the items
 *          down to a `Set<slug>`.
 *       2. `browseRepos`'s `groupMembership` predicate: for a MANUAL group
 *          a repo matches IFF its slug is in the member set; while the set
 *          is still loading (`null`) NOTHING matches (the original bug was
 *          "show everything"); smart groups use their `smartFilter`; and
 *          "All repos" (groupId === null) shows everything.
 *
 * KEEP IN LOCKSTEP with:
 *   - `src/renderer/hooks/use-groups.ts` (`useGroupMemberSlugs`)
 *   - `src/renderer/hooks/use-repos.ts` (`readAllRepos` paging)
 *   - `src/renderer/components/catalog/catalog-shell.tsx` (`groupMembership`)
 */

import { describe, expect, it } from "vitest";

// --- Minimal entity mirrors ----------------------------------------------

interface SmartFilterLite {
  language?: string;
  dirtyOnly?: boolean;
  hasRemote?: boolean;
  tagsInclude?: string[];
  tagsExclude?: string[];
  sinceDays?: number;
}
interface GroupLite {
  id: number;
  isSmart: boolean;
  smartFilter: SmartFilterLite | null;
}
interface RepoLite {
  slug: string;
  primaryLanguage: string | null;
  isDirty: boolean;
  remoteUrl: string | null;
  tags: { value: string }[];
  lastCommitDate: string | null;
}
interface ListReposResultLite {
  items: { slug: string }[];
  total?: number;
}

/** The contract's per-request ceiling, mirrored from `readAllRepos`. */
const CATALOG_PAGE_SIZE = 200;

function repo(slug: string, over: Partial<RepoLite> = {}): RepoLite {
  return {
    slug,
    primaryLanguage: null,
    isDirty: false,
    remoteUrl: null,
    tags: [],
    lastCommitDate: null,
    ...over,
  };
}

// --- (1) useGroupMemberSlugs queryFn, reproduced --------------------------

/**
 * Mirrors the queryFn in `useGroupMemberSlugs` — which reads the group through
 * `readAllRepos`, so a group larger than one page is read in full rather than
 * truncated at row 200.
 */
async function fetchMemberSlugs(
  list: (input: {
    groupId: number;
    limit: number;
    offset: number;
  }) => Promise<ListReposResultLite>,
  groupId: number,
): Promise<Set<string>> {
  const first = await list({ groupId, limit: CATALOG_PAGE_SIZE, offset: 0 });
  const slugs = first.items.map((r) => r.slug);
  // A fake with no `total` is a single complete page, matching a real reply
  // whose total equals its item count.
  const total = first.total ?? slugs.length;
  while (slugs.length < total) {
    const next = await list({
      groupId,
      limit: CATALOG_PAGE_SIZE,
      offset: slugs.length,
    });
    if (next.items.length === 0) break;
    slugs.push(...next.items.map((r) => r.slug));
  }
  return new Set(slugs);
}

// --- (2) groupMembership predicate, reproduced ----------------------------

/**
 * Mirrors `browseRepos`'s `groupMembership` in catalog-shell.tsx.
 * `groupId === null` => All repos. Smart groups evaluate `smartFilter`.
 * Manual groups intersect with `manualMemberSlugs` (null = still loading
 * => match nothing).
 */
function groupMembership(
  r: RepoLite,
  groupId: number | null,
  groups: GroupLite[],
  manualMemberSlugs: Set<string> | null,
): boolean {
  if (groupId === null) return true;
  const g = groups.find((x) => x.id === groupId);
  if (!g) return true;
  if (g.isSmart) {
    // A smart group with no filter is unconstrained → matches everything,
    // and must NOT fall through to the manual member-set path.
    const f = g.smartFilter;
    if (!f) return true;
    if (f.language && r.primaryLanguage !== f.language) return false;
    if (f.dirtyOnly && !r.isDirty) return false;
    if (f.hasRemote !== undefined && !!r.remoteUrl !== f.hasRemote)
      return false;
    if (f.tagsInclude?.length) {
      const have = new Set(r.tags.map((t) => t.value));
      if (!f.tagsInclude.every((t) => have.has(t))) return false;
    }
    return true;
  }
  return manualMemberSlugs?.has(r.slug) ?? false;
}

// --- Tests ----------------------------------------------------------------

describe("useGroupMemberSlugs queryFn (catalog:list by groupId)", () => {
  it("requests the contract max and projects items to a slug set", async () => {
    const calls: Array<{ groupId: number; limit: number; offset: number }> = [];
    const list = async (input: {
      groupId: number;
      limit: number;
      offset: number;
    }) => {
      calls.push(input);
      return { items: [{ slug: "alpha" }, { slug: "beta" }] };
    };

    const slugs = await fetchMemberSlugs(list, 7);

    expect(calls).toEqual([{ groupId: 7, limit: 200, offset: 0 }]);
    expect(slugs).toEqual(new Set(["alpha", "beta"]));
  });

  it("pages past the 200-row ceiling instead of truncating a large group", async () => {
    // A group of 450: one 200-row page is not the group, and a consumer that
    // stopped at page one would strand 250 members (ATR-042).
    const calls: Array<{ groupId: number; limit: number; offset: number }> = [];
    const all = Array.from({ length: 450 }, (_, i) => ({ slug: `repo-${i}` }));
    const list = async (input: {
      groupId: number;
      limit: number;
      offset: number;
    }) => {
      calls.push(input);
      return {
        items: all.slice(input.offset, input.offset + input.limit),
        total: all.length,
      };
    };

    const slugs = await fetchMemberSlugs(list, 3);

    expect(calls).toEqual([
      { groupId: 3, limit: 200, offset: 0 },
      { groupId: 3, limit: 200, offset: 200 },
      { groupId: 3, limit: 200, offset: 400 },
    ]);
    expect(slugs.size).toBe(450);
    expect(slugs.has("repo-449")).toBe(true);
  });

  it("yields an empty set for a group with no members", async () => {
    const list = async () => ({ items: [] });
    expect(await fetchMemberSlugs(list, 1)).toEqual(new Set());
  });
});

describe("groupMembership — manual-group filtering (ATR-011)", () => {
  const manualGroup: GroupLite = { id: 1, isSmart: false, smartFilter: null };
  const smartGroup: GroupLite = {
    id: 2,
    isSmart: true,
    smartFilter: { language: "TypeScript" },
  };
  const groups = [manualGroup, smartGroup];

  const ts = repo("ts-repo", { primaryLanguage: "TypeScript" });
  const go = repo("go-repo", { primaryLanguage: "Go" });

  it("All repos (groupId null) shows everything", () => {
    expect(groupMembership(ts, null, groups, null)).toBe(true);
    expect(groupMembership(go, null, groups, null)).toBe(true);
  });

  it("restricts a manual group to its member slugs (the bug fix)", () => {
    const members = new Set(["ts-repo"]);
    expect(groupMembership(ts, 1, groups, members)).toBe(true);
    // The original bug returned `true` here ("assume matches"); a non-member
    // must now be excluded.
    expect(groupMembership(go, 1, groups, members)).toBe(false);
  });

  it("matches nothing while the member set is still loading (null)", () => {
    // Loading state must NOT fall back to showing the whole catalog.
    expect(groupMembership(ts, 1, groups, null)).toBe(false);
    expect(groupMembership(go, 1, groups, null)).toBe(false);
  });

  it("smart groups keep evaluating their smartFilter regardless of member set", () => {
    // Member set is irrelevant for smart groups.
    expect(groupMembership(ts, 2, groups, null)).toBe(true);
    expect(groupMembership(go, 2, groups, null)).toBe(false);
  });

  it("an unknown groupId falls through to match (defensive)", () => {
    expect(groupMembership(ts, 999, groups, null)).toBe(true);
  });

  it("a smart group with a null filter matches everything (no member-set fallback)", () => {
    // Regression guard: a smart group whose `smartFilter` is null is
    // unconstrained. It must NOT fall through to the manual member-set
    // branch — that branch sees `manualMemberSlugs === null` (the set is
    // never fetched for a smart group) and would otherwise strand the
    // group on an empty grid.
    const filterlessSmart: GroupLite = {
      id: 3,
      isSmart: true,
      smartFilter: null,
    };
    const withGroup = [...groups, filterlessSmart];
    expect(groupMembership(ts, 3, withGroup, null)).toBe(true);
    expect(groupMembership(go, 3, withGroup, null)).toBe(true);
  });
});
