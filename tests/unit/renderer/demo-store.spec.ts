/**
 * Unit test for the browser bridge's writable store
 * (`src/renderer/lib/demo-store.ts`).
 *
 * The store exists so the flows that change the catalog — favourite, tags,
 * curated links, moves — can be reviewed in a browser tab instead of being
 * refused. A review is only worth anything if what it shows is what the app
 * would do, so this test drives each flow and checks the two things that could
 * quietly be wrong:
 *
 *   1. Shape — every answer parses against the same Zod schema the IPC boundary
 *      validates with. A write that answers with the right *idea* and the wrong
 *      fields is worse than a refused one: it renders as a broken panel.
 *   2. Rules — the store refuses what `services/move.ts` refuses (a dirty tree,
 *      a folder with a process in it, a target outside the scan roots), keeps
 *      the slug across a move as main does, and leaves an undoable batch behind.
 *
 * Each test gets a fresh module instance, because the state is deliberately a
 * session-long singleton.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  AddScanPathResultSchema,
  AssertRepoLinkResultSchema,
  FolderCheckResultSchema,
  GraphResultSchema,
  MoveCheckResultSchema,
  MoveLastResultSchema,
  MoveResultSchema,
  RemoveRepoLinkResultSchema,
  RemoveScanPathResultSchema,
  RepoDetailSchema,
  RepoRelationsResultSchema,
  RepoSchema,
  RescanRepoResultSchema,
  SettingsSchema,
} from "@shared/schemas";

import type { Repo } from "@shared/types";

import { DEMO_PROCESSES, DEMO_ROOT } from "@renderer/lib/demo-library";

type Store = typeof import("@renderer/lib/demo-store");

const freshStore = async (): Promise<Store> => {
  vi.resetModules();
  return import("@renderer/lib/demo-store");
};

const FOLDER = "/Users/demo/Code/archive";

const byName = (repos: Repo[], name: string): Repo => {
  const repo = repos.find((candidate) => candidate.name === name);
  if (!repo) throw new Error(`No demo repo named ${name}`);
  return repo;
};

beforeEach(() => {
  vi.resetModules();
  // A stub one test installs must not be the environment the next one runs in.
  vi.unstubAllGlobals();
});

describe("favourites", () => {
  test("starring a repo returns the repo and stars it on the map", async () => {
    const store = await freshStore();
    const repo = store.listRepos().find((candidate) => !candidate.isFavorite);
    if (!repo) throw new Error("Every demo repo is already a favourite");

    const updated = store.setFavorite(repo.slug, true);
    expect(RepoSchema.parse(updated).isFavorite).toBe(true);
    expect(store.findRepo(repo.slug)?.favoritedAt).not.toBeNull();

    const node = GraphResultSchema.parse(store.graph()).nodes.find(
      (candidate) => candidate.slug === repo.slug,
    );
    expect(node?.isFavorite).toBe(true);

    // And it un-stars, stamping the timestamp back to null.
    const off = store.setFavorite(repo.slug, false);
    expect(RepoSchema.parse(off).isFavorite).toBe(false);
    expect(store.findRepo(repo.slug)?.favoritedAt).toBeNull();
  });

  test("an unknown slug is answered with null, not an invented repo", async () => {
    const store = await freshStore();
    expect(store.setFavorite("nope-00000000", true)).toBeNull();
  });
});

describe("tags", () => {
  test("an edit reads back on the repo and in the detail panel", async () => {
    const store = await freshStore();
    const repo = byName(store.listRepos(), "lighthouse-ui");

    const updated = store.setTags(repo.slug, ["design-system", "ui"]);
    const parsed = RepoSchema.parse(updated);
    expect(parsed.tags.map((tag) => tag.value)).toEqual(["design-system", "ui"]);
    expect(parsed.tags.every((tag) => tag.source === "user")).toBe(true);

    const detail = RepoDetailSchema.parse(store.detail(repo.slug));
    expect(detail.tags.map((tag) => tag.value)).toEqual(["design-system", "ui"]);
    // The parts that cannot change in a tab are still there.
    expect(detail.readmeContent).toBeTruthy();
  });

  test("an unknown slug throws rather than reporting a save", async () => {
    const store = await freshStore();
    expect(() => store.setTags("nope-00000000", ["x"])).toThrow(/No repo/);
  });
});

describe("curated links", () => {
  test("asserting a link reaches both panels and the map, and can be removed", async () => {
    const store = await freshStore();
    const from = byName(store.listRepos(), "lighthouse-ui");
    const to = byName(store.listRepos(), "pixel-forge");

    const asserted = AssertRepoLinkResultSchema.parse(
      store.assertLink({
        fromSlug: from.slug,
        toSlug: to.slug,
        kind: "related",
        why: "both were built during the same week",
      }),
    );
    expect(asserted.link.source).toBe("ui");

    const outgoing = RepoRelationsResultSchema.parse(store.relations(from.slug));
    expect(
      outgoing.relations.some(
        (relation) => relation.slug === to.slug && relation.direction === "outgoing",
      ),
    ).toBe(true);

    // A link is visible from either end, and says which end it is.
    const incoming = RepoRelationsResultSchema.parse(store.relations(to.slug));
    expect(
      incoming.relations.some(
        (relation) => relation.slug === from.slug && relation.direction === "incoming",
      ),
    ).toBe(true);

    const graph = GraphResultSchema.parse(store.graph());
    const edge = graph.edges.find(
      (candidate) =>
        (candidate.source === from.slug && candidate.target === to.slug) ||
        (candidate.source === to.slug && candidate.target === from.slug),
    );
    expect(edge?.curated?.some((link) => link.kind === "related")).toBe(true);
    expect(edge?.signals).toContain("curated");

    const removed = RemoveRepoLinkResultSchema.parse(
      store.removeLink({ fromSlug: from.slug, toSlug: to.slug, kind: "related" }),
    );
    expect(removed.removed).toBe(true);
    expect(
      RepoRelationsResultSchema.parse(store.relations(from.slug)).relations.some(
        (relation) => relation.slug === to.slug,
      ),
    ).toBe(false);

    // Removing it twice is not an error, it is a no-op.
    expect(
      RemoveRepoLinkResultSchema.parse(
        store.removeLink({ fromSlug: from.slug, toSlug: to.slug, kind: "related" }),
      ).removed,
    ).toBe(false);
  });

  test("the same assertion twice is one link", async () => {
    const store = await freshStore();
    const repos = store.listRepos();
    const from = byName(repos, "ledger-core");
    const to = byName(repos, "voxel-engine");
    const input = { fromSlug: from.slug, toSlug: to.slug, kind: "related" as const };

    const first = store.assertLink(input);
    const second = store.assertLink(input);
    expect(second.link.id).toBe(first.link.id);
    expect(
      RepoRelationsResultSchema.parse(store.relations(from.slug)).relations.filter(
        (relation) => relation.slug === to.slug,
      ),
    ).toHaveLength(1);
  });

  test("a repo cannot be linked to itself, and an unknown end is refused", async () => {
    const store = await freshStore();
    const from = byName(store.listRepos(), "ledger-core");
    expect(() =>
      store.assertLink({ fromSlug: from.slug, toSlug: from.slug, kind: "related" }),
    ).toThrow(/itself/);
    expect(() =>
      store.assertLink({ fromSlug: from.slug, toSlug: "nope-00000000", kind: "related" }),
    ).toThrow(/No repo/);
  });
});

describe("moves", () => {
  test("a clean repo moves, keeps its slug, and comes back on undo", async () => {
    const store = await freshStore();
    const repo = freeRepo(store);
    const fromPath = repo.fullPath;

    const check = MoveCheckResultSchema.parse(store.moveCheck([repo.slug], FOLDER));
    expect(check.movableCount).toBe(1);
    expect(check.entries[0]?.toPath).toBe(`${FOLDER}/${repo.name}`);

    const result = MoveResultSchema.parse(store.move([repo.slug], FOLDER));
    expect(result.movedCount).toBe(1);
    expect(result.batchId).toBeTruthy();

    // The slug is the row key in main and survives the move; the path does not.
    const moved = store.findRepo(repo.slug);
    expect(moved?.slug).toBe(repo.slug);
    expect(moved?.fullPath).toBe(`${FOLDER}/${repo.name}`);

    // The map reads the new folder, which is what recomputes cluster spread.
    const node = GraphResultSchema.parse(store.graph()).nodes.find(
      (candidate) => candidate.slug === repo.slug,
    );
    expect(node?.folder).toBe(FOLDER);

    const last = MoveLastResultSchema.parse(store.moveLast());
    expect(last?.batchId).toBe(result.batchId);
    expect(last?.kind).toBe("repos");
    expect(last?.label).toBe("moved 1 repo");

    expect(MoveResultSchema.parse(store.moveUndo()).movedCount).toBe(1);
    expect(store.findRepo(repo.slug)?.fullPath).toBe(fromPath);
    expect(store.moveLast()).toBeNull();
  });

  test("a dirty tree is blocked, and the reason is the one main gives", async () => {
    const store = await freshStore();
    const dirty = store.listRepos().find((candidate) => candidate.isDirty);
    if (!dirty) throw new Error("No dirty demo repo to block");

    const check = MoveCheckResultSchema.parse(store.moveCheck([dirty.slug], FOLDER));
    expect(check.movableCount).toBe(0);
    expect(check.blockedCount).toBe(1);
    expect(check.entries[0]?.ok).toBe(false);
    expect(check.entries[0]?.blockers).toContain("dirty");

    const result = MoveResultSchema.parse(store.move([dirty.slug], FOLDER));
    expect(result.movedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.batchId).toBeNull();
    expect(store.findRepo(dirty.slug)?.fullPath).toBe(dirty.fullPath);
  });

  test("a repo with a process in it is blocked the same way main blocks it", async () => {
    const store = await freshStore();
    const busy = busySlugs(store);
    // The demo library gives two repos a listening dev server; the rule is the
    // one `services/move.ts` applies, so this has to be one of them.
    expect(busy.size).toBeGreaterThan(0);
    const held = store.listRepos().find((repo) => busy.has(repo.slug));
    if (!held) throw new Error("No demo repo has a process in it");

    const check = MoveCheckResultSchema.parse(store.moveCheck([held.slug], FOLDER));
    expect(check.entries[0]?.blockers).toContain("running-process");
    expect(check.entries[0]?.ok).toBe(false);
    expect(check.movableCount).toBe(0);
    expect(store.findRepo(held.slug)?.fullPath).toBe(held.fullPath);
  });

  test("a target outside the roots, inside the repo, or already there", async () => {
    const store = await freshStore();
    const clean = freeRepo(store);

    // Outside the scan roots.
    const outside = MoveCheckResultSchema.parse(
      store.moveCheck([clean.slug], "/tmp/elsewhere"),
    );
    expect(outside.entries[0]?.blockers).toContain("target-outside-roots");
    expect(outside.movableCount).toBe(0);

    // Already there.
    const same = MoveCheckResultSchema.parse(
      store.moveCheck([clean.slug], clean.fullPath.slice(0, clean.fullPath.lastIndexOf("/"))),
    );
    expect(same.entries[0]?.blockers).toContain("same-location");

    // Inside itself.
    const inside = MoveCheckResultSchema.parse(
      store.moveCheck([clean.slug], `${clean.fullPath}/nested`),
    );
    expect(inside.entries[0]?.blockers).toContain("target-inside-source");

    // `destination-exists` is the one rule this store cannot reach: in main it
    // is `pathExists(toPath)` on the real filesystem, and a browser tab has no
    // filesystem — two catalog rows can only collide on a name the demo library
    // does not contain. The rule is kept in the store so it mirrors main; the
    // path it would write is still reported per entry.
    const elsewhere = MoveCheckResultSchema.parse(
      store.moveCheck([clean.slug], "/Users/demo/Code/gathered"),
    );
    expect(elsewhere.entries[0]?.toPath).toBe(`/Users/demo/Code/gathered/${clean.name}`);
  });

  test("an unknown slug is reported per entry instead of aborting the batch", async () => {
    const store = await freshStore();
    const check = MoveCheckResultSchema.parse(
      store.moveCheck(["nope-00000000"], FOLDER),
    );
    expect(check.entries[0]?.blockers).toEqual(["unknown-repo"]);
    expect(check.entries[0]?.ok).toBe(false);
  });
});

/**
 * A repo the mover will accept: nothing uncommitted, nothing running in it.
 *
 * Both matter. `listRepos()` hands back the store's own rows, so anything a
 * test captures has to be read as a value now — a `fullPath` kept in a variable
 * is a string, but a `Repo` kept in a variable is the row a later write edits.
 */
