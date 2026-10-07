/**
 * Renderer-side façade over the preload `contextBridge` surface.
 *
 * Renderer code MUST import the bridge through this module rather than
 * touching `window.atr` directly. This gives us a single seam to:
 *   - mock the bridge in unit tests / Storybook,
 *   - detect when the renderer is running outside Electron (e.g. a plain
 *     browser tab during QE) and surface a graceful fallback,
 *   - swap in a different transport later (e.g. electron-trpc) without
 *     churning every call site.
 *
 * The structural shape below mirrors `src/preload/index.d.ts`'s
 * `AtrApi`. Phase 0 covered `system`. Phase 1 added catalog/scan/git/
 * settings/groups. Phase 2 adds:
 *   - `app.*` — dock badge, native notify, spotlight show/hide,
 *               `registerActions`, optional `toggleDevtools`,
 *               and the `onMenuCommand` push-event subscription.
 *   - `menu.onCommand(cb)` — push-event subscription for the
 *               `menu:on:command` channel.
 *   - `protocol.onDeepLink(cb)` — push-event subscription for the
 *               `protocol:on:deep-link` channel.
 *   - `tray.onOpenRepo(cb)` — push-event subscription for the
 *               `tray:on:open-repo` channel.
 *
 * The Phase 2 namespaces are also exposed indirectly via
 * `app.onMenuCommand` / `app.onDeepLink` / `app.onOpenRepo`
 * (alias-shim) so renderer hooks can subscribe through a single
 * `app` namespace surface; see plan §5.3 / §5.8.
 *
 * Until the preload physically wires the missing methods the hooks
 * built on top of this module receive `undefined` at runtime and
 * short-circuit (see `getAtr()` null check below).
 */

import type {
  CancelScanInput,
  CancelScanResult,
  CatalogChangeEvent,
  AssertRepoLinkInput,
  AssertRepoLinkResult,
  GraphBuildInput,
  GraphResult,
  RemoveRepoLinkInput,
  RemoveRepoLinkResult,
  RepoRelationsInput,
  RepoRelationsResult,
  UpdateStatus,
  UpdateCheckInput,
  UpdateStatusInput,
  OpenReleaseInput,
  OpenReleaseResult,
  InstallUpdateInput,
  InstallUpdateResult,
  SetFavoriteInput,
  SetFavoriteResult,
  SyncInput,
  SyncResult,
  TaskListInput,
  TaskListResult,
  TaskStartInput,
  TaskStartResult,
  TaskStopInput,
  TaskStopResult,
  TaskActiveInput,
  TaskActiveResult,
  TaskOutputEvent,
  CoverInput,
  CoverResult,
  MoveInput,
  MoveCheckResult,
  MoveResult,
  MoveUndoInput,
  MoveLastInput,
  MoveLastResult,
  FolderCheckInput,
  FolderCheckResult,
  FolderRenameInput,
  FolderMoveInput,
  FolderCreateInput,
  FolderOpResult,
  PickScanPathInput,
  PickScanPathResult,
  AddScanPathInput,
  AddScanPathResult,
  RemoveScanPathInput,
  RemoveScanPathResult,
  CountUnderInput,
  CountUnderResult,
  ClaudeGlobalUsageInput,
  ClaudeGlobalUsageResult,
  ClaudeIndexResult,
  ClaudeLaunchInput,
  ClaudeLaunchResult,
  ClaudeOpenClaudeMdInput,
  ClaudeOpenClaudeMdResult,
  ClaudeProjectsResult,
  ClaudeRepoStateInput,
  ClaudeRepoStateResult,
  ClaudeSessionTranscriptInput,
  ClaudeSessionTranscriptResult,
  ClaudeUpdateEvent,
  CreateGroupInput,
  CreateGroupResult,
  DeepLinkPayload,
  DeleteGroupInput,
  DeleteGroupResult,
  DetectLauncherResult,
  GetRepoInput,
  GetRepoResult,
  GetSettingsResult,
  GitBranchesInput,
  GitBranchesResult,
  GitStatus,
  GitStatusInput,
  HideSpotlightResult,
  KillProcessInput,
  KillProcessResult,
  LauncherResult,
  ListGroupsResult,
  ListProcessesForRepoInput,
  ListProcessesForRepoResult,
  ListProcessesResult,
  ListReposInput,
  ListReposResult,
  MenuCommandPayload,
  NotifyInput,
  NotifyResult,
  OpenInEditorInput,
  OpenInEditorPhase3Input,
  OpenInEditorResult,
  OpenInTerminalInput,
  OpenSlugInput,
  PingInput,
  PingResponse,
  ProcessUpdateEvent,
  RegisterActionsInput,
  RegisterActionsResult,
  RenameGroupInput,
  RenameGroupResult,
  DeleteRepoInput,
  DeleteRepoResult,
  RescanRepoInput,
  RescanRepoResult,
  ScanEvent,
  ScanStatusInput,
  ScanStatusResult,
  SearchReposInput,
  SearchReposResult,
  SetDockBadgeInput,
  SetDockBadgeResult,
  SetGroupMembersInput,
  SetGroupMembersResult,
  SetRepoTagsInput,
  SetRepoTagsResult,
  ShowSpotlightResult,
  SmartFilterInput,
  SmartFilterResult,
  StartScanInput,
  StartScanResult,
  TrayOpenRepoPayload,
  UpdateSettingsInput,
  UpdateSettingsResult,
} from "@shared/types";

