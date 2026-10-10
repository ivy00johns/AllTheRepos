/**
 * A stand-in for the Electron preload bridge, for a plain browser tab.
 *
 * The renderer is served over http by `electron-vite dev`, and opening that URL
 * directly is the quickest way to look at the UI — except every screen reads
 * `window.atr`, which only exists when Electron mounted the preload script.
 * Without a bridge the catalog renders empty and the first click that needs the
 * main process rejects with "preload bridge is not mounted", which is an
 * uncaught error in the console rather than a UI state.
 *
 * So: when there is no bridge, install one that answers from
 * {@link "../../lib/demo-library"} — the same 12-repo demo library the README
 * screenshots are built from, extended to cover every read the app makes.
 * Catalog, repo detail (README, tasks, curated links), the relationship map,
 * the Claude views, the process list with its port chips, and settings all
 * render without Electron.
 *
 * Writes are the other half. {@link "../../lib/demo-store"} owns a mutable copy
 * of that library, and this bridge routes every write the app can honour in a
 * browser — favourite, tags, curated links, moves, folder renames, scan roots —
 * through it, so a click that changes the catalog changes it here too and the
 * next read shows it. Those writes are saved to this browser's `localStorage`,
 * so they are still there after a reload: a review that forgot the favourite it
 * just set on every refresh was not much of a review. `?reset-edits` on the URL
 * starts from the catalog alone: it drops the saved edits *and* the saved view
 * (scope, sort, folder, filters), because a filter alone can hide every row. The rules the main process enforces are
 * enforced there, including the ones that make a write fail: a dirty tree still
 * blocks a move.
 *
 * What a browser tab genuinely cannot do is refused, with a reason, rather than
 * pretended: nothing runs a process, opens an editor, installs an update or
 * creates a folder on a disk that is not there. Nothing here can make the UI
 * claim something was saved that was not.
 *
 * Safety: it installs ONLY when `window.atr` is absent. Electron always mounts
 * the real bridge (dev and packaged alike), so this can never shadow real IPC;
 * it is reachable only from a browser tab or a `file://` load with no preload.
 */

import type { SyncResult } from "@shared/types";

import type { AtrBridge } from "@renderer/lib/atr";
import {
  DEMO_LAUNCHER,
  DEMO_PROCESSES,
  DEMO_UPDATE,
  DEMO_CLAUDE_PROJECTS,
  DEMO_ROOT,
  demoClaudeRepoState,
  demoGlobalUsage,
  demoTasks,
  demoTranscript,
} from "@renderer/lib/demo-library";
import {
  addScanPath,
  assertLink,
  clearPersistedEdits,
  countUnder,
  defaultStorage,
  detail,
  enablePersistence,
  loadExportedCatalog,
  type CatalogSource,
  folderCheck,
  folderMove,
  folderRename,
  forgetRepo,
  graph,
  groups,
  listRepos,
  move,
  moveCheck,
  moveLast,
  moveUndo,
  relations,
  removeLink,
  removeScanPath,
  rescan,
  setFavorite,
  setTags,
  settings,
  updateSettings,
} from "@renderer/lib/demo-store";
import { PERSIST_KEY as CATALOG_VIEW_PERSIST_KEY, useCatalogView } from "@renderer/stores/catalog-view";
import { PERSIST_KEY as UI_PERSIST_KEY, useUiStore } from "@renderer/stores/ui";

/**
 * The unavailable-write reason, so the UI can explain itself.
 *
 * Only for the operations a browser tab cannot perform at all — everything the
 * demo store can honour is honoured.
 */
const NO_WRITES = "Browser bridge — the Electron main process is not running.";

/**
 * A `SyncResult` for a tab that cannot reach a remote.
 *
 * Git sync is a main-process job against the repos on disk, so there is nothing
 * behind it here. The *shape* matters as much as the refusal: the caller counts
 * `result.entries`, and answering with a key that does not exist (`{ results: [] }`)
 * left `catalog-shell` walking `undefined` — an uncaught rejection behind a sync
 * notice stuck on "Fetching 5…" forever. One `failed` entry per requested repo
 * says what happened and where to do it for real.
 */