function freeRepo(store: Store): Repo {
  const busy = busySlugs(store);
  const repo = store
    .listRepos()
    .find((candidate) => !candidate.isDirty && !busy.has(candidate.slug));
  if (!repo) throw new Error("No demo repo is free to move");
  return repo;
}

/** Slugs with a listening process, read off the same rows the cards show. */
function busySlugs(store: Store): Set<string> {
  const known = new Set(store.listRepos().map((repo) => repo.slug));
  return new Set(
    DEMO_PROCESSES.processes
      .map((row) => row.repoSlug)
      .filter((slug): slug is string => slug !== null && known.has(slug)),
  );
}

describe("folders", () => {
  test("a clean folder renames, re-pathing every repo inside it", async () => {
    const store = await freshStore();
    const repos = store.listRepos();
    const busy = busySlugs(store);

    // Renaming is only allowed over repos with nothing in flight, so pick the
    // folder whose members are all clean and none of them busy.
    const folder = [...new Set(repos.map(folderOf))].find((candidate) => {
      const inside = repos.filter(
        (repo) => folderOf(repo) === candidate && candidate !== DEMO_ROOT,
      );
      return inside.length > 0 && inside.every((repo) => !repo.isDirty && !busy.has(repo.slug));
    });
    if (!folder) throw new Error("Every demo folder has work in flight");

    // Snapshotted, because these are the store's own rows: after the rename,
    // `repo.fullPath` reads the new path and the expectation would compare the
    // result with itself.
    const inside = repos
      .filter((repo) => folderOf(repo) === folder)
      .map((repo) => ({ slug: repo.slug, fullPath: repo.fullPath }));
    const renamed = `${folder}-renamed`;

    const check = FolderCheckResultSchema.parse(store.folderCheck(folder, renamed));
    expect(check.ok).toBe(true);
    expect(check.affected).toHaveLength(inside.length);

    const result = store.folderRename(folder, `${folder.split("/").pop()}-renamed`);
    expect(result.ok).toBe(true);
    expect(result.movedRepos).toBe(inside.length);
    for (const entry of inside) {
      expect(store.findRepo(entry.slug)?.fullPath).toBe(
        renamed + entry.fullPath.slice(folder.length),
      );
    }

    // The undo bar can put the whole folder back in one move.
    expect(MoveResultSchema.parse(store.moveUndo()).movedCount).toBe(inside.length);
    for (const entry of inside) {
      expect(store.findRepo(entry.slug)?.fullPath).toBe(entry.fullPath);
    }
  });

  test("a folder with uncommitted work in it is refused, and nothing moves", async () => {
    const store = await freshStore();
    const dirty = store.listRepos().find((candidate) => candidate.isDirty);
    if (!dirty) throw new Error("No dirty demo repo");
    const folder = dirty.fullPath.slice(0, dirty.fullPath.lastIndexOf("/"));

    const result = store.folderRename(folder, "somewhere-else");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("dirty-repos");
    expect(store.findRepo(dirty.slug)?.fullPath).toBe(dirty.fullPath);
  });

  test("a scan root cannot be renamed out from under the scan", async () => {
    const store = await freshStore();
    const root = store.settings().scanPaths[0] as string;
    const check = FolderCheckResultSchema.parse(
      store.folderCheck(root, `${root}-renamed`),
    );
    expect(check.blockers).toContain("is-scan-root");
    expect(check.ok).toBe(false);
  });
});

