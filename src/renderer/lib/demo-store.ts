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
 * shows the change. It is not a mock: every rule the main process enforces is
 * enforced here too, including the ones that make a write fail, and nothing is
 * written to the database or the filesystem a browser tab does not have.
 *
 * Those writes outlive the tab. Each one is recorded as the smallest edit that
 * can be replayed — the field values it set, not a snapshot of the catalog — and
 * the record is saved to `localStorage`, so a reload re-applies it on top of
 * whatever library is being served. That keeps the export live: re-running
 * `scripts/export-catalog.mjs` produces a fresh catalog and the edits still land
 * on it, because an edit names a `slug` and a `field`, not a row. The store is
 * keyed per library (demo and export keep separate records), the export's own
 * edits are ignored when the demo library is serving and vice versa, and none of
 * it is touched until the browser bridge asks for it — see `enablePersistence`,
 * which the bridge calls at install.
 *
 * Two things deliberately stay session-local: a move batch's undo entry (the
 * moved path persists; the undo bar is a per-session affordance, like a shell's
 * history) and the derived signals the map reads — an export carries none, so
 * the store cannot invent them.
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
  GraphCluster,
  GraphNode,
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

// The schemas, at runtime, on purpose: an export is a file on disk that this
// bundle did not produce, and the bridge stands in for the IPC boundary — which
// validates every answer on the way out. A shape mismatch here would render a
// broken panel rather than a refusal, so it is parsed before it is trusted.
// Zod is the cost of that, and it is the same dependency the handlers use.
import {
  GroupSchema,
  RepoLinkKindSchema,
  RepoLinkSchema,
  RepoSchema,
  SettingsSchema,
  TagSchema,
  type SettingsZ,
} from "@shared/schemas";
import { z } from "zod";

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

/** A repo's panel data that the export carries: the README and its groups. */
interface ExportedDetail {
  readmeContent: string | null;
  groups: Array<{ id: number; name: string }>;
}

