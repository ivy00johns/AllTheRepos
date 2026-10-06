/**
 * CONTRACT v1 — IPC channel name registry.
 *
 * All IPC channel names used by main / preload / renderer MUST be
 * referenced through this module. Hard-coded strings in `ipcMain.handle`
 * or `ipcRenderer.invoke` are a contract violation.
 *
 * Channels are namespaced by domain with a `:` separator
 * (e.g. `system:ping`, `catalog:list`). Phase 0 only registers the
 * `system` namespace; future phases will add `catalog:*`, `git:*`,
 * `scan:*`, `claude:*`, `process:*`, `launcher:*`, `settings:*`.
 *
 * The literal-string `as const` typing here is what lets TypeScript
 * pin channel names so a typo in a handler key becomes a compile error.
 */

/**
 * IPC channel map. Add new channels here as later phases unlock.
 *
 * Convention: `<namespace>:<verb>` — namespace is lowercase, single word
 * where possible. Use `<namespace>:on:<event>` for push-style streams
 * (renderer subscribes via `ipcRenderer.on`, main pushes via
 * `webContents.send`).
 *
 * Phase 0 channels: `SYSTEM.*` (stable v1).
 * Phase 1 channels: `CATALOG.*`, `SCAN.*`, `GIT.*`, `SETTINGS.*`, `GROUPS.*`.
 * Phase 2 channels: `APP.*` (dock / notify / spotlight / actions registry),
 *                   `MENU.ON_COMMAND`, `PROTOCOL.ON_DEEP_LINK`,
 *                   `TRAY.ON_OPEN_REPO` (all push-style events).
 */