describe("settings", () => {
  test("a scan root can be added once, and removing it forgets its rows", async () => {
    const store = await freshStore();
    const before = store.listRepos().length;

    expect(
      AddScanPathResultSchema.parse(store.addScanPath("/Users/demo/Side")).added,
    ).toBe(true);
    const again = AddScanPathResultSchema.parse(store.addScanPath("/Users/demo/Side/"));
    expect(again.added).toBe(false);
    expect(again.reason).toBeTruthy();

    const root = store.settings().scanPaths[0] as string;
    const underRoot = store.countUnder(root);
    expect(underRoot).toBeGreaterThan(0);

    // `forgetRepos: false` keeps the rows — that is the whole point of the flag.
    const kept = RemoveScanPathResultSchema.parse(store.removeScanPath(root, false));
    expect(kept.removed).toBe(true);
    expect(kept.forgotten).toBe(0);
    expect(store.listRepos()).toHaveLength(before);
    expect(store.settings().scanPaths).not.toContain(root);

    // Put it back, then remove it for real.
    store.addScanPath(root);
    const dropped = RemoveScanPathResultSchema.parse(store.removeScanPath(root, true));
    expect(dropped.forgotten).toBe(underRoot);
    expect(store.listRepos()).toHaveLength(before - underRoot);
    expect(store.countUnder(root)).toBe(0);
    // And the map has nothing stale left in it.
    const graph = GraphResultSchema.parse(store.graph());
    expect(graph.nodes.filter((node) => node.folder.startsWith(root))).toHaveLength(0);
  });

  test("a patch merges without blanking an untouched optional field", async () => {
    const store = await freshStore();
    const before = settingsParse(store);

    const after = SettingsSchema.parse(
      store.updateSettings({ ollamaBaseUrl: "http://localhost:9999" }),
    );
    expect(after.ollamaBaseUrl).toBe("http://localhost:9999");
    expect(after.defaultTerminal).toBe(before.defaultTerminal);
    expect(after.scanPaths).toEqual(before.scanPaths);
  });
});

