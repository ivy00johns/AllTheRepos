import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListReposInput, ListReposResult, Repo } from "@shared/types";

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock("@renderer/lib/query-client", () => ({
  queryKeys: {
    repos: { list: (filters: unknown) => ["repos", filters] },
    groups: { all: ["groups"] },
  },
}));
const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@renderer/lib/atr", () => ({
  getAtr: () => ({ catalog: { list } }),
  requireAtr: () => ({ catalog: { list } }),
}));

import { readAllRepos } from "@renderer/hooks/use-repos";
import { useGroupMemberSlugs } from "@renderer/hooks/use-groups";

const repos = Array.from({ length: 451 }, (_, index) => ({ slug: `repo-${index}` }) as Repo);
function page(input: ListReposInput): ListReposResult {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 200;
  return { items: repos.slice(offset, offset + limit), total: repos.length, offset, limit };
}
afterEach(() => vi.resetAllMocks());

describe("the real catalog pagination read", () => {
  it("reads repos beyond 200 and preserves filters on every page", async () => {
    list.mockImplementation(page);
    const result = await readAllRepos({ groupId: 7, sort: "name", offset: 99, limit: 1 });
    expect(result.items).toEqual(repos);
    expect(result.total).toBe(451);
    expect(list.mock.calls.map(([input]) => input)).toEqual([0, 200, 400].map((offset) => ({ groupId: 7, sort: "name", offset, limit: 200 })));
  });

  it("returns an empty catalog after one read", async () => {
    list.mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
    expect((await readAllRepos()).items).toEqual([]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("rejects stalled pagination rather than reporting a truncated success", async () => {
    list.mockResolvedValueOnce(page({})).mockResolvedValueOnce({ items: [], total: 451, limit: 200, offset: 200 });
    await expect(readAllRepos()).rejects.toThrow("Catalog pagination stopped");
  });

  it("propagates a failed later page", async () => {
    list.mockResolvedValueOnce(page({})).mockRejectedValueOnce(new Error("IPC failed"));
    await expect(readAllRepos()).rejects.toThrow("IPC failed");
  });

  it("uses the same complete read for manual group membership", async () => {
    list.mockImplementation(page);
    const options = useGroupMemberSlugs(7) as unknown as { queryFn: () => Promise<Set<string>> };
    const members = await options.queryFn();
    expect(members.size).toBe(451);
    expect(members.has("repo-450")).toBe(true);
    expect(list.mock.calls.every(([input]) => input.groupId === 7)).toBe(true);
  });
});
