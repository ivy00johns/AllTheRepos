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