describe("repo rows", () => {
  test("dropping a row takes its links with it, and rescan re-stamps one", async () => {
    const store = await freshStore();
    const repos = store.listRepos();
    const from = byName(repos, "ledger-core");
    const to = byName(repos, "mailroom");

    store.assertLink({ fromSlug: from.slug, toSlug: to.slug, kind: "related" });
    expect(
      RepoRelationsResultSchema.parse(store.relations(to.slug)).relations.length,
    ).toBeGreaterThan(0);

    expect(store.forgetRepo(to.slug)).toEqual({ slug: to.slug, deleted: true });
    expect(store.findRepo(to.slug)).toBeNull();
    // No dangling assertion pointing at a row that is gone.
    expect(
      RepoRelationsResultSchema.parse(store.relations(from.slug)).relations.some(
        (relation) => relation.slug === to.slug,
      ),
    ).toBe(false);

    const rescanned = RescanRepoResultSchema.parse(store.rescan(from.slug));
    expect(rescanned.slug).toBe(from.slug);
  });
});

function settingsParse(store: Store) {
  return SettingsSchema.parse(store.settings());
}

const folderOf = (repo: Repo): string =>
  repo.fullPath.slice(0, repo.fullPath.lastIndexOf("/"));

/**
 * An export is a file this bundle did not produce, so the interesting cases are
 * the ones where it is missing, stale or malformed — a tab that quietly served
 * the demo library over a file somebody expected to work would be worse than one
 * that said nothing at all.
 */
