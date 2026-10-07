/**
 * CONTRACT v1 — Shared types for the Electron migration.
 *
 * This file is the new source of truth for types shared between the
 * main process and the renderer. For Phase 0 we simply re-export the
 * existing `contracts/types.ts` (which currently mirrors `lib/types.ts`,
 * see memory observation 618) and add the few Phase 0 additions:
 *   - `ScanEvent` — discriminated-union streaming events for the scanner.
 *   - `PingResponse` — output of the trivial `system:ping` IPC.
 *
 * Future direction: once Phase 1 begins, `lib/types.ts` and the legacy
 * `contracts/types.ts` should re-export from THIS file instead of the
 * other way around. For Phase 0 we leave the legacy files untouched and
 * just import them here.
 *
 * Hard rule: this module must remain dependency-light. No Node APIs,
 * no DOM, no Electron — only TS types and Zod (via `./schemas.ts`).
 */

// Re-export the frozen v1 entity types from contracts/types.ts. These
// definitions remain the authoritative shape for Repo, Group, Tag, etc.
export type {
  ActionResult,
  ApiError,
  ApiOk,
  ApiResult,
  Group,
  LanguageBytes,
  Repo,
  RepoDetail,
  RepoListQuery,
  RepoListResult,
  ScanProgressEvent,
  SearchHit,
  SearchQuery,
  Settings,
  SmartFilter,
  Tag,
  TagSource,
} from "../../contracts/types";

// Internal import — used only to compose Phase 1 IPC payload shapes below.
// Keep this in lockstep with the public re-export above.
import type {
  DefaultEditor,
  Group,
  Repo,
  RepoDetail,
  RepoListResult,
  SearchHit,
  Settings,
  SmartFilter,
} from "../../contracts/types";

// ---------------------------------------------------------------------------
// Phase 0 additions
// ---------------------------------------------------------------------------

/**
 * Streaming scan event emitted by the (future) scanner worker over IPC.
 *
 * Locked in Phase 0 so consumers in later phases can rely on the shape.
 * The legacy `ScanProgressEvent` in `contracts/types.ts` describes the
 * NDJSON wire format of the old Next.js scanner; `ScanEvent` is its
 * Electron-IPC successor and intentionally smaller / re-keyed on `kind`.
 */
export type ScanEvent =
  | { kind: "progress"; processed: number; total: number; currentPath: string }
  | { kind: "repo"; repo: import("../../contracts/types").Repo }
  | { kind: "done"; totalRepos: number; durationMs: number }
  | { kind: "error"; message: string; path: string | null };

/**
 * Response payload of the trivial `system:ping` IPC channel.
 * Used in Phase 0 to validate the preload + contextBridge wiring.
 */
export interface PingResponse {
  ok: true;
  pong: "pong";
  mainProcessPid: number;
  /** ISO-8601 timestamp captured in the main process. */
  receivedAt: string;
}

/** Input payload for `system:ping`. Phase 0 accepts an empty object. */
export interface PingInput {
  /** Optional client-side nonce, echoed nowhere — purely a smoke test. */
  nonce?: string;
}

// ===========================================================================
// Phase 1 additions — catalog / scan / git / settings / groups IPC payloads
// ===========================================================================
//
// All Phase 1 IPC channels have Zod schemas in ./schemas.ts. The TypeScript
// shapes here are derived/aligned with those schemas. Where a payload can be
// fully inferred from a schema, prefer importing the inferred type from
// `./schemas.ts`. Hand-written types live here only when they (a) re-shape an
// existing entity (e.g. `RepoListResult`) or (b) form a discriminated union
// the IPC consumer reads as a typed result.

// ---------------------------------------------------------------------------
// catalog:*
// ---------------------------------------------------------------------------

/**
 * Input for `catalog:list`. Mirrors the legacy `RepoListQuery` (from
 * `contracts/types.ts`) but loosens nullability to match the Zod schema:
 * Zod transforms missing fields to `undefined` (not `null`).
 */