interface DemoState {
  /** Which library is being served — the demo one, or an exported catalog. */
  source: CatalogSource;
  repos: Repo[];
  groups: Group[];
  links: RepoLink[];
  settings: SettingsZ;
  /** Only populated in export mode; the demo reads its detail from the seed. */
  detail: Map<string, ExportedDetail>;
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

/**
 * The catalog, as `scripts/export-catalog.mjs` writes it.
 *
 * `format` is versioned so a stale file is refused with a reason instead of
 * half-loaded, and every field is the shape the IPC layer would have returned:
 * the export is a snapshot of what the app holds, not a second dialect.
 */
const ExportedCatalogSchema = z.object({
  format: z.number().int(),
  exportedAt: z.string(),
  dbPath: z.string(),
  repos: z.array(RepoSchema),
  groups: z.array(GroupSchema),
  detail: z.record(
    z.object({
      readmeContent: z.string().nullable(),
      groups: z.array(z.object({ id: z.number(), name: z.string() })),
    }),
  ),
  links: z.array(RepoLinkSchema),
  settings: SettingsSchema,
});

/** What this build knows how to load. */
const EXPORT_FORMAT = 1;

export type CatalogSource = "demo" | "export";

const state: DemoState = {
  source: "demo",
  repos: DEMO_REPOS.map(cloneRepo),
  groups: DEMO_GROUPS,
  links: seeded(),
  detail: new Map(),
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
// Persistence
// ---------------------------------------------------------------------------

/**
 * Where the edits are kept between reloads — `localStorage`, in a browser tab.
 *
 * Narrowed to three methods on purpose: the store only ever reads one key,
 * writes it and deletes it, and a test can supply a `Map`-backed stand-in
 * without pretending to be the whole Web Storage API.
 */
export interface EditStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * One repo's edits, recorded as the values to write back on replay.
 *
 * Every field is optional and absolute, because that is what makes a replay
 * safe: absent means "the catalog's own value", present means "this is what a
 * person chose", so a fresh export with newer data is never blanked by an edit
 * that only touched a favourite.
 */
const PersistedRepoEditSchema = z.object({
  fullPath: z.string().min(1).optional(),
  isFavorite: z.boolean().optional(),
  favoritedAt: z.string().nullable().optional(),
  tags: z.array(TagSchema).optional(),
  lastScannedAt: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
  deleted: z.literal(true).optional(),
});

/** A curated link to assert, in the shape the store can rebuild it from. */
const PersistedAddedLinkSchema = z.object({
  fromSlug: z.string().min(1),
  toSlug: z.string().min(1),
  kind: RepoLinkKindSchema,
  why: z.string().nullable(),
  createdAt: z.string(),
});

/** A curated link to drop, identified the way `removeLink` identifies one. */
const PersistedRemovedLinkSchema = z.object({
  fromSlug: z.string().min(1),
  toSlug: z.string().min(1),
  kind: RepoLinkKindSchema,
});

/**
 * The edit record for one library, as it is stored.
 *
 * `source` is in the record itself as well as in the key it is stored under, so
 * a record that is moved between the two is refused rather than replayed against
 * a library whose slugs it describes only by accident.
 */
const PersistedEditsSchema = z.object({
  format: z.number().int(),
  source: z.enum(["demo", "export"]),
  repos: z.record(PersistedRepoEditSchema),
  links: z.object({
    added: z.array(PersistedAddedLinkSchema),
    removed: z.array(PersistedRemovedLinkSchema),
  }),
  settings: SettingsSchema.optional(),
});

type PersistedEdits = z.infer<typeof PersistedEditsSchema>;

/** What this build knows how to replay. */
const EDITS_FORMAT = 1;

/**
 * A key per library, not one shared record.
 *
 * Demo slugs and export slugs are different repos, so replaying one library's
 * edits onto the other would set a real repo's favourite from a demo one's — or
 * silently drop the edit. Two keys also mean switching between them (run the
 * export, then delete the file) does not destroy either set.
 */
const editsKey = (source: CatalogSource): string => `atr.browser-bridge.edits.v${EDITS_FORMAT}.${source}`;

/**
 * `localStorage` when this context has one; `null` when it does not.
 *
 * Exported because a caller that forgets persisted state has the same problem
 * this module does — a hardened context can throw on the property access
 * itself, not just be missing the object — and should not solve it twice.
 */
export function defaultStorage(): EditStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Some hardened/disabled contexts throw on the property access itself.
    return null;
  }
}

const emptyEdits = (source: CatalogSource): PersistedEdits => ({
  format: EDITS_FORMAT,
  source,
  repos: {},
  links: { added: [], removed: [] },
});

/**
 * The settings, copied.
 *
 * A settings write records the whole settings object rather than one key,
 * because the scan roots are the field that matters and they are replaced, not
 * patched — and a reference would let a later in-place write change the record
 * without it being re-saved.
 */
const snapshotSettings = (): SettingsZ => ({
  ...state.settings,
  scanPaths: [...state.settings.scanPaths],
  identities: [...state.settings.identities],
});

/** The storage the record is kept in, once the bridge has asked for it. */
let storage: EditStorage | null = null;
let persistenceOn = false;
let edits: PersistedEdits = emptyEdits("demo");

const countEdits = (blob: PersistedEdits): number =>
  Object.keys(blob.repos).length + blob.links.added.length + blob.links.removed.length +
  (blob.settings ? 1 : 0);

/**
 * Read one library's record, refusing anything this build cannot replay.
 *
 * The blob is as external as an export — `localStorage` is writable by any
 * script on the origin and survives across builds — so it is parsed against the
 * same kind of schema before it is trusted, and a mismatch is a warning and a
 * fresh start rather than a half-applied catalog.
 */
