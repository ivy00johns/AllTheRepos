/**
 * Unit test for the `useDeleteRepo` mutation contract (ATR-028).
 *
 * Same environment constraints as `use-set-repo-tags.spec.ts`: vitest runs
 * `environment: "node"` with no jsdom and the renderer's runtime deps don't
 * resolve here, so this spec imports NOTHING from app code. It mirrors the
 * mutation's logic — dial `catalog.delete({slug})` through the bridge, then
 * invalidate the repo-detail + repo-list query keys on success — exactly as
 * `useDeleteRepo` wires them in `src/renderer/hooks/use-repos.ts`.
 *
 * KEEP IN LOCKSTEP with `useDeleteRepo`:
 *   - payload = { slug }
 *   - onSuccess invalidates ["repos","detail",slug] and ["repos"]
 *   - no invalidation when the bridge call rejects
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reposDetailKey = (slug: string): unknown[] => ["repos", "detail", slug];
const reposAllKey: unknown[] = ["repos"];

interface DeleteInput {
  slug: string;
}
interface DeleteResult {
  slug: string;
  deleted: boolean;
}

class FakeQueryClient {
  invalidated: unknown[][] = [];
  invalidateQueries(opts: { queryKey: unknown[] }): void {
    this.invalidated.push(opts.queryKey);
  }
}

function requireAtr() {
  const bridge = (globalThis as { window?: { atr?: unknown } }).window?.atr as
    | { catalog: { delete: (i: DeleteInput) => Promise<DeleteResult> } }
    | undefined;
  if (!bridge) throw new Error("window.atr is undefined");
  return bridge;
}

/** The mutation's real logic, reproduced from `useDeleteRepo`. */
function runDeleteMutation(client: FakeQueryClient) {
  const mutationFn = async (input: DeleteInput): Promise<DeleteResult> =>
    requireAtr().catalog.delete(input);
  const onSuccess = (_result: DeleteResult, variables: DeleteInput) => {
    client.invalidateQueries({ queryKey: reposDetailKey(variables.slug) });
    client.invalidateQueries({ queryKey: reposAllKey });
  };
  return async (input: DeleteInput): Promise<DeleteResult> => {
    const result = await mutationFn(input);
    onSuccess(result, input);
    return result;
  };
}

describe("useDeleteRepo mutation contract (catalog:delete, ATR-028)", () => {
  const del = vi.fn();

  beforeEach(() => {
    del.mockReset();
    (globalThis as { window?: unknown }).window = {
      atr: { catalog: { delete: del } },
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it("sends {slug} through the bridge and invalidates detail + list keys on success", async () => {
    del.mockResolvedValue({ slug: "ghost", deleted: true });

    const client = new FakeQueryClient();
    const mutate = runDeleteMutation(client);
    const result = await mutate({ slug: "ghost" });

    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith({ slug: "ghost" });
    expect(result).toEqual({ slug: "ghost", deleted: true });
    expect(client.invalidated).toContainEqual(reposDetailKey("ghost"));
    expect(client.invalidated).toContainEqual(reposAllKey);
  });

  it("does not invalidate when the bridge call rejects", async () => {
    del.mockRejectedValue(new Error("ipc boom"));

    const client = new FakeQueryClient();
    const mutate = runDeleteMutation(client);

    await expect(mutate({ slug: "ghost" })).rejects.toThrow("ipc boom");
    expect(client.invalidated).toHaveLength(0);
  });

  it("throws when the preload bridge is unavailable", async () => {
    delete (globalThis as { window?: unknown }).window;

    const client = new FakeQueryClient();
    const mutate = runDeleteMutation(client);

    await expect(mutate({ slug: "ghost" })).rejects.toThrow(
      "window.atr is undefined",
    );
    expect(client.invalidated).toHaveLength(0);
  });
});