export interface ListReposInput {
  q?: string;
  language?: string | null;
  tags?: string[];
  groupId?: number | null;
  /** When true and `q` is set, run the LLM-tagged smart filter (Phase 4). */
  smart?: boolean;
  dirtyOnly?: boolean;
  sort?: "lastCommit" | "name" | "lastScanned" | "lastOpened";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/** Response for `catalog:list`. Re-exported `RepoListResult` shape. */
export type ListReposResult = RepoListResult;

/** Input for `catalog:get` — fetch a single repo detail by slug. */
export interface GetRepoInput {
  slug: string;
}

/** Response for `catalog:get`. `null` ⇒ caller should map to NOT_FOUND. */
export type GetRepoResult = RepoDetail | null;

/** Input for `catalog:search` (hybrid FTS + vector search). */
export interface SearchReposInput {
  q: string;
  /** Defaults to `"hybrid"` in the handler. */
  mode?: "fts" | "vector" | "hybrid";
  filters?: {
    language?: string | null;
    tags?: string[];
    groupIds?: number[];
    dirtyOnly?: boolean;
  };
  limit?: number;
}

/** Response for `catalog:search`. */
export type SearchReposResult = SearchHit[];

/** Input for `catalog:rescan` — refresh metadata for one repo. */
export interface RescanRepoInput {
  slug: string;
}

/** Response for `catalog:rescan`. The freshly upserted Repo row. */
export type RescanRepoResult = Repo;

/** Input for `catalog:setTags` — overwrites user tags (heuristics preserved). */
export interface SetRepoTagsInput {
  slug: string;
  /** User-supplied tag values. Trimmed + de-duped on the server. */
  tags: string[];
}

/** Response for `catalog:setTags`. The updated Repo. */
export type SetRepoTagsResult = Repo;

/** Input for `catalog:delete` — remove one repo row from the catalog (ATR-028). */
export interface DeleteRepoInput {
  slug: string;
}

/**
 * Response for `catalog:delete`. `deleted` is false when no row had the slug.
 * Deleting never touches the repo on disk — it only drops the catalog row,
 * its FTS entry, group memberships, and (best-effort) its vector embedding.
 */
export interface DeleteRepoResult {
  slug: string;
  deleted: boolean;
}

// ---------------------------------------------------------------------------
// catalog:cover / catalog:move*
// ---------------------------------------------------------------------------

import type {
  CoverInputSchema,
  CoverResultSchema,
  MoveBlockerSchema,
  MoveCheckEntrySchema,
  MoveCheckResultSchema,
  MoveEntryResultSchema,
  MoveInputSchema,
  MoveLastResultSchema,
  MoveResultSchema,
  MoveUndoInputSchema,
  FolderBlockerSchema,
  FolderCheckInputSchema,
  AffectedRepoSchema,
  FolderCheckResultSchema,
  FolderRenameInputSchema,
  FolderMoveInputSchema,
  FolderCreateInputSchema,
  FolderOpResultSchema,
  PickScanPathResultSchema,
  AddScanPathInputSchema,
  AddScanPathResultSchema,
  RemoveScanPathInputSchema,
  RemoveScanPathResultSchema,
  CountUnderInputSchema,
  CountUnderResultSchema,
  CatalogChangeEventSchema,
  UpdateStatusSchema,
  InstallUpdateResultSchema,
  RepoLinkKindSchema,
  RepoLinkSchema,
  GraphSignalSchema,
  GraphNodeSchema,
  GraphEdgeSchema,
  GraphClusterSchema,
  GraphResultSchema,
  RepoRelationSchema,
  RepoRelationsInputSchema,
  RepoRelationsResultSchema,
  AssertRepoLinkInputSchema,
  AssertRepoLinkResultSchema,
  RemoveRepoLinkInputSchema,
  RemoveRepoLinkResultSchema,
  OpenReleaseResultSchema,
  SetFavoriteInputSchema,
  SetFavoriteResultSchema,
  SyncOutcomeSchema,
  SyncInputSchema,
  SyncEntrySchema,
  SyncResultSchema,
  RepoTaskSchema,
  TaskListInputSchema,
  TaskListResultSchema,
  TaskStartInputSchema,
  TaskStartResultSchema,
  TaskStopInputSchema,
  TaskStopResultSchema,
  TaskActiveResultSchema,
  TaskOutputEventSchema,
} from "./schemas";

export type CoverInput = import("zod").infer<typeof CoverInputSchema>;
export type CoverResult = import("zod").infer<typeof CoverResultSchema>;
export type MoveBlocker = import("zod").infer<typeof MoveBlockerSchema>;
export type MoveInput = import("zod").infer<typeof MoveInputSchema>;
export type MoveCheckEntry = import("zod").infer<typeof MoveCheckEntrySchema>;
export type MoveCheckResult = import("zod").infer<typeof MoveCheckResultSchema>;
export type MoveEntryResult = import("zod").infer<typeof MoveEntryResultSchema>;
export type MoveResult = import("zod").infer<typeof MoveResultSchema>;
export type MoveUndoInput = import("zod").infer<typeof MoveUndoInputSchema>;
export type MoveLastInput = Record<string, never>;
export type MoveLastResult = import("zod").infer<typeof MoveLastResultSchema>;

export type FolderBlocker = import("zod").infer<typeof FolderBlockerSchema>;
export type FolderCheckInput = import("zod").infer<
  typeof FolderCheckInputSchema
>;
export type AffectedRepo = import("zod").infer<typeof AffectedRepoSchema>;
export type FolderCheckResult = import("zod").infer<
  typeof FolderCheckResultSchema
>;
export type FolderRenameInput = import("zod").infer<
  typeof FolderRenameInputSchema
>;
export type FolderMoveInput = import("zod").infer<typeof FolderMoveInputSchema>;
export type FolderCreateInput = import("zod").infer<
  typeof FolderCreateInputSchema
>;
export type FolderOpResult = import("zod").infer<typeof FolderOpResultSchema>;

export type CatalogChangeEvent = import("zod").infer<
  typeof CatalogChangeEventSchema
>;

export type SetFavoriteInput = import("zod").infer<
  typeof SetFavoriteInputSchema
>;
export type SetFavoriteResult = import("zod").infer<
  typeof SetFavoriteResultSchema
>;

export type SyncOutcome = import("zod").infer<typeof SyncOutcomeSchema>;
export type SyncInput = import("zod").infer<typeof SyncInputSchema>;
export type SyncEntry = import("zod").infer<typeof SyncEntrySchema>;
export type SyncResult = import("zod").infer<typeof SyncResultSchema>;

export type RepoTask = import("zod").infer<typeof RepoTaskSchema>;
export type TaskListInput = import("zod").infer<typeof TaskListInputSchema>;
export type TaskListResult = import("zod").infer<typeof TaskListResultSchema>;
export type TaskStartInput = import("zod").infer<typeof TaskStartInputSchema>;
export type TaskStartResult = import("zod").infer<typeof TaskStartResultSchema>;
export type TaskStopInput = import("zod").infer<typeof TaskStopInputSchema>;
export type TaskStopResult = import("zod").infer<typeof TaskStopResultSchema>;
export type TaskActiveInput = Record<string, never>;
export type TaskActiveResult = import("zod").infer<
  typeof TaskActiveResultSchema
>;
export type TaskOutputEvent = import("zod").infer<
  typeof TaskOutputEventSchema
>;

export type RepoLinkKind = import("zod").infer<typeof RepoLinkKindSchema>;
export type RepoLink = import("zod").infer<typeof RepoLinkSchema>;

export type GraphSignal = import("zod").infer<typeof GraphSignalSchema>;
export type GraphNode = import("zod").infer<typeof GraphNodeSchema>;
export type GraphEdge = import("zod").infer<typeof GraphEdgeSchema>;
export type GraphCluster = import("zod").infer<typeof GraphClusterSchema>;
export type GraphBuildInput = Record<string, never>;
export type GraphResult = import("zod").infer<typeof GraphResultSchema>;

export type RepoRelation = import("zod").infer<typeof RepoRelationSchema>;
export type RepoRelationsInput = import("zod").infer<
  typeof RepoRelationsInputSchema
>;
export type RepoRelationsResult = import("zod").infer<
  typeof RepoRelationsResultSchema
>;

export type AssertRepoLinkInput = import("zod").infer<
  typeof AssertRepoLinkInputSchema
>;
export type AssertRepoLinkResult = import("zod").infer<
  typeof AssertRepoLinkResultSchema
>;
export type RemoveRepoLinkInput = import("zod").infer<
  typeof RemoveRepoLinkInputSchema
>;
export type RemoveRepoLinkResult = import("zod").infer<
  typeof RemoveRepoLinkResultSchema
>;

export type UpdateStatus = import("zod").infer<typeof UpdateStatusSchema>;
export type UpdateCheckInput = Record<string, never>;
export type UpdateStatusInput = Record<string, never>;
export type OpenReleaseInput = Record<string, never>;
export type OpenReleaseResult = import("zod").infer<
  typeof OpenReleaseResultSchema
>;
export type InstallUpdateInput = Record<string, never>;
export type InstallUpdateResult = import("zod").infer<
  typeof InstallUpdateResultSchema
>;

export type PickScanPathInput = Record<string, never>;
export type PickScanPathResult = import("zod").infer<
  typeof PickScanPathResultSchema
>;
export type AddScanPathInput = import("zod").infer<
  typeof AddScanPathInputSchema
>;
export type AddScanPathResult = import("zod").infer<
  typeof AddScanPathResultSchema
>;
export type RemoveScanPathInput = import("zod").infer<
  typeof RemoveScanPathInputSchema
>;
export type RemoveScanPathResult = import("zod").infer<
  typeof RemoveScanPathResultSchema
>;
export type CountUnderInput = import("zod").infer<typeof CountUnderInputSchema>;
export type CountUnderResult = import("zod").infer<
  typeof CountUnderResultSchema
>;

/**
 * Input for `catalog:smartFilter` — Phase 4 feature, contract locked in
 * Phase 1 so the renderer can wire the UI affordance early.
 */
export interface SmartFilterInput {
  /** Natural-language description of what the user wants. */
  prompt: string;
  /** Optional cap; backend defaults to 50, max 200. */
  limit?: number;
}

/** Response for `catalog:smartFilter`. */
export type SmartFilterResult = SearchHit[];

// ---------------------------------------------------------------------------
// scan:*
// ---------------------------------------------------------------------------

/** Input for `scan:start`. */
export interface StartScanInput {
  /** Override scan roots; when omitted, use Settings.scanPaths. */
  paths?: string[];
}

/** Response for `scan:start` — the active job handle. */
export interface StartScanResult {
  /** Server-generated UUID for this scan run. */
  jobId: string;
  /** Always `"running"` immediately after start. */
  status: "running";
  startedAt: string;
}

/** Input for `scan:status`. */
export interface ScanStatusInput {
  jobId: string;
}

/** Response for `scan:status`. */
export interface ScanStatusResult {
  jobId: string;
  status: "running" | "done" | "error" | "cancelled" | "unknown";
  processed: number;
  total: number;
  startedAt: string;
  endedAt: string | null;
  errorMessage: string | null;
}

/** Input for `scan:cancel`. */
export interface CancelScanInput {
  jobId: string;
}

/** Response for `scan:cancel`. */
export interface CancelScanResult {
  jobId: string;
  cancelled: boolean;
}

// ---------------------------------------------------------------------------
// git:*
// ---------------------------------------------------------------------------

/** Input for `git:status` — one repo. */
export interface GitStatusInput {
  slug: string;
}

/** Response for `git:status`. */
export interface GitStatus {
  slug: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
  currentBranch: string | null;
  upstream: string | null;
}

/** Input for `git:branches`. */
export interface GitBranchesInput {
  slug: string;
}

/** A single local branch entry. */
export interface GitBranch {
  name: string;
  isCurrent: boolean;
  lastCommitHash: string | null;
  lastCommitDate: string | null;
  lastCommitMsg: string | null;
}

/** Response for `git:branches`. */
export type GitBranchesResult = GitBranch[];

/** Input for `git:openInEditor`. */
export interface OpenInEditorInput {
  slug: string;
  /**
   * Optional editor override; defaults to `Settings.defaultEditor`.
   *
   * Any `EditorId` plus `"none"` — the URI builder dispatches through the
   * launcher's scheme table, so this is no longer limited to the two
   * editors that used to have a hand-written `switch` case.
   */
  editor?: DefaultEditor;
}

/** Response for `git:openInEditor`. */
export interface OpenInEditorResult {
  opened: boolean;
  /** The fully-resolved URI handed to shell.openExternal (or null if skipped). */
  uri: string | null;
}

// ---------------------------------------------------------------------------
// settings:*
// ---------------------------------------------------------------------------

/**
 * Input for `settings:get`. Empty — Zod schema is `z.object({})`.
 *
 * `Record<string, never>` rather than an empty interface, which would mean "no
 * fields" to a reader and "anything non-nullish" to TypeScript: `0`, a string and
 * an array would all satisfy it.
 */
export type GetSettingsInput = Record<string, never>;

/** Response for `settings:get` — full Settings blob. */
export type GetSettingsResult = Settings;

/**
 * Input for `settings:update`. Partial — only provided keys are applied.
 * `scanPaths` is replaced wholesale when present.
 */
export type UpdateSettingsInput = Partial<Settings>;

/** Response for `settings:update`. The full merged Settings post-update. */
export type UpdateSettingsResult = Settings;

// ---------------------------------------------------------------------------
// groups:*
// ---------------------------------------------------------------------------

/**
 * Input for `groups:list`. Empty — Zod schema is `z.object({})`. See
 * {@link GetSettingsInput} for why this is a mapped type and not `{}`.
 */
export type ListGroupsInput = Record<string, never>;

/** Response for `groups:list`. */
export type ListGroupsResult = Group[];

/** Input for `groups:create`. */
export interface CreateGroupInput {
  name: string;
  description?: string | null;
  isSmart?: boolean;
  smartFilter?: SmartFilter | null;
  parentGroupId?: number | null;
}

/** Response for `groups:create`. */
export type CreateGroupResult = Group;

/** Input for `groups:rename`. */
export interface RenameGroupInput {
  id: number;
  name: string;
}

/** Response for `groups:rename`. */
export type RenameGroupResult = Group;

/** Input for `groups:delete`. */
export interface DeleteGroupInput {
  id: number;
}

/** Response for `groups:delete`. */
export interface DeleteGroupResult {
  deleted: true;
  id: number;
}

/** Input for `groups:setMembers`. Replaces the entire membership set. */
export interface SetGroupMembersInput {
  groupId: number;
  /** Repo slugs to assign to this group. Order is irrelevant. */
  slugs: string[];
}

/** Response for `groups:setMembers`. */
export interface SetGroupMembersResult {
  groupId: number;
  memberCount: number;
}

// ===========================================================================
// Phase 2 additions — actions registry, native shell, deep links
// ===========================================================================
//
// Phase 2 adds the "feels like a real Mac app" surface: tray popover, global
// hotkey + spotlight window, native menu built from a renderer-owned actions
// registry, native notifications, `alltherepos://` URL scheme, and a dock
// badge channel. See `contracts/ipc.v1.md` (Phase 2 section), plus the
// companion contracts `contracts/actions.v1.md` and `contracts/protocol.v1.md`.
//
// Schemas live in ./schemas.ts; channel constants in ./ipc.ts.

// ---------------------------------------------------------------------------
// Actions registry — shared between native menu, in-app palette, spotlight
// ---------------------------------------------------------------------------

/**
 * Where an action is applicable. The same `id` MUST NOT appear with two
 * different scopes; scope is a single tag per action.
 *
 * - `global`        — always available (menu + every palette context).
 * - `catalog`       — available on the catalog (repo list) view.
 * - `repo-detail`   — available on the repo detail view.
 * - `settings`      — available on the settings view.
 * - `spotlight`     — only available inside the global spotlight window
 *                     (e.g. "switch to action-search mode" via `>`).
 *
 * Future scopes (claude, deps, etc.) will be added in later phases — DO
 * NOT widen this union without bumping the actions contract version.
 */
export type ActionScope =
  | "global"
  | "catalog"
  | "repo-detail"
  | "settings"
  | "spotlight";

/**
 * A renderer-owned action descriptor. The `handler` is intentionally
 * NOT part of the contract — the renderer keeps a `Map<id, () => void>`
 * keyed by `id` and runs the handler when either:
 *   (a) the in-app cmdk palette dispatches it, OR
 *   (b) a `menu:on:command` event arrives from main carrying the `id`.
 *
 * `shortcut` uses Electron's Accelerator string format
 * (`CmdOrCtrl+K`, `CmdOrCtrl+Shift+Space`, `Alt+/`, etc.) — see
 * https://www.electronjs.org/docs/latest/api/accelerator. The renderer
 * MAY accept human-friendly aliases (`Mod+K`) but MUST translate them to
 * Accelerator strings before sending to main.
 */
export interface Action {
  /**
   * Unique, kebab-case, dot-namespaced identifier — e.g.
   * `catalog.refresh`, `app.open-settings`. MUST match
   * `^[a-z][a-z0-9.-]*$` (see `ActionIdSchema`).
   */
  id: string;
  /** Human-readable label, used in the menu and palette UIs. */
  label: string;
  /** Where this action applies. */
  scope: ActionScope;
  /** Optional Electron Accelerator string (e.g. `CmdOrCtrl+K`). */
  shortcut?: string;
  /** Optional lucide icon name. Palette UI only — menu ignores. */
  icon?: string;
  /** Optional one-line description shown in the palette. */
  hint?: string;
  /**
   * Optional grouping used for cmdk groups in the palette and submenu
   * placement in the native menu. Examples: `Catalog`, `App`, `Repo`.
   */
  group?: string;
  /**
   * When true the action is only registered/exposed in development
   * builds (e.g. `app.toggle-devtools`). Defaults to false.
   */
  devOnly?: boolean;
}

/**
 * Native notification action button. Mirrors Electron's
 * `NotificationAction` shape (`{ type: 'button', text: string }`).
 *
 * macOS displays at most 1 action button on a banner-style notification
 * unless the user has enabled "Alerts" — implementers SHOULD design for
 * 0–1 actions and treat 2+ as best-effort.
 */
export interface NotificationAction {
  /** Always `"button"` on macOS today. Kept for forward-compat. */
  type: "button";
  /** Button label. Keep short — ~12 chars renders cleanly. */
  text: string;
}

// ---------------------------------------------------------------------------
// app:* request/response payloads
// ---------------------------------------------------------------------------

/** Input for `app:setDockBadge` — `count: null` clears the badge. */
export interface SetDockBadgeInput {
  /**
   * Badge count. `null` ⇒ clear the badge entirely. `0` is treated the
   * same as `null` by the handler (the macOS dock has no "0 badge"
   * state, so we elide it).
   */
  count: number | null;
}

/** Response for `app:setDockBadge`. */
export interface SetDockBadgeResult {
  /** The effective string the dock badge was set to (empty ⇒ cleared). */
  badge: string;
}

/**
 * Input for `app:notify` — show a native macOS notification.
 *
 * Renderer-initiated notifications use this channel; main-initiated
 * notifications (e.g. on scan complete) call the underlying
 * `Notification` API directly without going through IPC.
 */
export interface NotifyInput {
  title: string;
  body: string;
  /** Silent (no sound). Defaults to false. */
  silent?: boolean;
  /** Optional action buttons. macOS shows ≤1 reliably on banners. */
  actions?: NotificationAction[];
}

/** Response for `app:notify`. */
export interface NotifyResult {
  /** Whether the notification was queued for display by the OS. */
  shown: boolean;
}

/**
 * Input for `app:showSpotlight`. Empty — Zod schema is `z.object({}).strict()`.
 * See {@link GetSettingsInput} for why this is a mapped type and not `{}`.
 */
export type ShowSpotlightInput = Record<string, never>;

/** Response for `app:showSpotlight`. */
export interface ShowSpotlightResult {
  /** Whether the spotlight window is now visible. */
  visible: true;
}

/**
 * Input for `app:hideSpotlight`. Empty — Zod schema is `z.object({}).strict()`.
 * See {@link GetSettingsInput} for why this is a mapped type and not `{}`.
 */
export type HideSpotlightInput = Record<string, never>;

/** Response for `app:hideSpotlight`. */
export interface HideSpotlightResult {
  /** Whether the spotlight window is now hidden. */
  visible: false;
}

/**
 * Input for `app:registerActions`. Renderer pushes its full action
 * registry. Re-callable — each call replaces the previously-registered
 * registry wholesale (main rebuilds the native menu and re-binds
 * accelerators on every call).
 */
export interface RegisterActionsInput {
  /**
   * The full set of actions the renderer knows about. Order matters
   * for menu / submenu rendering when `group` is shared (stable sort).
   */
  actions: Action[];
}

/** Response for `app:registerActions`. */
export interface RegisterActionsResult {
  /** Number of actions accepted (post-validation). */
  accepted: number;
  /**
   * Number of action `id`s that collided with another entry and were
   * skipped. Always 0 on a well-formed registry; surfaced so the
   * renderer can log a warning in dev.
   */
  skipped: number;
}

// ---------------------------------------------------------------------------
// Push-event payloads (main → renderer)
// ---------------------------------------------------------------------------

/**
 * Payload for the `menu:on:command` event. Fired when the user
 * activates a native menu item or hits its accelerator.
 */
export interface MenuCommandPayload {
  /** The `Action.id` registered for the activated menu item. */
  commandId: string;
}

/**
 * Payload for the `protocol:on:deep-link` event. Fired when the OS
 * opens an `alltherepos://` URL. See `contracts/protocol.v1.md` for
 * the grammar; this payload is the parsed form.
 *
 * Examples:
 *   `alltherepos://repo/my-slug`
 *     → { path: 'repo/my-slug',   params: { slug: 'my-slug' } }
 *   `alltherepos://settings`
 *     → { path: 'settings',       params: {} }
 *   `alltherepos://action/catalog.refresh?foo=bar`
 *     → { path: 'action/catalog.refresh',
 *         params: { actionId: 'catalog.refresh', foo: 'bar' } }
 */
export interface DeepLinkPayload {
  /**
   * The path portion of the URL with any leading `alltherepos://`
   * stripped (no trailing slash). E.g. `repo/my-slug`, `settings`,
   * `action/catalog.refresh`.
   */
  path: string;
  /**
   * Parsed params. Includes both query-string entries AND the named
   * path captures defined in `contracts/protocol.v1.md` (e.g. `slug`
   * for `repo/<slug>`, `actionId` for `action/<id>`).
   */
  params: Record<string, string>;
}

/**
 * Payload for the `tray:on:open-repo` event. Fired when the user
 * clicks a recent-repo row in the tray popover.
 */
export interface TrayOpenRepoPayload {
  /** Slug of the repo to open. Renderer routes to the detail page. */
  slug: string;
}

// ===========================================================================
// Phase 3a additions — process detection + launcher
// ===========================================================================
//
// All Phase 3a IPC channels have Zod schemas in ./schemas.ts. Public types
// here are derived from those schemas.

import type {
  DetectLauncherResultZ,
  EditorIdZ,
  KillProcessInputZ,
  KillProcessResultZ,
  LauncherResultZ,
  ListProcessesResultZ,
  OpenInEditorPhase3InputZ,
  OpenInTerminalInputZ,
  ProcessInfoZ,
  ProcessUpdateEventZ,
  TerminalIdZ,
} from "./schemas";

export type ProcessInfo = ProcessInfoZ;
export type ListProcessesInput = Record<string, never>;
export type ListProcessesResult = ListProcessesResultZ;
export interface ListProcessesForRepoInput {
  slug: string;
}
export type ListProcessesForRepoResult = ListProcessesResultZ;
export type KillProcessInput = KillProcessInputZ;
export type KillProcessResult = KillProcessResultZ;
export type ProcessUpdateEvent = ProcessUpdateEventZ;

export type EditorId = EditorIdZ;
export type TerminalId = TerminalIdZ;
export type DetectLauncherInput = Record<string, never>;
export type DetectLauncherResult = DetectLauncherResultZ;
export type OpenInEditorPhase3Input = OpenInEditorPhase3InputZ;
export type OpenInTerminalInput = OpenInTerminalInputZ;
export interface OpenSlugInput {
  slug: string;
}
export type LauncherResult = LauncherResultZ;

// ===========================================================================
// Phase 3b additions — Claude Code integration
// ===========================================================================

import type {
  ClaudeAgentZ,
  ClaudeGlobalUsageInputZ,
  ClaudeGlobalUsageResultZ,
  ClaudeIndexResultZ,
  ClaudeLaunchInputZ,
  ClaudeMcpServerZ,
  ClaudeOpenClaudeMdInputZ,
  ClaudeProjectZ,
  ClaudeProjectsResultZ,
  ClaudeRepoStateInputZ,
  ClaudeRepoStateZ,
  ClaudeSessionTranscriptInputZ,
  ClaudeSessionTranscriptResultZ,
  ClaudeSessionZ,
  ClaudeSkillZ,
  ClaudeUpdateEventZ,
  TokenUsageZ,
  TranscriptEventZ,
} from "./schemas";

export type TokenUsage = TokenUsageZ;
export type ClaudeSession = ClaudeSessionZ;
export type ClaudeProject = ClaudeProjectZ;
export type ClaudeSkill = ClaudeSkillZ;
export type ClaudeAgent = ClaudeAgentZ;
export type ClaudeMcpServer = ClaudeMcpServerZ;
export type ClaudeRepoState = ClaudeRepoStateZ;
export type ClaudeUpdateEvent = ClaudeUpdateEventZ;
export type TranscriptEvent = TranscriptEventZ;

export type ClaudeIndexInput = Record<string, never>;
export type ClaudeIndexResult = ClaudeIndexResultZ;
export type ClaudeProjectsInput = Record<string, never>;
export type ClaudeProjectsResult = ClaudeProjectsResultZ;
export type ClaudeRepoStateInput = ClaudeRepoStateInputZ;
export type ClaudeRepoStateResult = ClaudeRepoState;
export type ClaudeSessionTranscriptInput = ClaudeSessionTranscriptInputZ;
export type ClaudeSessionTranscriptResult = ClaudeSessionTranscriptResultZ;
export type ClaudeGlobalUsageInput = ClaudeGlobalUsageInputZ;
export type ClaudeGlobalUsageResult = ClaudeGlobalUsageResultZ;
export type ClaudeLaunchInput = ClaudeLaunchInputZ;
export type ClaudeLaunchResult = LauncherResultZ;
export type ClaudeOpenClaudeMdInput = ClaudeOpenClaudeMdInputZ;
export type ClaudeOpenClaudeMdResult = LauncherResultZ;
