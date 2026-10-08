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

const refused = (): never => {
  throw new Error(NO_WRITES);
};

/** A subscription that never fires; returns the unsubscribe lambda hooks expect. */
const noSubscription = () => () => {};

const now = () => Date.now();

function buildBridge(): AtrBridge {
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
      get: async ({ slug }) => detail(slug) as never,
      search: async (input) => {
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
      rescan: async ({ slug }) => rescan(slug) as never,
      setTags: async ({ slug, tags }) => setTags(slug, tags) as never,
      delete: async ({ slug }) => forgetRepo(slug) as never,
      // The real handler is a Phase-4 stub that returns `[]`; answering from the
      // demo library instead would show a feature the app does not have yet.
      smartFilter: async () => [] as never,
      cover: async () => ({ src: null, source: null, relativePath: null }) as never,
      moveCheck: async ({ slugs, targetDir }) => moveCheck(slugs, targetDir) as never,
      move: async ({ slugs, targetDir }) => move(slugs, targetDir) as never,
      moveUndo: async ({ batchId }) => moveUndo(batchId) as never,
      moveLast: async () => moveLast() as never,
      onChanged: noSubscription as never,
      setFavorite: async ({ slug, favorite }) => setFavorite(slug, favorite) as never,
      folderCheck: async ({ fromPath, toPath }) => folderCheck(fromPath, toPath) as never,
      folderRename: async ({ fromPath, newName }) =>
        folderRename(fromPath, newName) as never,
      folderMove: async ({ fromPath, parentPath }) =>
        folderMove(fromPath, parentPath) as never,
      // The demo tree is derived from the repos' paths, so there is no empty
      // folder to put anywhere — saying it worked would be a lie.
      folderCreate: async () => ({
        ok: false,
        reason: "The browser bridge has no folders of its own — create one by moving a repo into it.",
      }) as never,
    },
    scan: {
      start: async () => ({ started: false, reason: NO_WRITES }) as never,
      status: async () => ({
        running: false,
        scanned: listRepos().length,
        total: listRepos().length,
      }) as never,
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
      list: async ({ slug }) => ({ tasks: demoTasks(slug) }) as never,
      start: async () => ({ runId: null, started: false, reason: NO_WRITES }) as never,
      stop: async () => ({ stopped: false }) as never,
      active: async () => ({ runs: [] }) as never,
      onOutput: noSubscription as never,
    },
    graph: {
      build: async () => graph() as never,
      links: async ({ slug }) => relations(slug) as never,
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
      get: async () => settings() as never,
      update: async (patch) => updateSettings(patch) as never,
      pickScanPath: async () => ({ path: null }) as never,
      addScanPath: async ({ path }) => addScanPath(path) as never,
      removeScanPath: async ({ path, forgetRepos }) =>
        removeScanPath(path, forgetRepos) as never,
      countUnder: async ({ path }) => ({ count: countUnder(path) }) as never,
    },
    groups: {
      list: async () => groups() as never,
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
      list: async () => DEMO_PROCESSES as never,
      listForRepo: async ({ slug }) => ({
        processes: DEMO_PROCESSES.processes.filter((row) => row.repoSlug === slug),
        snapshotAt: now(),
      }) as never,
      refresh: async () => DEMO_PROCESSES as never,
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
      index: async () => ({
        projectCount: DEMO_CLAUDE_PROJECTS.length,
        sessionCount: DEMO_CLAUDE_PROJECTS.reduce((sum, p) => sum + p.sessionCount, 0),
        totalTokens: DEMO_CLAUDE_PROJECTS.reduce((sum, p) => sum + p.totalTokens, 0),
        durationMs: 0,
      }) as never,
      projects: async () => ({ projects: DEMO_CLAUDE_PROJECTS }) as never,
      repoState: async ({ slug }) => demoClaudeRepoState(slug) as never,
      sessionTranscript: async ({ sessionId, cursor }) =>
        demoTranscript(sessionId, cursor ?? 0) as never,
      globalUsage: async (input) => demoGlobalUsage(input ?? {}) as never,
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

  window.atr = buildBridge();
  console.info(
    "[browser-bridge] No Electron preload bridge found — serving the demo " +
      `library (${listRepos().length} repos under ${DEMO_ROOT}) for every route: ` +
      "catalog, repo detail, /graph, /claude, /processes and /settings. " +
      "Writes that change the catalog — favourites, tags, curated links, moves, " +
      "folder renames, scan roots — apply to a session-local copy and are lost " +
      "on reload; the rest are refused with a reason. " +
      "Run `pnpm electron:dev` for the app against your own library.",
  );
  return true;
}