describe("an exported catalog", () => {
  /** Answer the next `fetch` with a body, or with a status and no body. */
  function stubFetch(body: unknown, status = 200): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      })),
    );
  }

  /** Two of the demo repos, stood up as if they were a real export. */
  function payload(store: Store) {
    const [first, second] = store.listRepos();
    if (!first || !second) throw new Error("the demo library should hold repos");
    return {
      format: 1,
      exportedAt: "2026-10-08T12:00:00.000Z",
      dbPath: "/Users/somebody/Library/Application Support/alltherepos/alltherepos.db",
      repos: [
        { ...first, fullPath: "/Users/somebody/Repos/mine/first", isFavorite: false },
        { ...second, fullPath: "/Users/somebody/Repos/elsewhere/second" },
      ],
      groups: [],
      detail: {
        [first.slug]: { readmeContent: "# Exported README\n", groups: [] },
      },
      links: [
        {
          id: 1,
          fromSlug: first.slug,
          toSlug: second.slug,
          kind: "related" as const,
          why: "asserted on the real machine",
          source: "ui" as const,
          createdAt: "2026-10-01T09:00:00.000Z",
        },
      ],
      settings: { ...store.settings(), scanPaths: ["/Users/somebody/Repos"] },
    };
  }

  test("replaces the demo library, and the map draws only what it holds", async () => {
    const store = await freshStore();
    const body = payload(store);
    const [first, second] = body.repos as [Repo, Repo];
    stubFetch(body);

    expect(await store.loadExportedCatalog("/__atr/catalog.json")).toBe("export");
    expect(store.source()).toBe("export");
    expect(store.listRepos().map((repo) => repo.slug)).toEqual([first.slug, second.slug]);
    expect(store.settings().scanPaths).toEqual(["/Users/somebody/Repos"]);

    // The README comes from the export, not from the demo seed's repo of the
    // same slug — which is the difference between "my library" and "a library".
    expect(store.detail(first.slug)?.readmeContent).toBe("# Exported README\n");

    // Every demo name in the derived link list now belongs to a repo that is
    // not in the catalog, so the only drawable edge is the exported one.
    const graph = GraphResultSchema.parse(store.graph());
    expect(graph.nodes.map((node) => node.slug).sort()).toEqual(
      [first.slug, second.slug].sort(),
    );
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.source).toBe(first.slug);
    expect(graph.edges[0]?.target).toBe(second.slug);
    expect(graph.edges[0]?.curated?.[0]?.why).toBe("asserted on the real machine");

    // Clusters are the folders the repos live in, since an export carries no
    // derived signals for the real builder's clusters to be inferred from.
    expect(graph.clusters.map((cluster) => cluster.label).sort()).toEqual([
      "elsewhere",
      "mine",
    ]);
    expect(graph.clusters.every((cluster) => cluster.strays.length === 0)).toBe(true);
  });

  test("the flows still write over an exported catalog", async () => {
    const store = await freshStore();
    const body = payload(store);
    const [first, second] = body.repos as [Repo, Repo];
    stubFetch(body);
    await store.loadExportedCatalog("/__atr/catalog.json");

    expect(store.setFavorite(first.slug, true)?.isFavorite).toBe(true);
    expect(store.setTags(second.slug, ["mine"]).tags).toEqual([
      { value: "mine", source: "user" },
    ]);
    expect(
      store.removeLink({
        fromSlug: first.slug,
        toSlug: second.slug,
        kind: "related",
      }).removed,
    ).toBe(true);
    // The pair can still carry a derived signal — the assertion is about the
    // curated one, which is what the panel's write removed.
    const edges = GraphResultSchema.parse(store.graph()).edges;
    expect(edges.some((edge) => edge.signals.includes("curated"))).toBe(false);
    expect(edges.every((edge) => (edge.curated ?? []).length === 0)).toBe(true);
  });

  test("no export at all leaves the demo library serving", async () => {
    const store = await freshStore();
    stubFetch(null, 404);

    expect(await store.loadExportedCatalog("/__atr/catalog.json")).toBe("demo");
    expect(store.source()).toBe("demo");
    expect(store.listRepos()).toHaveLength(12);
    expect(store.settings().scanPaths).toEqual(["/Users/demo/Code"]);
  });

  test("a format this build does not know is refused, not half-loaded", async () => {
    const store = await freshStore();
    stubFetch({ ...payload(store), format: 99 });

    expect(await store.loadExportedCatalog("/__atr/catalog.json")).toBe("demo");
    expect(store.source()).toBe("demo");
    expect(store.listRepos()).toHaveLength(12);
  });

  test("a malformed export is refused by the schema it would be rendered from", async () => {
    const store = await freshStore();
    const body = payload(store);
    // A tag without its `source`, which is the field whose absence once made the
    // whole catalog render blank.
    const broken = {
      ...body,
      repos: [{ ...body.repos[0], tags: [{ value: "ui" }] }, body.repos[1]],
    };
    stubFetch(broken);

    expect(await store.loadExportedCatalog("/__atr/catalog.json")).toBe("demo");
    expect(store.listRepos()).toHaveLength(12);
  });

  test("an unreadable response is reported and the demo library keeps serving", async () => {
    const store = await freshStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    expect(await store.loadExportedCatalog("/__atr/catalog.json")).toBe("demo");
    expect(store.listRepos()).toHaveLength(12);
  });
});

