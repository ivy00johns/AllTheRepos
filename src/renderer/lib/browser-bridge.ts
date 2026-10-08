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
 * next read shows it. The rules the main process enforces are enforced there,
 * including the ones that make a write fail: a dirty tree still blocks a move.
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
  countUnder,
  detail,
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

/**
 * The unavailable-write reason, so the UI can explain itself.
 *
 * Only for the operations a browser tab cannot perform at all — everything the
 * demo store can honour is honoured.
 */
const NO_WRITES = "Browser bridge — the Electron main process is not running.";

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
        const offset = input?.offset ?? 0;
        const items = repos.slice(offset, offset + (input?.limit ?? repos.length));
        return {
          items,
          total: repos.length,
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
      // folder to put anywhere — saying it worked would be a lie.
      folderCreate: async () => ({
        ok: false,
        reason: "The browser bridge has no folders of its own — create one by moving a repo into it.",
      }) as never,
    },
    scan: {
      start: async () => ({ started: false, reason: NO_WRITES }) as never,
      status: async () => {
        await ready;
        return {
          running: false,
          scanned: listRepos().length,
          total: listRepos().length,
        } as never;
      },
      cancel: async () => ({ cancelled: false }) as never,
      onProgress: noSubscription as never,
    },
    git: {
      fetch: async () => ({ results: [] }) as never,
      pull: async () => ({ results: [] }) as never,
      status: async () => ({ branch: "main", ahead: 0, behind: 0, dirty: false }) as never,
      branches: async () => ({ branches: [], current: "main" }) as never,
      openInEditor: async () => ({ ok: false, reason: NO_WRITES }) as never,
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
      delete: async () => ({ deleted: false, reason: NO_WRITES }) as never,
      setMembers: async () => refused(),
    },
    app: {
      setDockBadge: async () => ({ ok: true }) as never,
      notify: async () => ({ ok: false }) as never,
      showSpotlight: async () => ({ ok: false }) as never,
      hideSpotlight: async () => ({ ok: false }) as never,
      registerActions: async () => ({ registered: 0 }) as never,
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
 * Install the demo bridge when no real one is present. Returns whether it did,
 * so a caller (or a test) can tell the difference.
 */
export function installBrowserBridge(): boolean {
  if (typeof window === "undefined") return false;
  if (window.atr) return false;

  // Kicked before the first read and awaited by every read that needs it: the
  // export is a fetch, and the first catalog read happens on mount, so a tab
  // that did not wait would paint the demo library and swap it a frame later.
  const ready = loadExportedCatalog(EXPORT_URL);
  window.atr = buildBridge(ready);
  console.info(
    "[browser-bridge] No Electron preload bridge found — installing the dev " +
      "bridge so every route renders in a browser tab: catalog, repo detail, " +
      "/graph, /claude, /processes and /settings. Writes that change the " +
      "catalog — favourites, tags, curated links, moves, folder renames, scan " +
      "roots — apply to a session-local copy and are lost on reload; the rest " +
      "are refused with a reason. \n" +
      "[browser-bridge] The library being served is named on the next line. With " +
      `no export at ${EXPORT_URL} it is the demo library (${listRepos().length} ` +
      `repos under ${DEMO_ROOT}); run \`node scripts/export-catalog.mjs\` to ` +
      "review your own catalog instead. Run `pnpm electron:dev` for the app itself.",
  );
  return true;
}
