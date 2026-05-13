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
    /** Overwrite user tags (heuristic tags preserved). */
    SET_TAGS: "catalog:setTags",
    /** LLM-tagged smart filter (Phase 4 feature, contract locked now). */
    SMART_FILTER: "catalog:smartFilter",
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
  },

  /** Settings namespace — persisted via electron-store, NOT SQLite. */
  SETTINGS: {
    /** Read the full Settings blob. */
    GET: "settings:get",
    /** Partial update — only provided keys are applied. */
    UPDATE: "settings:update",
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
  | (typeof IPC.APP)[keyof typeof IPC.APP];

/**
 * Push-style event channels (main → renderer).
 * Phase 1: `scan:on:progress`.
 * Phase 2: `menu:on:command`, `protocol:on:deep-link`, `tray:on:open-repo`.
 */
export type IpcEventChannel =
  | typeof IPC.SCAN.ON_PROGRESS
  | typeof IPC.MENU.ON_COMMAND
  | typeof IPC.PROTOCOL.ON_DEEP_LINK
  | typeof IPC.TRAY.ON_OPEN_REPO;

/** The renderer surface exposed on `window.atr`. */
export const PRELOAD_BRIDGE_KEY = "atr" as const;
export type PreloadBridgeKey = typeof PRELOAD_BRIDGE_KEY;