/**
 * Phase 0 + Phase 1 + Phase 2 IPC surface as exposed on `window.atr`
 * by the preload script. Keep in sync with `src/preload/index.d.ts`.
 */
export interface AtrBridge {
  system: {
    ping(input?: PingInput): Promise<PingResponse>;
  };
  catalog: {
    list(input: ListReposInput): Promise<ListReposResult>;
    get(input: GetRepoInput): Promise<GetRepoResult>;
    search(input: SearchReposInput): Promise<SearchReposResult>;
    rescan(input: RescanRepoInput): Promise<RescanRepoResult>;
    setTags(input: SetRepoTagsInput): Promise<SetRepoTagsResult>;
    /** ATR-028: drop one catalog row; the repo on disk is untouched. */
    delete(input: DeleteRepoInput): Promise<DeleteRepoResult>;
    smartFilter(input: SmartFilterInput): Promise<SmartFilterResult>;
    /** Resolve a repo's own cover artwork; `src: null` when it has none. */
    cover(input: CoverInput): Promise<CoverResult>;
    /** Preflight a relocation — reads only, nothing is moved. */
    moveCheck(input: MoveInput): Promise<MoveCheckResult>;
    /** Relocate repos on disk and update their catalog rows. */
    move(input: MoveInput): Promise<MoveResult>;
    /** Reverse a journaled move batch; defaults to the most recent. */
    moveUndo(input: MoveUndoInput): Promise<MoveResult>;
    /** Describe the most recent move batch, for the undo affordance. */
    moveLast(input: MoveLastInput): Promise<MoveLastResult>;
    /** Subscribe to live catalog changes; returns an unsubscribe lambda. */
    onChanged(callback: (event: CatalogChangeEvent) => void): () => void;
    /** Pin or unpin a repo. */
    setFavorite(input: SetFavoriteInput): Promise<SetFavoriteResult>;
    /** Preflight a folder rename/move — reads only. */
    folderCheck(input: FolderCheckInput): Promise<FolderCheckResult>;
    /** Rename a folder in place. */
    folderRename(input: FolderRenameInput): Promise<FolderOpResult>;
    /** Move a folder into a different parent. */
    folderMove(input: FolderMoveInput): Promise<FolderOpResult>;
    /** Create an empty folder inside a scan root. */
    folderCreate(input: FolderCreateInput): Promise<FolderOpResult>;
  };
  scan: {
    start(input: StartScanInput): Promise<StartScanResult>;
    status(input: ScanStatusInput): Promise<ScanStatusResult>;
    cancel(input: CancelScanInput): Promise<CancelScanResult>;
    /**
     * Subscribe to push-style scan events from the main process.
     * Returns an `unsubscribe` function that removes the listener.
     */
    onProgress(cb: (event: ScanEvent) => void): () => void;
  };
  git: {
    /** Update remote refs for one or many repos. Never touches the tree. */
    fetch(input: SyncInput): Promise<SyncResult>;
    /** Fast-forward one or many repos to their upstream where safe. */
    pull(input: SyncInput): Promise<SyncResult>;
    status(input: GitStatusInput): Promise<GitStatus>;
    branches(input: GitBranchesInput): Promise<GitBranchesResult>;
    openInEditor(input: OpenInEditorInput): Promise<OpenInEditorResult>;
  };
  tasks: {
    /** The runnable commands a project declares. */
    list(input: TaskListInput): Promise<TaskListResult>;
    /** Start a task by id; output arrives on `onOutput`. */
    start(input: TaskStartInput): Promise<TaskStartResult>;
    /** Stop a run and everything it spawned. */
    stop(input: TaskStopInput): Promise<TaskStopResult>;
    /** Runs currently in flight. */
    active(input: TaskActiveInput): Promise<TaskActiveResult>;
    /** Subscribe to task output; returns an unsubscribe lambda. */
    onOutput(callback: (event: TaskOutputEvent) => void): () => void;
  };