/**
 * A `localStorage` stand-in.
 *
 * The store only touches one key per library, and `Map` is the whole API it
 * uses, so the fake is deliberately not the Web Storage interface: what is
 * being tested is that a write is recorded and replayed, not that `length` has
 * the right value.
 */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, value);
    },
    removeItem: (key: string): void => {
      map.delete(key);
    },
  };
}

/** The `why` on every curated link the graph draws between two repos. */
function curatedWhys(store: Store, a: string, b: string): string[] {
  const graph = GraphResultSchema.parse(store.graph());
  const edge = graph.edges.find(
    (candidate) =>
      (candidate.source === a && candidate.target === b) ||
      (candidate.source === b && candidate.target === a),
  );
  return (edge?.curated ?? []).map((link) => link.why ?? "");
}

/** The slug key for one library's saved edits — asserted, so a rename is caught here. */
const DEMO_EDITS_KEY = "atr.browser-bridge.edits.v1.demo";

/**
 * Edits outlive the tab.
 *
 * A write is recorded as the smallest edit that can be replayed — the value it
 * set on one field, keyed by slug — and saved, so a new module instance (a
 * reload, in everything but name) re-applies it on top of the library it finds.
 * What matters is the pair of halves that could each be wrong: an edit that is
 * applied to the wrong library (a demo star landing on a real repo) or an edit
 * that quietly stops applying when the catalog behind it is refreshed.
 */