function refusedSync(slugs: string[]): SyncResult {
  const nameBySlug = new Map(listRepos().map((repo) => [repo.slug, repo.name]));
  const entries = slugs.map((slug) => ({
    slug,
    name: nameBySlug.get(slug) ?? slug,
    outcome: "failed" as const,
    received: 0,
    ahead: 0,
    behind: 0,
    currentBranch: null,
    message: "A browser tab cannot reach a remote — run pnpm electron:dev to fetch or pull.",
  }));
  return { entries, updated: 0, failed: entries.length };
}

/**
 * Where the dev server serves an exported catalog, when one exists.
 *
 * `scripts/export-catalog.mjs` writes the file and a dev-only middleware in
 * `electron.vite.config.ts` serves it, so a browser tab can render the library
 * this machine actually holds instead of the demo one. Absent — the normal case
 * for a fresh checkout — reads fall back to the demo library.
 */
const EXPORT_URL = "/__atr/catalog.json";

/**
 * A slug no demo repo can have, whose state the demo library reports as empty.
 *
 * The Claude reads are keyed by slug, so this is how the bridge asks for a
 * genuinely empty state without inventing one: `demoClaudeRepoState` already
 * returns the shape it uses for the repos it has nothing to say about.
 */
const UNMATCHED_SLUG = "__browser_bridge__";

const refused = (): never => {
  throw new Error(NO_WRITES);
};

/** A subscription that never fires; returns the unsubscribe lambda hooks expect. */
const noSubscription = () => () => {};

const now = () => Date.now();

/**
 * Which library a browser tab ended up reading, and who is watching for that.
 *
 * `installBrowserBridge` is a no-op under Electron — the preload bridge is
 * always there — so nothing below is reached in the app, and a marker built on
 * it cannot appear in one. In a tab the answer is not known until
 * `loadExportedCatalog` settles: an export may exist at {@link EXPORT_URL}, in
 * which case the tab is reading this machine's own catalog and must not be
 * marked, and it may not, in which case every read is answered from the demo
 * library — invented repos, invented processes, and an invented update. A
 * screen full of those has to say so, which is why the answer is published here
 * rather than guessed at the point of display.
 */
let servedLibrary: CatalogSource | null = null;
const servedLibraryListeners = new Set<(source: CatalogSource) => void>();

/** The library this tab is reading; null while that is still being decided. */
export function servedCatalogSource(): CatalogSource | null {
  return servedLibrary;
}

/** Watch for the library this tab reads. Returns the unsubscribe lambda. */
export function subscribeToServedCatalogSource(
  listener: (source: CatalogSource) => void,
): () => void {
  servedLibraryListeners.add(listener);
  return () => {
    servedLibraryListeners.delete(listener);
  };
}

function publishServedLibrary(source: CatalogSource): void {
  servedLibrary = source;
  for (const listener of servedLibraryListeners) listener(source);
}

/**
 * The honest answers for machine state a browser tab cannot read.
 *
 * A process snapshot, Claude usage and a session transcript all come from this
 * machine's own kernel, `~/.claude` and its transcript files. Only the process
 * snapshot reaches the renderer by IPC; the rest is read straight from disk by
 * the main process. An exported catalog says nothing about any of them, so the
 * empty shapes are what it is served, and an empty state is a state the UI
 * already renders.
 */
const emptyProcessSnapshot = () => ({ processes: [], snapshotAt: now() });

const EMPTY_USAGE = {
  totalTokens: 0,
  byProject: [],
  byDay: [],
  byWeek: [],
  byMonth: [],
};

/**
 * Build the bridge around a hydration promise.
 *
 * Every read waits for it: the export is a fetch, and the first catalog read
 * happens on mount, so without awaiting it a tab would paint the demo library
 * and swap it a frame later. The promise is settled exactly once and never
 * rejects — `loadExportedCatalog` answers with the source it fell back to — so
 * waiting on it costs nothing after the first read.
 */