function readEdits(store: EditStorage, source: CatalogSource): PersistedEdits | null {
  let raw: string | null;
  try {
    raw = store.getItem(editsKey(source));
  } catch (error) {
    console.warn("[demo-store] could not read saved edits — starting from the catalog alone.", error);
    return null;
  }
  if (!raw) return null;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.warn(
      "[demo-store] the saved browser-bridge edits are not valid JSON — starting from the " +
        "catalog alone. Add ?reset-edits to the URL to clear them.",
    );
    return null;
  }

  const parsed = PersistedEditsSchema.safeParse(json);
  if (!parsed.success || parsed.data.format !== EDITS_FORMAT || parsed.data.source !== source) {
    console.warn(
      "[demo-store] the saved browser-bridge edits were written by a different build (or for " +
        "another library) — ignoring them. Add ?reset-edits to the URL to clear them.",
    );
    return null;
  }
  return parsed.data;
}

/**
 * Save the record after a write.
 *
 * A failure here (quota, a disabled store) turns persistence off with a warning
 * rather than throwing into a catalog write: the edit itself already landed in
 * the running store, and a tab that could not save it should still be usable.
 */
function persistEdits(): void {
  if (!persistenceOn || !storage) return;
  try {
    storage.setItem(editsKey(state.source), JSON.stringify(edits));
  } catch (error) {
    persistenceOn = false;
    console.warn(
      "[demo-store] could not save this session's catalog edits — they will be lost on " +
        "reload.",
      error,
    );
  }
}

/** The record for one slug, created on first edit. */
function editRepo(slug: string): PersistedEdits["repos"][string] {
  return (edits.repos[slug] ??= {});
}

/** Record a repo write, then save. The one call every repo-touching write makes. */
function rememberRepoEdit(
  slug: string,
  patch: PersistedEdits["repos"][string],
): void {
  Object.assign(editRepo(slug), patch);
  persistEdits();
}

const linkKey = (link: { fromSlug: string; toSlug: string; kind: RepoLinkKind }): string =>
  `${link.fromSlug}\u0000${link.toSlug}\u0000${link.kind}`;

/** A link asserted here — and no longer one of the base's, if it was removed before. */
function rememberAddedLink(link: RepoLink): void {
  const key = linkKey(link);
  edits.links.removed = edits.links.removed.filter((candidate) => linkKey(candidate) !== key);
  edits.links.added = edits.links.added.filter((candidate) => linkKey(candidate) !== key);
  edits.links.added.push({
    fromSlug: link.fromSlug,
    toSlug: link.toSlug,
    kind: link.kind,
    why: link.why,
    createdAt: link.createdAt,
  });
  persistEdits();
}

/** A link removed here, dropped from the added list so add-then-remove is a no-op. */
function rememberRemovedLink(link: { fromSlug: string; toSlug: string; kind: RepoLinkKind }): void {
  const key = linkKey(link);
  edits.links.added = edits.links.added.filter((candidate) => linkKey(candidate) !== key);
  if (!edits.links.removed.some((candidate) => linkKey(candidate) === key)) {
    edits.links.removed.push({ fromSlug: link.fromSlug, toSlug: link.toSlug, kind: link.kind });
  }
  persistEdits();
}

/**
 * Re-apply the record on top of whatever the base just loaded.
 *
 * Tolerant by design: an edit whose repo is no longer in the catalog is skipped
 * (a fresh export of a repo you deleted on disk), and a link whose ends are
 * missing is not drawn at all. Ids for re-asserted links are re-issued from the
 * loaded catalog, so they are stable across reloads without the record having
 * to store them.
 */