export const IPC = {
  /** System namespace — health checks, app lifecycle, version info. */
  SYSTEM: {
    /** Trivial round-trip used to validate the preload bridge. */
    PING: "system:ping",
  },

  /** Catalog namespace — repo list / detail / search / tags. */
  CATALOG: {
    /** Paginated repo list with filters. */
    LIST: "catalog:list",
    /** Single repo detail by slug. */
    GET: "catalog:get",
    /** Hybrid FTS + vector search. */
    SEARCH: "catalog:search",
    /** Refresh metadata for one repo. */
    RESCAN: "catalog:rescan",
    /** ATR-028: remove one repo row from the catalog (never touches disk). */
    DELETE: "catalog:delete",
    /** Overwrite user tags (heuristic tags preserved). */
    SET_TAGS: "catalog:setTags",
    /** LLM-tagged smart filter (Phase 4 feature, contract locked now). */
    SMART_FILTER: "catalog:smartFilter",
    /**
     * Resolve a repo's own cover artwork (README hero or a conventional
     * image path on disk). Returns `null` when the project ships none —
     * the renderer then draws deterministic generated art.
     */
    COVER: "catalog:cover",
    /** Preflight a relocation: per-repo verdict, nothing touched. */
    MOVE_CHECK: "catalog:moveCheck",
    /** Execute a relocation on disk and update the catalog. */
    MOVE: "catalog:move",
    /** Reverse a journaled move batch. */
    MOVE_UNDO: "catalog:moveUndo",
    /** Describe the most recent move batch, for the undo affordance. */
    MOVE_LAST: "catalog:moveLast",
    /**
     * Push-style stream from main → renderer. Fired when the filesystem
     * watcher notices repos appearing, moving or disappearing under a
     * scan root. Payload conforms to `CatalogChangeEventSchema`.
     */
    ON_CHANGED: "catalog:on:changed",
    /** Pin / unpin a repo. */
    SET_FAVORITE: "catalog:setFavorite",
    /** Preflight a folder rename/move: which repos travel, what blocks it. */
    FOLDER_CHECK: "catalog:folderCheck",
    /** Rename a folder in place. */
    FOLDER_RENAME: "catalog:folderRename",
    /** Move a folder into a different parent. */
    FOLDER_MOVE: "catalog:folderMove",
    /** Create an empty folder inside a scan root. */
    FOLDER_CREATE: "catalog:folderCreate",
  },

  /** Scan namespace — scanner job lifecycle + progress stream. */
  SCAN: {
    /** Start a new scan; returns a jobId. */
    START: "scan:start",
    /** Poll status by jobId. */
    STATUS: "scan:status",
    /** Cooperative cancel by jobId. */
    CANCEL: "scan:cancel",
    /**
     * Push-style stream from main → renderer via `webContents.send`.
     * Payloads conform to `ScanEventSchema` (`progress|repo|done|error`).
     */
    ON_PROGRESS: "scan:on:progress",
  },

  /** Git namespace — per-repo git status / branches / launch. */
  GIT: {
    /** Returns isDirty + ahead/behind for a repo. */
    STATUS: "git:status",
    /** List local branches. */
    BRANCHES: "git:branches",
    /** Launch editor via shell.openExternal allowlist (deepened in Phase 2). */
    OPEN_IN_EDITOR: "git:openInEditor",
    /** Update remote refs for one or many repos. Never touches the tree. */
    FETCH: "git:fetch",
    /** Fast-forward one or many repos to their upstream. */
    PULL: "git:pull",
  },

  /**
   * Tasks namespace — the runnable commands a project declares
   * (npm scripts, Makefile targets, compose services, …) and their
   * execution.
   */
  TASKS: {
    /** Discover the tasks a repo declares. */
    LIST: "tasks:list",
    /** Start a task; output arrives on `TASKS.ON_OUTPUT`. */
    START: "tasks:start",
    /** Stop a running task and everything it spawned. */
    STOP: "tasks:stop",
    /** Runs currently in flight, so the UI can restore state on mount. */
    ACTIVE: "tasks:active",
    /** Push-style stdout/stderr/lifecycle stream. */
    ON_OUTPUT: "tasks:on:output",
  },

  /**
   * Graph namespace — how projects relate to each other, and which
   * clusters are scattered across folders.
   */
  GRAPH: {
    /** Build the relationship graph from the catalog + on-disk reads. */
    BUILD: "graph:build",
  },

  /**
   * Update namespace — checks whether a newer release exists.
   * Installing stays manual while the app ships unsigned; see
   * `services/updater.ts`.
   */
  UPDATE: {
    /** Ask GitHub whether there's a newer release. */
    CHECK: "update:check",
    /** Read the last known status without triggering a check. */
    STATUS: "update:status",
    /** Push-style status stream (checking / available / current / error). */
    ON_STATUS: "update:on:status",
    /**
     * Open the release page for the available update. The URL is held
     * main-side so the renderer can't ask to open an arbitrary address.
     */
    OPEN_RELEASE: "update:openRelease",
  },

  /** Settings namespace — persisted via electron-store, NOT SQLite. */
  SETTINGS: {
    /** Read the full Settings blob. */
    GET: "settings:get",
    /** Partial update — only provided keys are applied. */
    UPDATE: "settings:update",
    /** Open the native folder picker. Returns a path without saving it. */
    PICK_SCAN_PATH: "settings:pickScanPath",
    /** Add a directory to the scan roots. */
    ADD_SCAN_PATH: "settings:addScanPath",
    /** Remove a scan root, optionally forgetting its catalog rows. */
    REMOVE_SCAN_PATH: "settings:removeScanPath",
    /** How many catalog rows live under a path — powers the remove confirm. */
    COUNT_UNDER: "settings:countUnder",
  },

  /** Groups namespace — CRUD + membership. */
  GROUPS: {
    /** List all groups. */
    LIST: "groups:list",
    /** Create a new group. */
    CREATE: "groups:create",
    /** Rename a group (name-only patch). */
    RENAME: "groups:rename",
    /** Delete a group. Repo memberships cascade via FK. */
    DELETE: "groups:delete",
    /** Replace the entire member set for a group. */
    SET_MEMBERS: "groups:setMembers",
  },

  /**
   * App namespace — Phase 2. Native shell affordances exposed to the
   * renderer: dock badge, native notifications, spotlight window
   * show/hide, and the renderer-owned action-registry handshake.
   */
  APP: {
    /** Set (or clear, when `count` is null) the macOS dock badge. */
    SET_DOCK_BADGE: "app:setDockBadge",
    /** Show a native desktop notification. */
    NOTIFY: "app:notify",
    /** Show the spotlight window (idempotent — focus if already open). */
    SHOW_SPOTLIGHT: "app:showSpotlight",
    /** Hide the spotlight window (idempotent — no-op if hidden). */
    HIDE_SPOTLIGHT: "app:hideSpotlight",
    /**
     * Renderer pushes its full action registry on boot so main can
     * build the native Application menu and bind accelerators.
     * Re-callable: each call REPLACES the previously-registered
     * registry wholesale (no diff/merge semantics).
     */
    REGISTER_ACTIONS: "app:registerActions",
  },

  /**
   * Menu namespace — Phase 2. Push-style stream only: main fires
   * `menu:on:command` when the user activates a native menu item or
   * its accelerator. Payload carries the renderer-owned `commandId`
   * (an `Action.id`) that the renderer's dispatch table executes.
   */
  MENU: {
    ON_COMMAND: "menu:on:command",
  },

  /**
   * Protocol namespace — Phase 2. Push-style stream only: main fires
   * `protocol:on:deep-link` when the OS opens an `alltherepos://` URL
   * (`app.on('open-url')` on macOS).
   */
  PROTOCOL: {
    ON_DEEP_LINK: "protocol:on:deep-link",
  },

  /**
   * Tray namespace — Phase 2. Push-style stream only: main fires
   * `tray:on:open-repo` when the user clicks a recent-repo entry in
   * the tray popover. Renderer routes to the repo detail page.
   */
  TRAY: {
    ON_OPEN_REPO: "tray:on:open-repo",
  },

  /**
   * Process namespace — Phase 3a. Per-repo listening-port + dev-server
   * detection driven by an `lsof` poller in the main process. Repo
   * binding is computed by walking each process's cwd and its parent
   * chain (via `ppid`) until the path matches a known repo root in
   * the catalog trie. Poll cadence is 2-3s when the app is focused,
   * 15s when blurred, paused when no consumer is mounted.
   */
  PROCESS: {
    /** Snapshot of every dev-server-like listening process. */
    LIST: "process:list",
    /** Subset of LIST scoped to one repo by slug. */
    LIST_FOR_REPO: "process:listForRepo",
    /**
     * Graceful kill: SIGINT → SIGTERM (after `escalateMs`, default
     * 3000ms) → SIGKILL (after another `escalateMs`, default 8000ms
     * total). Resolves when PID no longer listening or timeout.
     */
    KILL: "process:kill",
    /**
     * Push event from `ProcessService` when its snapshot changes.
     * Payload is the full new snapshot (small — one entry per
     * listening PID; diffing is the renderer's job).
     */
    ON_UPDATE: "process:on:update",
  },

  /**
   * Launcher namespace — Phase 3a. "Open in X" affordances. Detects
   * installed editors and terminals via `/Applications` scans + PATH
   * lookups at boot (cached). All openExternal calls go through the
   * existing `openExternalAllowlisted` gate.
   */
  LAUNCHER: {
    /** Detected editors + terminals + current defaults. Session-cached. */
    DETECT: "launcher:detect",
    /**
     * Open repo in editor by slug. `editorId` falls back to user
     * default. Builds a URL scheme (`vscode://`, `cursor://`,
     * `zed://`, `idea://`, etc.) and dispatches.
     */
    OPEN_IN_EDITOR: "launcher:openInEditor",
    /**
     * Open repo in a terminal (cwd=repo). Optional `command` is run
     * in the new shell (used later by Claude integration).
     */
    OPEN_IN_TERMINAL: "launcher:openInTerminal",
    /** Reveal repo in Finder. */
    OPEN_IN_FINDER: "launcher:openInFinder",
    /**
     * Resolve `git remote get-url origin`, normalize SSH→HTTPS, and
     * open in the default browser via the allowlist.
     */
    OPEN_REMOTE: "launcher:openRemote",
    /** Copy the absolute repo path to the clipboard. */
    COPY_PATH: "launcher:copyPath",
  },

  /**
   * Claude namespace — Phase 3b. Reads `~/.claude.json` + walks
   * `~/.claude/projects/<hash>/*.jsonl`, plus per-repo `.claude/`
   * directories (skills, agents, settings, .mcp.json). All read-only
   * from main's perspective — the renderer mutates Claude state by
   * dispatching to LauncherService (open CLAUDE.md in editor, spawn
   * Claude Code in terminal). Live updates come via a chokidar watcher
   * on `~/.claude/projects/` that emits `claude:on:update` whenever a
   * session's token total or last-activity changes.
   */
  CLAUDE: {
    /** Force a re-index of `~/.claude/` + all known repos' `.claude/`. */
    INDEX: "claude:index",
    /**
     * List every Claude-known project: hash, repo path (from
     * `~/.claude.json`'s project entry), session count, last-activity
     * timestamp, rolled-up token total.
     */
    PROJECTS: "claude:projects",
    /**
     * Full Claude state for one repo by slug: CLAUDE.md content,
     * skills, agents, MCP servers, sessions metadata.
     */
    REPO_STATE: "claude:repoState",
    /**
     * Lazy-load a chunk of one session's transcript. Pagination via
     * `cursor` (byte offset into the JSONL file).
     */
    SESSION_TRANSCRIPT: "claude:sessionTranscript",
    /**
     * Rolled-up token usage across all projects: by-project totals,
     * by-day series (for heatmap), by-week / by-month sums.
     */
    GLOBAL_USAGE: "claude:globalUsage",
    /**
     * Launch Claude Code in the user's terminal at the repo path.
     * Optional `--resume <sessionId>` and starter prompt.
     */
    LAUNCH: "claude:launch",
    /** Open this repo's CLAUDE.md in the user's default editor. */
    OPEN_CLAUDE_MD: "claude:openClaudeMd",
    /**
     * Push event — emitted when the chokidar watcher fires.
     * Payload is the project hash whose state changed. Renderer
     * invalidates the matching `claude:projects` and
     * `claude:repoState` queries.
     */
    ON_UPDATE: "claude:on:update",
  },
} as const;