function buildBridge(ready: Promise<CatalogSource>): AtrBridge {
  /** Answer machine-state reads from the empty state once a catalog is loaded. */
  const hasExportedCatalog = async (): Promise<boolean> =>
    (await ready) === "export";

  return {
    system: {
      // The `/debug` route renders `pong`, `mainProcessPid` and `receivedAt`,
      // so a bare `{ ok: true }` would leave three blank fields on screen.
      ping: async () => ({
        ok: true,
        pong: "pong",
        mainProcessPid: 0,
        receivedAt: new Date().toISOString(),
      }) as never,
    },
    catalog: {
      list: async (input) => {
        await ready;
        // Deliberately unfiltered: the shell derives the rail, the folder
        // selection and the chips from the full list rather than asking main
        // for each one, so pre-filtering here would empty those surfaces.
        const repos = listRepos();
        const limit = input?.limit ?? repos.length;
        const offset = input?.offset ?? 0;
        const items = repos.slice(offset, offset + limit);
        return {
          items,
          total: repos.length,
          // `ListReposResult` is `{ items, total, limit, offset }`. Echoing the
          // window is what lets a caller page; without them a consumer reading
          // `limit` got nothing to advance by.
          limit,
          offset,
          snapshotAt: now(),
        } as never;
      },
      get: async ({ slug }) => {
        await ready;
        return detail(slug) as never;
      },
      search: async (input) => {
        await ready;
        const query = input?.q?.trim().toLowerCase() ?? "";
        const hits = query
          ? listRepos()
              .filter((repo) =>
                [repo.name, repo.description ?? "", repo.fullPath, ...repo.tags.map((t) => t.value)]
                  .join(" ")
                  .toLowerCase()
                  .includes(query),
              )
              .map((repo) => ({
                repo,
                score: 1,
                matchKind: "fts" as const,
                snippet: repo.description,
              }))
          : [];
        return {
          hits,
          semantic: {
            state: "off",
            reason: "no-vector-store",
            detail: "The browser bridge has no index to search.",
          },
        } as never;
      },
      rescan: async ({ slug }) => {
        await ready;
        return rescan(slug) as never;
      },
      setTags: async ({ slug, tags }) => {
        await ready;
        return setTags(slug, tags) as never;
      },
      delete: async ({ slug }) => {
        await ready;
        return forgetRepo(slug) as never;
      },
      // The real handler is a Phase-4 stub that returns `[]`; answering from the
      // demo library instead would show a feature the app does not have yet.
      smartFilter: async () => [] as never,
      cover: async () => ({ src: null, source: null, relativePath: null }) as never,
      moveCheck: async ({ slugs, targetDir }) => {
        await ready;
        return moveCheck(slugs, targetDir) as never;
      },
      move: async ({ slugs, targetDir }) => {
        await ready;
        return move(slugs, targetDir) as never;
      },
      moveUndo: async ({ batchId }) => {
        await ready;
        return moveUndo(batchId) as never;
      },
      moveLast: async () => {
        await ready;
        return moveLast() as never;
      },
      onChanged: noSubscription as never,
      setFavorite: async ({ slug, favorite }) => {
        await ready;
        return setFavorite(slug, favorite) as never;
      },
      folderCheck: async ({ fromPath, toPath }) => {
        await ready;
        return folderCheck(fromPath, toPath) as never;
      },
      folderRename: async ({ fromPath, newName }) => {
        await ready;
        return folderRename(fromPath, newName) as never;
      },
      folderMove: async ({ fromPath, parentPath }) => {
        await ready;
        return folderMove(fromPath, parentPath) as never;
      },
      // The demo tree is derived from the repos' paths, so there is no empty
      // folder to put anywhere. `FolderOpResult` has an `error` field, so the
      // refusal is expressible and keeps the shape a caller can read.
      folderCreate: async ({ parentPath, name }) => ({
        ok: false,
        fromPath: "",
        toPath: `${parentPath}/${name}`,
        movedRepos: 0,
        batchId: null,
        error: "The browser bridge has no folders of its own — create one by moving a repo into it.",
      }) as never,
    },
    scan: {
      // `StartScanResult` is `{ jobId, status: "running", startedAt }` — there is
      // no field in which to say "I did not start". A tab cannot walk the disk,
      // so it refuses the way the group writes do rather than reporting a job
      // that does not exist.
      start: async () => refused(),
      // A job a tab has never run reports `unknown`, which is in the status
      // enum for exactly this. `startedAt` has no nullable form, so it carries
      // the epoch: no job started, and `status` is what says so.
      status: async ({ jobId }) => {
        await ready;
        return {
          jobId,
          status: "unknown",
          processed: 0,
          total: 0,
          startedAt: new Date(0).toISOString(),
          endedAt: null,
          errorMessage: "The browser bridge does not scan.",
        } as never;
      },
      cancel: async ({ jobId }) => ({ jobId, cancelled: false }) as never,
      onProgress: noSubscription as never,
    },
    git: {
      fetch: async ({ slugs }) => {
        await ready;
        return refusedSync(slugs) as never;
      },
      pull: async ({ slugs }) => {
        await ready;
        return refusedSync(slugs) as never;
      },
      // `GitStatus` is `{ slug, isDirty, ahead, behind, currentBranch, upstream }`.
      // The export knows the branch name and the dirty flag from the scan, so
      // those are answered with; ahead/behind and the upstream name are reads
      // against the remote, which a tab cannot make, and are reported unknown.
      status: async ({ slug }) => {
        await ready;
        const repo = listRepos().find((row) => row.slug === slug);
        return {
          slug,
          isDirty: repo?.isDirty ?? false,
          ahead: 0,
          behind: 0,
          currentBranch: repo?.currentBranch ?? null,
          upstream: null,
        } as never;
      },
      // The result is the array itself, not an object around one. A tab knows
      // of no branches to offer, which is the panel's empty state.
      branches: async () => [] as never,
      openInEditor: async () => ({ opened: false, uri: null }) as never,
    },
    tasks: {
      // Scripts are read from each repo's `package.json` on disk, so an export
      // has none — the panel's empty state is the honest answer, and the demo
      // rows belong to repos that are not in an exported catalog.
      list: async ({ slug }) => {
        await ready;
        return { tasks: (await hasExportedCatalog()) ? [] : demoTasks(slug) } as never;
      },
      start: async () => ({ runId: null, started: false, reason: NO_WRITES }) as never,
      stop: async () => ({ stopped: false }) as never,
      active: async () => ({ runs: [] }) as never,
      onOutput: noSubscription as never,
    },
    graph: {
      build: async () => {
        await ready;
        return graph() as never;
      },
      links: async ({ slug }) => {
        await ready;
        return relations(slug) as never;
      },
      link: async (input) => assertLink(input) as never,
      unlink: async (input) => removeLink(input) as never,
    },
    update: {
      check: async () => DEMO_UPDATE as never,
      status: async () => DEMO_UPDATE as never,
      openRelease: async () => ({ opened: false, reason: NO_WRITES }) as never,
      install: async () => ({ started: false, reason: NO_WRITES }) as never,
      onStatus: noSubscription as never,
    },
    settings: {
      get: async () => {
        await ready;
        return settings() as never;
      },
      update: async (patch) => {
        await ready;
        return updateSettings(patch) as never;
      },
      pickScanPath: async () => ({ path: null }) as never,
      addScanPath: async ({ path }) => {
        await ready;
        return addScanPath(path) as never;
      },
      removeScanPath: async ({ path, forgetRepos }) => {
        await ready;
        return removeScanPath(path, forgetRepos) as never;
      },
      countUnder: async ({ path }) => {
        await ready;
        return { count: countUnder(path) } as never;
      },
    },
    groups: {
      list: async () => {
        await ready;
        return groups() as never;
      },
      // Membership in the demo is derived from where a repo lives, so a group
      // edit could not change anything a reviewer would then see. Refused
      // rather than answered with an unrelated group.
      create: async () => refused(),
      rename: async () => refused(),
      // `deleted` is `z.literal(true)`, so a result cannot say "nothing was
      // deleted" — the same reason the other three refuse.
      delete: async () => refused(),
      setMembers: async () => refused(),
    },
    app: {
      // `SetDockBadgeResult` is `{ badge }` — the badge text LEFT on the icon.
      // A tab has no dock, so the honest answer is the empty string.
      setDockBadge: async () => ({ badge: "" }) as never,
      // `{ shown }` can say no, so this is a refusal in the result shape.
      notify: async () => ({ shown: false }) as never,
      // `visible` is `z.literal(true)`: the result type exists to confirm the
      // window appeared, and a tab has no window to show. Refuse.
      showSpotlight: async () => refused(),
      // "not visible" is both true and expressible.
      hideSpotlight: async () => ({ visible: false }) as never,
      registerActions: async ({ actions }) => ({ accepted: 0, skipped: actions.length }) as never,
      toggleDevtools: () => {},
      onMenuCommand: noSubscription as never,
      onDeepLink: noSubscription as never,
      onOpenRepo: noSubscription as never,
    },
    menu: { onCommand: noSubscription as never },
    protocol: { onDeepLink: noSubscription as never },
    tray: { onOpenRepo: noSubscription as never },
    process: {
      // The same snapshot for all three reads: the list is a poll and the
      // refresh is a sweep, so answering them differently would make the cards'
      // port chips change the moment somebody opened the processes page.
      //
      // With an exported catalog the answer is empty rather than the demo rows:
      // listing a TCP listener means running `lsof` on this machine, which a
      // browser tab cannot do, and the demo rows describe repos that are not in
      // the export — chips pointing at them would be fiction.
      list: async () => {
        await ready;
        return (await hasExportedCatalog()
          ? emptyProcessSnapshot()
          : DEMO_PROCESSES) as never;
      },
      listForRepo: async ({ slug }) => {
        await ready;
        return {
          processes: (await hasExportedCatalog())
            ? []
            : DEMO_PROCESSES.processes.filter((row) => row.repoSlug === slug),
          snapshotAt: now(),
        } as never;
      },
      refresh: async () => {
        await ready;
        return (await hasExportedCatalog()
          ? emptyProcessSnapshot()
          : DEMO_PROCESSES) as never;
      },
      kill: async ({ pid }) => ({
        pid,
        finalSignal: "noop",
        stopped: false,
        durationMs: 0,
      }) as never,
      onUpdate: noSubscription as never,
    },
    launcher: {
      detect: async () => DEMO_LAUNCHER as never,
      openInEditor: async () => ({ ok: false, reason: NO_WRITES }) as never,
      openInTerminal: async () => ({ ok: false, reason: NO_WRITES }) as never,
      openInFinder: async () => ({ ok: false, reason: NO_WRITES }) as never,
      openRemote: async () => ({ ok: false, reason: NO_WRITES }) as never,
      copyPath: async () => ({ ok: false, reason: NO_WRITES }) as never,
    },
    claude: {
      // Same reasoning as `process`: Claude state is read from `~/.claude` and
      // `~/.claude.json` on this machine, so an export has none and the demo's
      // projects are about repos that are not in it.
      index: async () => {
        await ready;
        return {
          projectCount: (await hasExportedCatalog()) ? 0 : DEMO_CLAUDE_PROJECTS.length,
          sessionCount: (await hasExportedCatalog())
            ? 0
            : DEMO_CLAUDE_PROJECTS.reduce((sum, p) => sum + p.sessionCount, 0),
          totalTokens: (await hasExportedCatalog())
            ? 0
            : DEMO_CLAUDE_PROJECTS.reduce((sum, p) => sum + p.totalTokens, 0),
          durationMs: 0,
        } as never;
      },
      projects: async () => {
        await ready;
        return { projects: (await hasExportedCatalog()) ? [] : DEMO_CLAUDE_PROJECTS } as never;
      },
      repoState: async ({ slug }) => {
        await ready;
        return demoClaudeRepoState(
          (await hasExportedCatalog()) ? UNMATCHED_SLUG : slug,
        ) as never;
      },
      sessionTranscript: async ({ sessionId, cursor }) => {
        await ready;
        if (await hasExportedCatalog()) {
          // The envelope, with its contents removed: the demo transcript is
          // generated for whatever id it is handed, so it would happily page a
          // fake session into a tab reading a real catalog.
          const empty = demoTranscript(UNMATCHED_SLUG, 0);
          return { ...empty, events: [], hasMore: false, nextCursor: null } as never;
        }
        return demoTranscript(sessionId, cursor ?? 0) as never;
      },
      globalUsage: async (input) => {
        await ready;
        return (await hasExportedCatalog()
          ? EMPTY_USAGE
          : demoGlobalUsage(input ?? {})) as never;
      },
      launch: async () => ({ ok: false, reason: NO_WRITES }) as never,
      openClaudeMd: async () => ({ ok: false, reason: NO_WRITES }) as never,
      onUpdate: noSubscription as never,
    },
  };
}