function replayEdits(): void {
  const blob = edits;
  if (blob.settings) Object.assign(state.settings, blob.settings);

  const deleted = new Set<string>();
  for (const [slug, edit] of Object.entries(blob.repos)) {
    const repo = findRepo(slug);
    if (!repo) continue;
    if (edit.deleted) {
      deleted.add(slug);
      continue;
    }
    if (edit.fullPath !== undefined) repo.fullPath = edit.fullPath;
    if (edit.isFavorite !== undefined) repo.isFavorite = edit.isFavorite;
    if (edit.favoritedAt !== undefined) repo.favoritedAt = edit.favoritedAt;
    if (edit.tags !== undefined) repo.tags = edit.tags.map((tag) => ({ ...tag }));
    if (edit.lastScannedAt !== undefined) repo.lastScannedAt = edit.lastScannedAt;
    if (edit.updatedAt !== undefined) repo.updatedAt = edit.updatedAt;
  }

  if (deleted.size > 0) {
    state.repos = state.repos.filter((repo) => !deleted.has(repo.slug));
    // A dropped row takes its links with it, exactly as `forgetRepo` does.
    state.links = state.links.filter(
      (link) => !deleted.has(link.fromSlug) && !deleted.has(link.toSlug),
    );
  }

  for (const removal of blob.links.removed) {
    const key = linkKey(removal);
    state.links = state.links.filter((link) => linkKey(link) !== key);
  }
  for (const addition of blob.links.added) {
    if (!findRepo(addition.fromSlug) || !findRepo(addition.toSlug)) continue;
    const key = linkKey(addition);
    if (state.links.some((link) => linkKey(link) === key)) continue;
    const nextId = state.links.reduce((max, link) => Math.max(max, link.id), 0) + 1;
    state.links.push({
      id: nextId,
      fromSlug: addition.fromSlug,
      toSlug: addition.toSlug,
      kind: addition.kind,
      why: addition.why,
      source: "ui",
      createdAt: addition.createdAt,
    });
  }
  touch();
}

/** Load the record for `source` and replay it. A no-op while persistence is off. */
function hydrateEdits(source: CatalogSource): void {
  if (!persistenceOn || !storage) return;
  const restored = readEdits(storage, source);
  edits = restored ?? emptyEdits(source);
  if (!restored) return;
  const count = countEdits(restored);
  if (count > 0) replayEdits();
  console.info(
    `[demo-store] restored ${count} catalog edit${count === 1 ? "" : "s"} saved by this ` +
      `browser for the ${source} library — they survive a reload. Add ?reset-edits to the URL ` +
      "to start from the catalog alone.",
  );
}

/**
 * Persist this browser's catalog edits.
 *
 * Called once by the browser bridge at install, before the first catalog read,
 * so the edits it restores are on screen from the first paint. Returns whether
 * it could — with no `localStorage` (a `file://` page, a disabled store) the
 * store keeps applying writes to itself and simply does not survive a reload,
 * which is the behavior every write had before this existed.
 */
export function enablePersistence(candidate?: EditStorage | null): boolean {
  if (persistenceOn) return true;
  const store = candidate ?? defaultStorage();
  if (!store) {
    console.info(
      "[demo-store] this context has no localStorage — catalog edits apply to this session " +
        "only and are lost on reload.",
    );
    return false;
  }
  storage = store;
  persistenceOn = true;
  hydrateEdits(state.source);
  return true;
}

/** A read for diagnostics, and for the bridge's own banner. */
export function persistenceEnabled(): boolean {
  return persistenceOn;
}

/**
 * Forget every saved edit, for both libraries, and stop replaying them.
 *
 * It clears the storage, not the running store: the bridge calls it as it
 * installs (behind `?reset-edits`), before anything has been hydrated, so the
 * tab comes up on the plain catalog. Live state is untouched by design, which
 * keeps this from having to un-apply a move.
 */
export function clearPersistedEdits(candidate?: EditStorage | null): boolean {
  const store = candidate ?? storage ?? defaultStorage();
  if (!store) return false;
  for (const source of ["demo", "export"] as const) {
    try {
      store.removeItem(editsKey(source));
    } catch {
      // Nothing was stored; there is nothing to remove.
    }
  }
  edits = emptyEdits(state.source);
  return true;
}

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
 * The README and the groups come from wherever the catalog came from — the
 * export carries both, and in demo mode the seed does — while every mutable
 * field (path, tags, favourite) is read off the store's copy, which is what
 * makes an edit visible here at once. Neither can change in a tab: a README is
 * read from disk by the scanner, and group membership is a table write.
 */
