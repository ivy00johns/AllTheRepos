/**
 * Unit test for the browser bridge's writable store
 * (`src/renderer/lib/demo-store.ts`).
 *
 * The store exists so the flows that change the catalog's own notes about a
 * repo — favourite, tags, curated links — can be reviewed in a browser tab
 * instead of being refused. A review is only worth anything if what it shows is
 * what the app would do, so this test drives each flow and checks the two things
 * that could quietly be wrong:
 *
 *   1. Shape — every answer parses against the same Zod schema the IPC boundary
 *      validates with. A write that answers with the right *idea* and the wrong
 *      fields is worse than a refused one: it renders as a broken panel.
 *   2. Rules — a write changes what the app knows and nothing else: no test in
 *      this file can move, rename, copy or delete a repo, because there is no
 *      call that does any of those.
 *
 * Each test gets a fresh module instance, because the state is deliberately a
 * session-long singleton.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  AddScanPathResultSchema,
  AssertRepoLinkResultSchema,
  GraphResultSchema,
  RemoveRepoLinkResultSchema,
  RemoveScanPathResultSchema,
  RepoDetailSchema,
  RepoRelationsResultSchema,
  RepoSchema,
  RescanRepoResultSchema,
  SettingsSchema,
} from "@shared/schemas";

import type { Repo } from "@shared/types";

type Store = typeof import("@renderer/lib/demo-store");

const freshStore = async (): Promise<Store> => {
  vi.resetModules();
  return import("@renderer/lib/demo-store");
};

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
    expect(store.listRepos()).toHaveLength(36);
    expect(store.settings().scanPaths).toEqual(["/Users/demo/Code"]);
  });

  test("a format this build does not know is refused, not half-loaded", async () => {
    const store = await freshStore();
    stubFetch({ ...payload(store), format: 99 });

    expect(await store.loadExportedCatalog("/__atr/catalog.json")).toBe("demo");
    expect(store.source()).toBe("demo");
    expect(store.listRepos()).toHaveLength(36);
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
    expect(store.listRepos()).toHaveLength(36);
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
    expect(store.listRepos()).toHaveLength(36);
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
    expect(store.listRepos()).toHaveLength(36);

    // A record from a build this one does not read is refused the same way.
    const stale = await freshStore();
    const staleStorage = fakeStorage({
      [DEMO_EDITS_KEY]: JSON.stringify({ format: 99, source: "demo", repos: {} }),
    });
    expect(stale.enablePersistence(staleStorage)).toBe(true);
    expect(stale.listRepos()).toHaveLength(36);
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
