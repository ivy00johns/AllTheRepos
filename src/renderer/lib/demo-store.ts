/**
 * The browser bridge's writable catalog.
 *
 * The bridge's reads came from `demo-library` — a frozen module — so every write
 * had to answer "the main process is not running". That is honest, but it also
 * meant the flows that make this app worth looking at could not be reviewed in a
 * browser tab at all: you could see a favourite, never set one.
 *
 * This module is the missing half. It owns one mutable copy of the demo library
 * and applies the writes the app actually makes — favourite, tags, curated
 * links, moves, folder renames, scan roots — to that copy, so the next read
 * shows the change. It is a *memory* of the session, not a mock: nothing is
 * written to disk, and every rule the main process enforces is enforced here
 * too, including the ones that make a write fail.
 *
 * Those rules are copied from `src/main/services/move.ts` deliberately:
 *
 *  - a move is blocked for a dirty tree, a folder with a process in it, a target
 *    outside the scan roots, a target inside the repo, or a name already taken;
 *  - a slug does not change when a repo moves (main keeps the row key and only
 *    rewrites `full_path`), so links and selections survive a move;
 *  - the same edit is undoable exactly once, through the same `moveLast` /
 *    `moveUndo` pair the catalog's undo bar calls.
 *
 * What it deliberately does NOT do: run processes, touch the filesystem, or
 * claim a folder was created — a browser tab has no disk. Those stay refused,
 * with a reason, at the bridge.
 */

import type {
  AddScanPathResult,
  AssertRepoLinkResult,
  FolderBlocker,
  FolderCheckResult,
  FolderOpResult,
  GraphResult,
  Group,
  MoveBlocker,
  MoveCheckEntry,
  MoveCheckResult,
  MoveEntryResult,
  MoveLastResult,
  MoveResult,
  RemoveRepoLinkResult,
  Repo,
  RepoDetail,
  RepoLink,
  RepoLinkKind,
  RepoRelationsResult,
  RescanRepoResult,
  Settings,
} from "@shared/types";

// Only a type: the store keeps settings in the schema's shape (every field
// present) rather than the contract's, which leaves two fields optional.
import type { SettingsZ } from "@shared/schemas";

import {
  DEMO_CURATED_LINKS,
  DEMO_GROUPS,
  DEMO_PROCESSES,
  DEMO_REPOS,
  DEMO_SETTINGS,
  buildGraph,
  demoDetail,
  relationsFrom,
} from "@renderer/lib/demo-library";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const parentOf = (path: string): string => {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
};

const baseNameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const joinPath = (parent: string, child: string): string =>
  `${parent.replace(/\/+$/, "")}/${child}`;