  graph: {
    /** Build the relationship graph. */
    build(input: GraphBuildInput): Promise<GraphResult>;
    /** Curated links touching one repo (both directions). */
    links(input: RepoRelationsInput): Promise<RepoRelationsResult>;
    /** Assert a curated link. Writes one `repo_links` row. */
    link(input: AssertRepoLinkInput): Promise<AssertRepoLinkResult>;
    /** Remove a curated link. `removed: false` when it was already gone. */
    unlink(input: RemoveRepoLinkInput): Promise<RemoveRepoLinkResult>;
  };

  update: {
    /** Ask GitHub whether a newer release exists. */
    check(input: UpdateCheckInput): Promise<UpdateStatus>;
    /** Last known status — no network. */
    status(input: UpdateStatusInput): Promise<UpdateStatus>;
    /** Open the pending release's page in the browser. */
    openRelease(input: OpenReleaseInput): Promise<OpenReleaseResult>;
    /**
     * Download and apply the pending update, then relaunch. Only a
     * Developer-ID signed, notarised build can do this; everywhere else it
     * resolves `{ started: false, reason }`.
     */
    install(input: InstallUpdateInput): Promise<InstallUpdateResult>;
    /** Subscribe to status changes; returns an unsubscribe lambda. */
    onStatus(callback: (status: UpdateStatus) => void): () => void;
  };

