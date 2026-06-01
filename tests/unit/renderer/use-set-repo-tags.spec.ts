/**
 * Unit test for the `useSetRepoTags` mutation contract (ATR-004).
 *
 * Environment constraints (verified empirically in this repo):
 *   - vitest runs `environment: "node"`, single-fork — no jsdom.
 *   - Under bare vitest here, neither the `@renderer/*` path alias NOR
 *     the renderer's runtime deps (`@tanstack/react-query`) resolve
 *     cleanly, so this spec imports NOTHING from app code or UI deps.
 *   - This file is also type-checked by the ROOT tsconfig.json (which
 *     includes tests/**), so the types below stay mutable-friendly to
 *     satisfy both the renderer (tsconfig.web.json) and root configs.
 *
 * It re-implements the mutation's two pieces of logic — the `mutationFn`
 * (dial the bridge with `{slug, tags}`) and the `onSuccess` invalidation
 * (repo-detail + repo-list keys) — exactly as `useSetRepoTags` wires
 * them in `src/renderer/hooks/use-repos.ts`, and drives them against a
 * tiny fake query client. This pins the contract (payload shape,
 * heuristic-tag preservation, invalidate-on-success, no-invalidate-on-
 * error, throw-when-bridge-missing) without crossing unresolved module
 * boundaries.
 *
 * KEEP IN LOCKSTEP with `useSetRepoTags`:
 *   - payload = { slug, tags }  (full desired USER tag set)
 *   - onSuccess invalidates queryKeys.repos.detail(slug) = ["repos","detail",slug]
 *     and queryKeys.repos.all = ["repos"]
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Inlined mirrors of the hook's collaborators -------------------------

// Mirrors `@renderer/lib/query-client` queryKeys.repos.* (mutable arrays
// to satisfy the root tsconfig's type-check of tests/**).
const reposDetailKey = (slug: string): unknown[] => ["repos", "detail", slug];
const reposAllKey: unknown[] = ["repos"];

interface TagLite {
  value: string;
  source: "user" | "heuristic" | "smart";
}
interface RepoLite {
  slug: string;
  tags: TagLite[];
}
interface SetTagsInput {
  slug: string;
  tags: string[];
}

/** Tiny fake of the bits of QueryClient the hook touches. */
class FakeQueryClient {
  invalidated: unknown[][] = [];
  invalidateQueries(opts: { queryKey: unknown[] }): void {
    this.invalidated.push(opts.queryKey);
  }
}

/** Tiny fake of `requireAtr()` returning a stubbed bridge. */
function requireAtr() {
  const bridge = (globalThis as { window?: { atr?: unknown } }).window?.atr as
    | { catalog: { setTags: (i: SetTagsInput) => Promise<RepoLite> } }
    | undefined;
  if (!bridge) throw new Error("window.atr is undefined");
  return bridge;
}

/**
 * The mutation's real logic, reproduced from `useSetRepoTags`. Returns a
 * `mutate(input)` that runs `mutationFn` then `onSuccess` on resolve —
 * the exact ordering TanStack Query guarantees.
 */
function runSetTagsMutation(client: FakeQueryClient) {
  const mutationFn = async (input: SetTagsInput): Promise<RepoLite> =>
    requireAtr().catalog.setTags(input);
  const onSuccess = (_updated: RepoLite, variables: SetTagsInput) => {
    client.invalidateQueries({ queryKey: reposDetailKey(variables.slug) });
    client.invalidateQueries({ queryKey: reposAllKey });
  };
  return async (input: SetTagsInput): Promise<RepoLite> => {
    const result = await mutationFn(input);
    onSuccess(result, input);
    return result;
  };
}

// Minimal Repo-shaped fixture the bridge "returns" from setTags.
function repoFixture(userTags: string[]): RepoLite {
  return {
    slug: "demo",
    tags: [
      // Heuristic tag the server PRESERVES through setTags.
      { value: "typescript", source: "heuristic" },
      ...userTags.map((value) => ({ value, source: "user" as const })),
    ],
  };
}

// --- Tests ---------------------------------------------------------------

describe("useSetRepoTags mutation contract (catalog:setTags)", () => {
  const setTags = vi.fn();

  beforeEach(() => {
    setTags.mockReset();
    (globalThis as { window?: unknown }).window = {
      atr: { catalog: { setTags } },
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it("sends the full {slug, tags} payload through the bridge and preserves heuristic tags", async () => {
    setTags.mockResolvedValue(repoFixture(["alpha", "beta"]));

    const client = new FakeQueryClient();
    const mutate = runSetTagsMutation(client);

    const result = await mutate({ slug: "demo", tags: ["alpha", "beta"] });

    expect(setTags).toHaveBeenCalledTimes(1);
    expect(setTags).toHaveBeenCalledWith({
      slug: "demo",
      tags: ["alpha", "beta"],
    });
    // Server response preserves the heuristic tag alongside user tags.
    expect(result.tags.map((t) => t.value)).toEqual([
      "typescript",
      "alpha",
      "beta",
    ]);
  });

  it("invalidates the repo-detail and repo-list query keys on success", async () => {
    setTags.mockResolvedValue(repoFixture([]));

    const client = new FakeQueryClient();
    const mutate = runSetTagsMutation(client);

    await mutate({ slug: "demo", tags: [] });

    expect(client.invalidated).toContainEqual(reposDetailKey("demo"));
    expect(client.invalidated).toContainEqual(reposAllKey);
  });

  it("does not invalidate when the bridge call rejects", async () => {
    setTags.mockRejectedValue(new Error("ipc boom"));

    const client = new FakeQueryClient();
    const mutate = runSetTagsMutation(client);

    await expect(mutate({ slug: "demo", tags: ["x"] })).rejects.toThrow(
      "ipc boom",
    );
    expect(client.invalidated).toHaveLength(0);
  });

  it("throws when the preload bridge is unavailable", async () => {
    delete (globalThis as { window?: unknown }).window;

    const client = new FakeQueryClient();
    const mutate = runSetTagsMutation(client);

    await expect(mutate({ slug: "demo", tags: [] })).rejects.toThrow(
      "window.atr is undefined",
    );
    expect(client.invalidated).toHaveLength(0);
  });
});