export function detail(slug: string): RepoDetail | null {
  const repo = findRepo(slug);
  if (!repo) return null;
  const base = state.source === "export" ? state.detail.get(slug) : demoDetail(slug);
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
  const built = buildGraph(
    state.links.map((link) => ({
      from: nameOfSlug.get(link.fromSlug) ?? link.fromSlug,
      to: nameOfSlug.get(link.toSlug) ?? link.toSlug,
      kind: link.kind,
      why: link.why ?? "no reason recorded",
    })),
    state.repos,
  );
  // An exported catalog has no derived signals — those come from reading
  // `package.json` and `.gitmodules` on disk, which this process cannot do — so
  // the clusters it can honestly draw are the folders its repos live in.
  graphCache =
    state.source === "export"
      ? { ...built, clusters: clusterByFolder(built) }
      : built;
  graphVersion = version;
  return graphCache;
}

/** One cluster per folder, which is the strongest grouping an export supports. */
function clusterByFolder(built: GraphResult): GraphCluster[] {
  const byFolder = new Map<string, GraphNode[]>();
  for (const node of built.nodes) {
    const list = byFolder.get(node.folder) ?? [];
    list.push(node);
    byFolder.set(node.folder, list);
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, nodes], index) => {
      const slugs = nodes.map((node) => node.slug);
      return {
        id: index,
        label: folder.slice(folder.lastIndexOf("/") + 1) || folder,
        size: slugs.length,
        slugs,
        folders: [{ folder, count: slugs.length }],
        // Members are together by definition, so nothing here is scattered.
        folderSpread: 1,
        dominantFolder: folder,
        strays: [],
      };
    });
}

export function relations(slug: string): RepoRelationsResult {
  return relationsFrom(graph(), slug);
}

export function settings(): Settings {
  return state.settings;
}

export function groups(): Group[] {
  return state.groups;
}

/** Which library reads are answered from — the demo one, or an export. */
export function source(): CatalogSource {
  return state.source;
}

/** Replace the store's contents with an exported catalog. */
function applyExport(parsed: z.infer<typeof ExportedCatalogSchema>): void {
  state.repos = parsed.repos.map(cloneRepo);
  state.groups = parsed.groups;
  state.links = parsed.links;
  state.settings = parsed.settings;
  state.detail = new Map(
    Object.entries(parsed.detail).map(([slug, entry]) => [
      slug,
      { readmeContent: entry.readmeContent, groups: entry.groups },
    ]),
  );
  // Batches describe moves made in this session, and this one replaced them.
  state.batches = [];
  state.source = "export";
  // Which record applies changed with the base: this browser's edits for the
  // exported catalog, replayed on top of the rows it just loaded.
  hydrateEdits("export");
  touch();
}

/**
 * Serve an exported catalog when one is there, and the demo library when not.
 *
 * Called once, at bridge install. Everything that can go wrong is a fallback
 * rather than a failure, because a browser tab with no export is the normal
 * case: a 404 is the dev server saying nobody has run the export, and it is
 * reported at info level with the command that produces one. A file that exists
 * but does not match the schema is different — that is a stale or hand-edited
 * export, and it is reported as a warning with the first issue found, because
 * silently serving the demo library over a file somebody expected to work is
 * the failure mode worth shouting about.
 */