describe("saved edits", () => {
  test("writes before persistence is enabled reach no storage at all", async () => {
    const storage = fakeStorage();
    const store = await freshStore();
    const repo = store.listRepos().find((candidate) => !candidate.isFavorite);
    if (!repo) throw new Error("Every demo repo is already a favourite");

    store.setFavorite(repo.slug, true);
    expect(storage.map.size).toBe(0);

    // And in a context with no localStorage it stays session-local. The context
    // is stated rather than inherited: Node 25 ships a global `localStorage`
    // (Node 22, which CI runs, does not), and on a runtime that has one this
    // would be asserting the machine instead of the store.
    vi.stubGlobal("localStorage", undefined);
    expect(store.enablePersistence()).toBe(false);
    expect(store.persistenceEnabled()).toBe(false);
  });

  test("a favourite and a tag come back in the next session", async () => {
    const storage = fakeStorage();
    const first = await freshStore();
    expect(first.enablePersistence(storage)).toBe(true);

    const repo = first.listRepos().find((candidate) => !candidate.isFavorite);
    if (!repo) throw new Error("Every demo repo is already a favourite");
    first.setFavorite(repo.slug, true);
    first.setTags(repo.slug, ["kept"]);

    // One key, holding the edit — not a snapshot of the whole catalog.
    expect(storage.map.size).toBe(1);

    const second = await freshStore();
    expect(second.enablePersistence(storage)).toBe(true);
    const restored = second.findRepo(repo.slug);
    expect(restored?.isFavorite).toBe(true);
    expect(restored?.favoritedAt).not.toBeNull();
    expect(restored?.tags.map((tag) => tag.value)).toEqual(["kept"]);
    expect(restored?.tags.every((tag) => tag.source === "user")).toBe(true);
  });

  test("a move comes back, with the slug kept", async () => {
    const storage = fakeStorage();
    const first = await freshStore();
    first.enablePersistence(storage);
    const repo = freeRepo(first);

    const moved = MoveResultSchema.parse(first.move([repo.slug], FOLDER));
    expect(moved.movedCount).toBe(1);

    const second = await freshStore();
    second.enablePersistence(storage);
    expect(second.findRepo(repo.slug)?.fullPath).toBe(`${FOLDER}/${repo.name}`);
    // The moved path persists; the undo bar is a session affordance.
    expect(second.moveLast()).toBeNull();
  });

  test("a curated link comes back, and a removed one stays removed", async () => {
    const storage = fakeStorage();
    const first = await freshStore();
    first.enablePersistence(storage);
    const repos = first.listRepos();

    const asserted = { from: byName(repos, "lighthouse-ui"), to: byName(repos, "pixel-forge") };
    first.assertLink({
      fromSlug: asserted.from.slug,
      toSlug: asserted.to.slug,
      kind: "related",
      why: "asserted before the reload",
    });

    // A link the demo library ships, removed here — the record has to say so,
    // because the base will keep offering it on every reload.
    const seeded = { from: byName(repos, "sketchbook"), to: byName(repos, "weatherbot") };
    const SEEDED_WHY = "same forecasting idea — the notebook came first";
    expect(curatedWhys(first, seeded.from.slug, seeded.to.slug)).toContain(SEEDED_WHY);
    expect(
      first.removeLink({ fromSlug: seeded.from.slug, toSlug: seeded.to.slug, kind: "related" })
        .removed,
    ).toBe(true);

    const second = await freshStore();
    second.enablePersistence(storage);
    expect(curatedWhys(second, asserted.from.slug, asserted.to.slug)).toContain(
      "asserted before the reload",
    );
    expect(curatedWhys(second, seeded.from.slug, seeded.to.slug)).not.toContain(SEEDED_WHY);
  });

  test("a scan root and a settings edit come back", async () => {
    const storage = fakeStorage();
    const first = await freshStore();
    first.enablePersistence(storage);
    first.addScanPath("/Users/demo/Side");
    first.updateSettings({ ollamaBaseUrl: "http://localhost:1234" });

    const second = await freshStore();
    second.enablePersistence(storage);
    expect(second.settings().scanPaths).toContain("/Users/demo/Side");
    expect(second.settings().ollamaBaseUrl).toBe("http://localhost:1234");
  });

  test("a dropped repo stays dropped, and takes its links with it", async () => {
    const storage = fakeStorage();
    const first = await freshStore();
    first.enablePersistence(storage);
    const repos = first.listRepos();
    const gone = byName(repos, "mailroom");
    const keeper = byName(repos, "ledger-core");

    first.assertLink({ fromSlug: keeper.slug, toSlug: gone.slug, kind: "related" });
    expect(first.forgetRepo(gone.slug).deleted).toBe(true);

    const second = await freshStore();
    second.enablePersistence(storage);
    expect(second.findRepo(gone.slug)).toBeNull();
    expect(
      RepoRelationsResultSchema.parse(second.relations(keeper.slug)).relations.some(
        (relation) => relation.slug === gone.slug,
      ),
    ).toBe(false);
  });

  test("an unreadable record is ignored rather than half-applied", async () => {
    const store = await freshStore();
    const storage = fakeStorage({ [DEMO_EDITS_KEY]: "{ this is not json" });

    expect(store.enablePersistence(storage)).toBe(true);
    expect(store.listRepos()).toHaveLength(12);

    // A record from a build this one does not read is refused the same way.
    const stale = await freshStore();
    const staleStorage = fakeStorage({
      [DEMO_EDITS_KEY]: JSON.stringify({ format: 99, source: "demo", repos: {} }),
    });
    expect(stale.enablePersistence(staleStorage)).toBe(true);
    expect(stale.listRepos()).toHaveLength(12);
  });

  test("clearing the record leaves the library itself alone", async () => {
    const storage = fakeStorage();
    const first = await freshStore();
    first.enablePersistence(storage);
    const repo = first.listRepos().find((candidate) => !candidate.isFavorite);
    if (!repo) throw new Error("Every demo repo is already a favourite");
    first.setFavorite(repo.slug, true);
    expect(storage.map.size).toBe(1);

    expect(first.clearPersistedEdits(storage)).toBe(true);
    expect(storage.map.size).toBe(0);

    const second = await freshStore();
    second.enablePersistence(storage);
    expect(second.findRepo(repo.slug)?.isFavorite).toBe(false);
  });

  test("an export does not inherit the demo library's edits, and keeps its own", async () => {
    const storage = fakeStorage();
    const first = await freshStore();
    first.enablePersistence(storage);
    const repo = byName(first.listRepos(), "lighthouse-ui");
    first.setFavorite(repo.slug, true);

    const body = {
      format: 1,
      exportedAt: "2026-10-08T12:00:00.000Z",
      dbPath: "/Users/somebody/Library/Application Support/alltherepos/alltherepos.db",
      repos: [{ ...repo, fullPath: "/Users/somebody/Repos/mine/one", isFavorite: false }],
      groups: [],
      detail: {},
      links: [],
      settings: { ...first.settings(), scanPaths: ["/Users/somebody/Repos"] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
    );
    expect(await first.loadExportedCatalog("/__atr/catalog.json")).toBe("export");

    // The demo star does not follow the slug into a library that is not its own.
    expect(first.findRepo(repo.slug)?.isFavorite).toBe(false);

    // And the export's own record is written under its own key.
    first.setFavorite(repo.slug, true);
    expect(storage.map.size).toBe(2);
  });
});