/**
 * Forget everything the renderer remembers about *how* the catalog was being
 * looked at.
 *
 * `?reset-edits` promises to "start from the catalog alone", and clearing the
 * demo store's edit record is only half of that. The scope, view mode, grouping,
 * sort, folder selection, ownership filter and `favoritesOnly` are persisted by
 * `stores/catalog-view.ts`, and the search/language/tag filter by
 * `stores/ui.ts` — each under its own key — and a filter intersection can hide
 * every row. Measured in the running app: *Mine* left the catalog at `30 of 271`,
 * *Favourites* took it to `0 of 271`, and adding `?reset-edits=1` to the URL
 * brought it back at `0 of 271` too, with nothing on screen but the rail rows'
 * own highlight to say why. A reviewer following the bridge's own instructions
 * saw an empty catalog and no reason for it.
 *
 * Both halves are needed, and neither alone is enough:
 *
 *   - the stores are put back to their initial state, because zustand hydrates
 *     them as `stores/*` is imported — which happens before this runs — so
 *     removing the key alone would leave the tab that is open now still filtered;
 *   - the keys are removed *after* that, so the *next* load starts clean too.
 *
 * Returns whether it could reach a storage. The in-memory half runs either way:
 * with no `localStorage` there is nothing to forget between loads, but the state
 * a fresh document hydrates to is still the state this makes sure of.
 */