export async function loadExportedCatalog(url: string): Promise<CatalogSource> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      console.info(
        `[demo-store] no catalog export at ${url} (HTTP ${response.status}) — serving the demo ` +
          "library. Run `node scripts/export-catalog.mjs` to review your own.",
      );
      return state.source;
    }

    const parsed = ExportedCatalogSchema.safeParse(await response.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      console.warn(
        `[demo-store] the catalog export at ${url} does not match the format this build expects ` +
          `(${issue?.path.join(".") || "root"}: ${issue?.message ?? "unknown issue"}) — serving the ` +
          "demo library. Re-run `node scripts/export-catalog.mjs`.",
      );
      return state.source;
    }
    if (parsed.data.format !== EXPORT_FORMAT) {
      console.warn(
        `[demo-store] the catalog export at ${url} is format ${parsed.data.format}, and this ` +
          `build reads format ${EXPORT_FORMAT} — serving the demo library. Re-run ` +
          "`node scripts/export-catalog.mjs`.",
      );
      return state.source;
    }

    applyExport(parsed.data);
    console.info(
      `[demo-store] serving your exported catalog: ${parsed.data.repos.length} repos, ` +
        `${parsed.data.groups.length} groups and ${parsed.data.links.length} curated links from ` +
        `${parsed.data.dbPath} (exported ${parsed.data.exportedAt}). Writes apply to this ` +
        "browser's copy of it.",
    );
    return state.source;
  } catch (error) {
    console.warn(
      `[demo-store] the catalog export at ${url} could not be read — serving the demo library.`,
      error,
    );
    return state.source;
  }
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
  rememberRepoEdit(slug, {
    isFavorite: repo.isFavorite,
    favoritedAt: repo.favoritedAt,
    updatedAt: repo.updatedAt,
  });
  touch();
  return repo;
}

export function setTags(slug: string, tags: string[]): Repo {
  const repo = requireRepo(slug);
  // `source: "user"` because that is what an edit through the UI means: it
  // outranks anything inferred from the code.
  repo.tags = tags.map((value) => ({ value, source: "user" as const }));
  repo.updatedAt = now();
  rememberRepoEdit(slug, {
    tags: repo.tags.map((tag) => ({ ...tag })),
    updatedAt: repo.updatedAt,
  });
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
  rememberRepoEdit(slug, { deleted: true });
  touch();
  return { slug, deleted: true };
}

/** Re-stamp one repo's scan time and return it, as `catalog:rescan` does. */
export function rescan(slug: string): RescanRepoResult {
  const repo = requireRepo(slug);
  repo.lastScannedAt = now();
  rememberRepoEdit(slug, { lastScannedAt: repo.lastScannedAt });
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
  rememberAddedLink(link);
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
  if (removed) {
    touch();
    rememberRemovedLink(input);
  }
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
      const edit = editRepo(entry.slug);
      edit.fullPath = entry.toPath;
      edit.updatedAt = repo.updatedAt;
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

  // Saved once for the batch, not once per repo: a folder move re-paths every
  // repo inside it and each save would re-serialise the whole record.
  if (performed.length > 0) persistEdits();
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
      const edit = editRepo(record.slug);
      edit.fullPath = record.fromPath;
      edit.updatedAt = repo.updatedAt;
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
  if (entries.length > 0) persistEdits();
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
    const edit = editRepo(entry.slug);
    edit.fullPath = entry.toPath;
    edit.updatedAt = repo.updatedAt;
    records.push({ slug: entry.slug, fromPath: entry.fromPath, toPath: entry.toPath });
  }
  if (records.length > 0) persistEdits();
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
  edits.settings = snapshotSettings();
  touch();
  persistEdits();
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
  edits.settings = snapshotSettings();
  touch();
  persistEdits();
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
    // Each row is marked before it goes, so a reload drops them again.
    for (const repo of state.repos) {
      if (isInside(repo.fullPath, trimmed)) editRepo(repo.slug).deleted = true;
    }
    state.repos = state.repos.filter((repo) => !isInside(repo.fullPath, trimmed));
    // A forgotten repo takes its links with it.
    const kept = new Set(state.repos.map((repo) => repo.slug));
    state.links = state.links.filter(
      (link) => kept.has(link.fromSlug) && kept.has(link.toSlug),
    );
  }
  state.settings.scanPaths = state.settings.scanPaths.filter((root) => root !== trimmed);
  edits.settings = snapshotSettings();
  touch();
  persistEdits();
  return { settings: state.settings, removed: true, forgotten, reason: null };
}