  settings: {
    get(): Promise<GetSettingsResult>;
    update(input: UpdateSettingsInput): Promise<UpdateSettingsResult>;
    /** Open the native folder picker; returns a path without saving it. */
    pickScanPath(input: PickScanPathInput): Promise<PickScanPathResult>;
    /** Add a directory to the scan roots. */
    addScanPath(input: AddScanPathInput): Promise<AddScanPathResult>;
    /** Remove a scan root, optionally forgetting its catalog rows. */
    removeScanPath(input: RemoveScanPathInput): Promise<RemoveScanPathResult>;
    /** Catalog rows under a path — powers the remove confirmation. */
    countUnder(input: CountUnderInput): Promise<CountUnderResult>;
  };
  groups: {
    list(): Promise<ListGroupsResult>;
    create(input: CreateGroupInput): Promise<CreateGroupResult>;
    rename(input: RenameGroupInput): Promise<RenameGroupResult>;
    delete(input: DeleteGroupInput): Promise<DeleteGroupResult>;
    setMembers(input: SetGroupMembersInput): Promise<SetGroupMembersResult>;
  };
  /**
   * Phase 2 — native shell + actions registry + push-event
   * subscriptions. The preload exposes these per
   * `contracts/ipc.v1.md` (Phase 2 section).
   *
   * `toggleDevtools` is an OPTIONAL convenience helper not in the
   * frozen contract — the `app.toggle-devtools` action calls it if
   * present and no-ops otherwise.
   */
  app: {
    setDockBadge(input: SetDockBadgeInput): Promise<SetDockBadgeResult>;
    notify(input: NotifyInput): Promise<NotifyResult>;
    showSpotlight(): Promise<ShowSpotlightResult>;
    hideSpotlight(): Promise<HideSpotlightResult>;
    registerActions(
      input: RegisterActionsInput,
    ): Promise<RegisterActionsResult>;
    /** Optional dev-only helper invoked by the `app.toggle-devtools` action. */
    toggleDevtools?: () => Promise<void> | void;
    /**
     * Convenience alias for `menu.onCommand` — some hooks subscribe
     * through the `app` namespace because the action registry feels
     * conceptually closer to app-level state than to the menu namespace.
     * Preload MAY implement this as a thin proxy over `menu.onCommand`.
     */
    onMenuCommand?(cb: (payload: MenuCommandPayload) => void): () => void;
    /** Convenience alias for `protocol.onDeepLink`. */
    onDeepLink?(cb: (payload: DeepLinkPayload) => void): () => void;
    /** Convenience alias for `tray.onOpenRepo` (preload may name it `onTrayOpenRepo`). */
    onOpenRepo?(cb: (payload: TrayOpenRepoPayload) => void): () => void;
    /** Alternate name used by backend-system's preload extension. */
    onTrayOpenRepo?(cb: (payload: TrayOpenRepoPayload) => void): () => void;
  };
  menu: {
    /**
     * Subscribe to native-menu activation events. Returns an
     * unsubscribe lambda the caller MUST run from cleanup.
     */
    onCommand(cb: (payload: MenuCommandPayload) => void): () => void;
  };
  protocol: {
    /**
     * Subscribe to `alltherepos://` deep-link openings. Returns an
     * unsubscribe lambda the caller MUST run from cleanup.
     */
    onDeepLink(cb: (payload: DeepLinkPayload) => void): () => void;
  };
  tray: {
    /**
     * Subscribe to tray-popover "open repo" clicks. Returns an
     * unsubscribe lambda the caller MUST run from cleanup.
     */
    onOpenRepo(cb: (payload: TrayOpenRepoPayload) => void): () => void;
  };
  /**
   * Phase 3a `process:*` namespace — listening-port + dev-server
   * detection backed by lsof in the main process. `onUpdate` mirrors
   * `scan.onProgress`: returns an unsubscribe lambda the caller MUST
   * run from cleanup.
   */
  process: {
    list(): Promise<ListProcessesResult>;
    listForRepo(
      input: ListProcessesForRepoInput,
    ): Promise<ListProcessesForRepoResult>;
    /** Sweep now rather than waiting for the poll interval. */
    refresh(): Promise<ListProcessesResult>;
    kill(input: KillProcessInput): Promise<KillProcessResult>;
    onUpdate(cb: (payload: ProcessUpdateEvent) => void): () => void;
  };
  /**
   * Phase 3a `launcher:*` namespace — installed editor/terminal
   * detection + "open in X" dispatch. `detect()` is session-cached in
   * main; the renderer treats the result as `staleTime: Infinity`.
   */
  launcher: {
    detect(): Promise<DetectLauncherResult>;
    openInEditor(input: OpenInEditorPhase3Input): Promise<LauncherResult>;
    openInTerminal(input: OpenInTerminalInput): Promise<LauncherResult>;
    openInFinder(input: OpenSlugInput): Promise<LauncherResult>;
    openRemote(input: OpenSlugInput): Promise<LauncherResult>;
    copyPath(input: OpenSlugInput): Promise<LauncherResult>;
  };
  /**
   * Phase 3b `claude:*` namespace — Claude Code integration.
   * ClaudeService is read-only on the renderer side; `launch` and
   * `openClaudeMd` delegate to LauncherService in main. `onUpdate` is
   * the chokidar-driven push event that fires when a session JSONL
   * file changes; the renderer invalidates the matching queries on
   * receipt.
   */
  claude: {
    index(): Promise<ClaudeIndexResult>;
    projects(): Promise<ClaudeProjectsResult>;
    repoState(input: ClaudeRepoStateInput): Promise<ClaudeRepoStateResult>;
    sessionTranscript(
      input: ClaudeSessionTranscriptInput,
    ): Promise<ClaudeSessionTranscriptResult>;
    globalUsage(
      input: ClaudeGlobalUsageInput,
    ): Promise<ClaudeGlobalUsageResult>;
    launch(input: ClaudeLaunchInput): Promise<ClaudeLaunchResult>;
    openClaudeMd(
      input: ClaudeOpenClaudeMdInput,
    ): Promise<ClaudeOpenClaudeMdResult>;
    onUpdate(cb: (payload: ClaudeUpdateEvent) => void): () => void;
  };
}

declare global {
  interface Window {
    atr?: AtrBridge;
  }
}

/**
 * Returns the preload bridge if it is mounted, otherwise `null`.
 *
 * Renderer features should branch on this and render a graceful "preload
 * bridge unavailable" state so the renderer is still runnable in a
 * vanilla browser during QE / Storybook work.
 */
export function getAtr(): AtrBridge | null {
  if (typeof window === "undefined") return null;
  return window.atr ?? null;
}

/**
 * Throwing variant for code paths that absolutely require the bridge.
 * Prefer `getAtr()` plus a UI fallback in app-level components.
 */
export function requireAtr(): AtrBridge {
  const bridge = getAtr();
  if (!bridge) {
    throw new Error(
      "window.atr is undefined — preload bridge is not mounted. " +
        "Run via `pnpm electron:dev` so the Electron preload script loads.",
    );
  }
  return bridge;
}