export function resetPersistedViewState(): boolean {
  const storage = defaultStorage();

  // Replacing rather than merging: the initial state is the whole answer, and a
  // merge would leave behind any key this store no longer has.
  //
  // Best-effort, and deliberately so: each `setState` is also a persist write,
  // and a storage that refuses writes — full, or disabled by the platform —
  // would otherwise throw out of `installBrowserBridge` and take the whole
  // renderer down at boot. The state is already set by the time a failing write
  // reaches this catch, so the reset still happens where it matters.
  try {
    useCatalogView.setState(useCatalogView.getInitialState(), true);
    useUiStore.setState(useUiStore.getInitialState(), true);
  } catch {
    // Nothing to do about a storage that will not write; the in-memory half is
    // the half that makes the tab that is open now clean.
  }

  // Removed last, not first: that `setState` is a persist write, so a remove
  // before it would be undone by the write that follows.
  for (const key of [CATALOG_VIEW_PERSIST_KEY, UI_PERSIST_KEY]) {
    try {
      storage?.removeItem(key);
    } catch {
      // Nothing was stored under it, or the storage refuses removes: either way
      // there is nothing left to forget.
    }
  }

  return storage !== null;
}

/**
 * Install the demo bridge when no real one is present. Returns whether it did,
 * so a caller (or a test) can tell the difference.
 */