/**
 * Flat union of every registered request/response channel name.
 * Streaming `on:*` channels are NOT in this union — see `IpcEventChannel`.
 */
export type IpcChannel =
  | (typeof IPC.SYSTEM)[keyof typeof IPC.SYSTEM]
  | (typeof IPC.CATALOG)[keyof typeof IPC.CATALOG]
  | Exclude<
      (typeof IPC.SCAN)[keyof typeof IPC.SCAN],
      typeof IPC.SCAN.ON_PROGRESS
    >
  | (typeof IPC.GIT)[keyof typeof IPC.GIT]
  | (typeof IPC.SETTINGS)[keyof typeof IPC.SETTINGS]
  | (typeof IPC.GROUPS)[keyof typeof IPC.GROUPS]
  | (typeof IPC.APP)[keyof typeof IPC.APP]
  | Exclude<
      (typeof IPC.PROCESS)[keyof typeof IPC.PROCESS],
      typeof IPC.PROCESS.ON_UPDATE
    >
  | (typeof IPC.LAUNCHER)[keyof typeof IPC.LAUNCHER]
  | Exclude<
      (typeof IPC.CLAUDE)[keyof typeof IPC.CLAUDE],
      typeof IPC.CLAUDE.ON_UPDATE
    >;

/**
 * Push-style event channels (main → renderer).
 * Phase 1: `scan:on:progress`.
 * Phase 2: `menu:on:command`, `protocol:on:deep-link`, `tray:on:open-repo`.
 * Phase 3a: `process:on:update`.
 * Phase 3b: `claude:on:update`.
 */
export type IpcEventChannel =
  | typeof IPC.SCAN.ON_PROGRESS
  | typeof IPC.MENU.ON_COMMAND
  | typeof IPC.PROTOCOL.ON_DEEP_LINK
  | typeof IPC.TRAY.ON_OPEN_REPO
  | typeof IPC.PROCESS.ON_UPDATE
  | typeof IPC.CLAUDE.ON_UPDATE;

/** The renderer surface exposed on `window.atr`. */
export const PRELOAD_BRIDGE_KEY = "atr" as const;
export type PreloadBridgeKey = typeof PRELOAD_BRIDGE_KEY;