/** Is `path` at or below `folder`? The trailing slash is what makes `/Codex` not match `/Code`. */
function isInside(path: string, folder: string): boolean {
  const root = folder.replace(/\/+$/, "");
  return path === root || path.startsWith(`${root}/`);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** A completed batch, kept so the undo bar has something to reverse. */
interface MoveBatch {
  batchId: string;
  at: string;
  kind: "repos" | "folder";
  label: string;
  records: Array<{ slug: string; fromPath: string; toPath: string }>;
}

interface DemoState {
  repos: Repo[];
  links: RepoLink[];
  settings: SettingsZ;
  batches: MoveBatch[];
}

const cloneRepo = (repo: Repo): Repo => ({
  ...repo,
  tags: repo.tags.map((tag) => ({ ...tag })),
  languages: repo.languages.map((language) => ({ ...language })),
});

/**
 * The seed's three assertions, in the shape the panel reads them back in.
 *
 * The seed names repos by name and the store keys them by slug, so these are
 * translated once here rather than at every use.
 */
function seeded(): RepoLink[] {
  const slugOfName = new Map(DEMO_REPOS.map((repo) => [repo.name, repo.slug]));
  return DEMO_CURATED_LINKS.map((link, index) => ({
    id: index + 1,
    fromSlug: slugOfName.get(link.from) ?? link.from,
    toSlug: slugOfName.get(link.to) ?? link.to,
    kind: link.kind,
    why: link.why,
    source: "ui" as const,
    createdAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  }));
}

const state: DemoState = {
  repos: DEMO_REPOS.map(cloneRepo),
  links: seeded(),
  // The two optional contract fields are named explicitly: `Settings` lets a
  // pre-3a blob omit them, and everything downstream of here wants them set.
  settings: {
    ...DEMO_SETTINGS,
    scanPaths: [...DEMO_SETTINGS.scanPaths],
    defaultTerminal: DEMO_SETTINGS.defaultTerminal ?? null,
    adHocNoticeDismissed: DEMO_SETTINGS.adHocNoticeDismissed ?? false,
  },
  batches: [],
};

/** Bumped by every write, so the memoized graph knows it is stale. */
let version = 0;
let graphVersion = -1;
let graphCache: GraphResult | null = null;

const touch = (): void => {
  version += 1;
};

const now = (): string => new Date().toISOString();

/** Repos with a process running out of them — the same rule the mover applies. */
const busySlugs = (): Set<string> =>
  new Set(
    DEMO_PROCESSES.processes
      .map((row) => row.repoSlug)
      .filter((slug): slug is string => Boolean(slug)),
  );

const blockersMessage = (blockers: Array<MoveBlocker | FolderBlocker>): string =>
  blockers.join(", ");

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function listRepos(): Repo[] {
  return state.repos;
}

export function findRepo(slug: string): Repo | null {
  return state.repos.find((repo) => repo.slug === slug) ?? null;
}

/**
 * One repo's detail panel.
 *
 * The README and the group come from the frozen library (neither can change in
 * a tab), but every mutable field — path, tags, favourite — is read off the
 * store's copy, which is what makes an edit visible here at once.
 */
export function detail(slug: string): RepoDetail | null {
  const repo = findRepo(slug);
  if (!repo) return null;
  const base = demoDetail(slug);
  return {
    ...repo,
    readmeContent: base?.readmeContent ?? null,
    groups: base?.groups ?? [],
  };
}

/**
 * The relationship map, rebuilt whenever something that feeds it changed.
 *
 * Favourites decide which nodes are stars, folders decide where a cluster's
 * members actually live (and therefore the "scattered" count), and the curated
 * list is the accent arrows — so all three come from live state rather than the
 * constants the map was first drawn with.
 */
export function graph(): GraphResult {
  if (graphCache && graphVersion === version) return graphCache;
  const nameOfSlug = new Map(state.repos.map((repo) => [repo.slug, repo.name]));
  graphCache = buildGraph(
    state.links.map((link) => ({
      from: nameOfSlug.get(link.fromSlug) ?? link.fromSlug,
      to: nameOfSlug.get(link.toSlug) ?? link.toSlug,
      kind: link.kind,
      why: link.why ?? "no reason recorded",
    })),
    state.repos,
  );
  graphVersion = version;
  return graphCache;
}

export function relations(slug: string): RepoRelationsResult {
  return relationsFrom(graph(), slug);
}

export function settings(): Settings {
  return state.settings;
}

export function groups(): Group[] {
  return DEMO_GROUPS;
}

export function countUnder(path: string): number {
  return state.repos.filter((repo) => isInside(repo.fullPath, path)).length;
}

// ---------------------------------------------------------------------------
// Catalog writes
// ---------------------------------------------------------------------------

/** Star or unstar. Returns the updated repo, or `null` when it is not ours. */
export function setFavorite(slug: string, favorite: boolean): Repo | null {
  const repo = findRepo(slug);
  if (!repo) return null;
  repo.isFavorite = favorite;
  repo.favoritedAt = favorite ? now() : null;
  repo.updatedAt = now();
  touch();
  return repo;
}

export function setTags(slug: string, tags: string[]): Repo {
  const repo = requireRepo(slug);
  // `source: "user"` because that is what an edit through the UI means: it
  // outranks anything inferred from the code.
  repo.tags = tags.map((value) => ({ value, source: "user" as const }));
  repo.updatedAt = now();
  touch();
  return repo;
}

function requireRepo(slug: string): Repo {
  const repo = findRepo(slug);
  if (!repo) throw new Error(`No repo in the catalog with slug ${slug}.`);
  return repo;
}

/** Drop one catalog row. The repo on disk is untouched — there is no disk. */
export function forgetRepo(slug: string): { slug: string; deleted: boolean } {
  const index = state.repos.findIndex((repo) => repo.slug === slug);
  if (index === -1) return { slug, deleted: false };
  state.repos.splice(index, 1);
  state.links = state.links.filter(
    (link) => link.fromSlug !== slug && link.toSlug !== slug,
  );
  touch();
  return { slug, deleted: true };
}

/** Re-stamp one repo's scan time and return it, as `catalog:rescan` does. */
export function rescan(slug: string): RescanRepoResult {
  const repo = requireRepo(slug);
  repo.lastScannedAt = now();
  touch();
  return repo;
}

// ---------------------------------------------------------------------------
// Curated links
// ---------------------------------------------------------------------------

export function assertLink(input: {
  fromSlug: string;
  toSlug: string;
  kind: RepoLinkKind;
  why?: string | null;
}): AssertRepoLinkResult {
  requireRepo(input.fromSlug);
  requireRepo(input.toSlug);
  if (input.fromSlug === input.toSlug) {
    throw new Error("A repo cannot be linked to itself.");
  }
  // Idempotent on (from, to, kind): asserting the same link twice is the same
  // link, and the panel's button can be pressed twice without doubling an arrow.
  const existing = state.links.find(
    (link) =>
      link.fromSlug === input.fromSlug &&
      link.toSlug === input.toSlug &&
      link.kind === input.kind,
  );
  if (existing) return { link: existing };

  const nextId = state.links.reduce((max, link) => Math.max(max, link.id), 0) + 1;
  const link: RepoLink = {
    id: nextId,
    fromSlug: input.fromSlug,
    toSlug: input.toSlug,
    kind: input.kind,
    why: input.why ?? null,
    source: "ui",
    createdAt: now(),
  };
  state.links.push(link);
  touch();
  return { link };
}

export function removeLink(input: {
  fromSlug: string;
  toSlug: string;
  kind: RepoLinkKind;
}): RemoveRepoLinkResult {
  const before = state.links.length;
  state.links = state.links.filter(
    (link) =>
      !(
        link.fromSlug === input.fromSlug &&
        link.toSlug === input.toSlug &&
        link.kind === input.kind
      ),
  );
  const removed = state.links.length !== before;
  if (removed) touch();
  return { removed };
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

function destinationTaken(toPath: string): boolean {
  return state.repos.some((repo) => repo.fullPath === toPath);
}

/**
 * The preflight, rule for rule against `services/move.ts`.
 *
 * Ordered most- to least-severe, matching main, so the reason a reviewer reads
 * first here is the reason the app would give.
 */
export function moveCheck(slugs: string[], targetDir: string): MoveCheckResult {
  const target = targetDir.replace(/\/+$/, "") || "/";
  const allowed = state.settings.scanPaths.some((root) => isInside(target, root));
  const busy = busySlugs();

  const entries: MoveCheckEntry[] = slugs.map((slug) => {
    const repo = findRepo(slug);
    if (!repo) {
      return {
        slug,
        name: slug,
        fromPath: "",
        toPath: "",
        ok: false,
        blockers: ["unknown-repo"],
      };
    }
    const fromPath = repo.fullPath;
    const toPath = joinPath(target, baseNameOf(fromPath));
    const blockers: MoveBlocker[] = [];
    if (repo.isDirty) blockers.push("dirty");
    if (busy.has(slug)) blockers.push("running-process");
    if (fromPath === toPath) blockers.push("same-location");
    if (!allowed) blockers.push("target-outside-roots");
    if (isInside(target, fromPath)) blockers.push("target-inside-source");
    if (fromPath !== toPath && destinationTaken(toPath)) {
      blockers.push("destination-exists");
    }
    return {
      slug,
      name: repo.name,
      fromPath,
      toPath,
      ok: blockers.length === 0,
      blockers,
    };
  });

  return {
    targetDir: target,
    entries,
    movableCount: entries.filter((entry) => entry.ok).length,
    blockedCount: entries.filter((entry) => !entry.ok).length,
  };
}

/**
 * Move a batch.
 *
 * `fullPath` changes; the slug does not — main keeps the row key and rewrites
 * `full_path`, so the selection, the links and the open detail panel all
 * survive the move exactly as they do in the app.
 */
export function move(slugs: string[], targetDir: string): MoveResult {
  const check = moveCheck(slugs, targetDir);
  const performed: MoveBatch["records"] = [];

  const entries: MoveEntryResult[] = check.entries.map((entry) => {
    if (!entry.ok) {
      return {
        slug: entry.slug,
        moved: false,
        fromPath: entry.fromPath,
        toPath: entry.toPath,
        error: blockersMessage(entry.blockers),
      };
    }
    const repo = findRepo(entry.slug);
    if (repo) {
      repo.fullPath = entry.toPath;
      repo.updatedAt = now();
      performed.push({
        slug: entry.slug,
        fromPath: entry.fromPath,
        toPath: entry.toPath,
      });
    }
    return {
      slug: entry.slug,
      moved: true,
      fromPath: entry.fromPath,
      toPath: entry.toPath,
      error: null,
    };
  });

  touch();
  return {
    targetDir: check.targetDir,
    entries,
    movedCount: performed.length,
    failedCount: entries.length - performed.length,
    batchId: performed.length > 0 ? recordBatch("repos", performed) : null,
  };
}

function recordBatch(kind: MoveBatch["kind"], records: MoveBatch["records"]): string {
  const count = records.length;
  const batch: MoveBatch = {
    batchId: `demo-batch-${state.batches.length + 1}`,
    at: now(),
    kind,
    label:
      kind === "repos"
        ? `moved ${count} ${count === 1 ? "repo" : "repos"}`
        : `moved ${baseNameOf(records[0]?.fromPath ?? "")}`,
    records,
  };
  state.batches.push(batch);
  return batch.batchId;
}

/** Reverse a batch, newest by default. Consumed, like the journal's entry. */
export function moveUndo(batchId?: string): MoveResult {
  const batch = batchId
    ? state.batches.find((candidate) => candidate.batchId === batchId)
    : state.batches[state.batches.length - 1];
  if (!batch) {
    return {
      targetDir: "",
      entries: [],
      movedCount: 0,
      failedCount: 0,
      batchId: null,
    };
  }

  const entries: MoveEntryResult[] = batch.records.map((record) => {
    const repo = findRepo(record.slug);
    if (repo) {
      repo.fullPath = record.fromPath;
      repo.updatedAt = now();
    }
    return {
      slug: record.slug,
      moved: true,
      fromPath: record.toPath,
      toPath: record.fromPath,
      error: null,
    };
  });

  state.batches = state.batches.filter((candidate) => candidate !== batch);
  touch();
  return {
    targetDir: parentOf(batch.records[0]?.fromPath ?? ""),
    entries,
    movedCount: entries.length,
    failedCount: 0,
    batchId: null,
  };
}

export function moveLast(): MoveLastResult {
  const batch = state.batches[state.batches.length - 1];
  if (!batch) return null;
  return {
    batchId: batch.batchId,
    at: batch.at,
    count: batch.records.length,
    kind: batch.kind,
    label: batch.label,
  };
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/**
 * What a folder move would do to the repos inside it.
 *
 * A browser tab has no folders of its own: the tree you see is derived from the
 * repos' paths. That makes "move this folder" mean "re-path every repo under
 * it", which is exactly the part a reviewer needs to watch, and it is why
 * `folderCreate` is refused — there is nothing to create it in.
 */
export function folderCheck(fromPath: string, toPath: string): FolderCheckResult {
  const from = fromPath.replace(/\/+$/, "");
  const to = toPath.replace(/\/+$/, "");
  const busy = busySlugs();

  const affected = state.repos
    .filter((repo) => isInside(repo.fullPath, from))
    .map((repo) => ({
      slug: repo.slug,
      name: repo.name,
      fromPath: repo.fullPath,
      toPath: joinPath(to, repo.fullPath.slice(from.length + 1)),
      isDirty: repo.isDirty,
      hasProcess: busy.has(repo.slug),
    }));

  const blockers: FolderBlocker[] = [];
  if (affected.length === 0) blockers.push("missing");
  if (from === to) blockers.push("same-location");
  if (!state.settings.scanPaths.some((root) => isInside(to, root))) {
    blockers.push("target-outside-roots");
  }
  if (isInside(to, from)) blockers.push("target-inside-source");
  if (state.settings.scanPaths.includes(from)) blockers.push("is-scan-root");
  if (affected.some((entry) => entry.isDirty)) blockers.push("dirty-repos");
  if (affected.some((entry) => entry.hasProcess)) blockers.push("running-processes");
  if (destinationTaken(to)) blockers.push("destination-exists");

  return { fromPath: from, toPath: to, affected, blockers, ok: blockers.length === 0 };
}

/** Rename a folder, re-pathing every repo inside it. */
export function folderRename(fromPath: string, newName: string): FolderOpResult {
  const from = fromPath.replace(/\/+$/, "");
  return applyFolderMove(from, joinPath(parentOf(from), newName));
}

/** Move a folder under another parent. */
export function folderMove(fromPath: string, parentPath: string): FolderOpResult {
  const from = fromPath.replace(/\/+$/, "");
  return applyFolderMove(from, joinPath(parentPath, baseNameOf(from)));
}

function applyFolderMove(from: string, to: string): FolderOpResult {
  const check = folderCheck(from, to);
  if (!check.ok) {
    return {
      ok: false,
      fromPath: check.fromPath,
      toPath: check.toPath,
      movedRepos: 0,
      batchId: null,
      error: blockersMessage(check.blockers),
    };
  }

  const records: MoveBatch["records"] = [];
  for (const entry of check.affected) {
    const repo = findRepo(entry.slug);
    if (!repo) continue;
    repo.fullPath = entry.toPath;
    repo.updatedAt = now();
    records.push({ slug: entry.slug, fromPath: entry.fromPath, toPath: entry.toPath });
  }
  touch();
  return {
    ok: true,
    fromPath: check.fromPath,
    toPath: check.toPath,
    movedRepos: records.length,
    batchId: recordBatch("folder", records),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function updateSettings(patch: Partial<Settings>): Settings {
  // Merged in place, and only for keys the caller actually sent: spreading a
  // `Partial` would let an absent `defaultTerminal` blank the field.
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  Object.assign(state.settings, defined);
  touch();
  return state.settings;
}

export function addScanPath(path: string): AddScanPathResult {
  const trimmed = path.replace(/\/+$/, "") || "/";
  if (state.settings.scanPaths.includes(trimmed)) {
    return {
      settings: state.settings,
      added: false,
      reason: "That folder is already in your scan roots.",
    };
  }
  state.settings.scanPaths = [...state.settings.scanPaths, trimmed];
  touch();
  return { settings: state.settings, added: true, reason: null };
}

/**
 * Drop a scan root.
 *
 * `forgetRepos` decides the rows, exactly as main's scan-root service does:
 * left false they stay in the catalog (and surface under "Outside scan
 * folders"), set true they are dropped. Nothing on disk is involved either way.
 */
export function removeScanPath(
  path: string,
  forgetRepos: boolean,
): {
  settings: Settings;
  removed: boolean;
  forgotten: number;
  reason: string | null;
} {
  const trimmed = path.replace(/\/+$/, "") || "/";
  if (!state.settings.scanPaths.includes(trimmed)) {
    return {
      settings: state.settings,
      removed: false,
      forgotten: 0,
      reason: "That folder isn't in your scan list.",
    };
  }
  const forgotten = forgetRepos ? countUnder(trimmed) : 0;
  if (forgetRepos) {
    state.repos = state.repos.filter((repo) => !isInside(repo.fullPath, trimmed));
    // A forgotten repo takes its links with it.
    const kept = new Set(state.repos.map((repo) => repo.slug));
    state.links = state.links.filter(
      (link) => kept.has(link.fromSlug) && kept.has(link.toSlug),
    );
  }
  state.settings.scanPaths = state.settings.scanPaths.filter((root) => root !== trimmed);
  touch();
  return { settings: state.settings, removed: true, forgotten, reason: null };
}