export function installBrowserBridge(): boolean {
  if (typeof window === "undefined") return false;
  if (window.atr) return false;

  // A reviewer who wants the catalog as it is can ask for that in the URL,
  // rather than reaching for a button in a page that may not be reachable. The
  // edits are read lazily by the demo store, so clearing them here is early
  // enough; the view stores hydrate at import, so theirs is reset in place.
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("reset-edits")) {
    clearPersistedEdits();
    resetPersistedViewState();
    console.info(
      "[browser-bridge] ?reset-edits — cleared the edits and the saved view this browser had.",
    );
  }
  // Before the first read, so what it restores is on screen from the first
  // paint; with no localStorage the store simply keeps its session-local copy.
  enablePersistence();

  // Kicked before the first read and awaited by every read that needs it: the
  // export is a fetch, and the first catalog read happens on mount, so a tab
  // that did not wait would paint the demo library and swap it a frame later.
  const ready = loadExportedCatalog(EXPORT_URL);
  // Published when it settles, not at install time: an export that exists means
  // this tab is reading the machine's own catalog, and marking that as invented
  // would be its own lie.
  void ready.then(publishServedLibrary);
  window.atr = buildBridge(ready);
  console.info(
    "[browser-bridge] No Electron preload bridge found — installing the dev " +
      "bridge so every route renders in a browser tab: catalog, repo detail, " +
      "/graph, /claude, /processes and /settings. Writes that change the " +
      "catalog — favourites, tags, curated links, moves, folder renames, scan " +
      "roots — are applied to a copy this browser keeps in localStorage, so they " +
      "survive a reload; add ?reset-edits to the URL to start from the catalog " +
      "alone. The rest are refused with a reason. \n" +
      "[browser-bridge] The library being served is named on the next line. With " +
      `no export at ${EXPORT_URL} it is the demo library (${listRepos().length} ` +
      `repos under ${DEMO_ROOT}); run \`node scripts/export-catalog.mjs\` to ` +
      "review your own catalog instead. Run `pnpm electron:dev` for the app itself.",
  );
  return true;
}
