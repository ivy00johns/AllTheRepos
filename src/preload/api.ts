/**
 * Typed wrapper around `ipcRenderer.invoke` exposed via contextBridge.
 *
 * This is the renderer-facing API surface; the preload is the ONLY place
 * that has access to `ipcRenderer`. Every method here MUST:
 *   - reference a channel name from `@shared/ipc`'s `IPC` registry
 *     (no inline string literals), and
 *   - return a Promise typed against the shared `@shared/types` shape.
 *
 * Phase 0 exposed `system.ping`. Phase 1 added the five renderer
 * namespaces: catalog, scan, git, settings, groups. Phase 2 adds:
 *   - `app` namespace: setDockBadge, notify, showSpotlight,
 *     hideSpotlight, registerActions.
 *   - Three push-event subscribers: `app.onMenuCommand`,
 *     `app.onDeepLink`, `app.onTrayOpenRepo`. Each follows the same
 *     `scan.onProgress` wrapper pattern (raw `ipcRenderer` is hidden;
 *     subscriber returns an unsubscribe lambda).
 *
 * The `*.onX` methods are the only non-`invoke` channels — they
 * subscribe to push-style event streams from main. The preload wraps
 * both `on` and `off` so the renderer never sees `ipcRenderer` and
 * returns an unsubscribe lambda the renderer should call from
 * useEffect cleanup.
 */

import { ipcRenderer, type IpcRendererEvent } from "electron";

import { IPC } from "@shared/ipc";
import type {
  CancelScanInput,
  CancelScanResult,
  CreateGroupInput,
  CreateGroupResult,
  DeepLinkPayload,
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

export const api = {
  system: {
    /**
     * Round-trip smoke test. Returns the main-process PID and a
     * server-side ISO timestamp, useful for verifying the bridge works
     * after install / hot-reload.
     */
    ping: (input?: PingInput): Promise<PingResponse> =>
      ipcRenderer.invoke(IPC.SYSTEM.PING, input) as Promise<PingResponse>,
  },

  catalog: {
    list: (input: ListReposInput): Promise<ListReposResult> =>
      ipcRenderer.invoke(IPC.CATALOG.LIST, input) as Promise<ListReposResult>,
    get: (input: GetRepoInput): Promise<GetRepoResult> =>
      ipcRenderer.invoke(IPC.CATALOG.GET, input) as Promise<GetRepoResult>,
    search: (input: SearchReposInput): Promise<SearchReposResult> =>
      ipcRenderer.invoke(
        IPC.CATALOG.SEARCH,
        input,
      ) as Promise<SearchReposResult>,
    rescan: (input: RescanRepoInput): Promise<RescanRepoResult> =>
      ipcRenderer.invoke(
        IPC.CATALOG.RESCAN,
        input,
      ) as Promise<RescanRepoResult>,
    setTags: (input: SetRepoTagsInput): Promise<SetRepoTagsResult> =>
      ipcRenderer.invoke(
        IPC.CATALOG.SET_TAGS,
        input,
      ) as Promise<SetRepoTagsResult>,
    smartFilter: (input: SmartFilterInput): Promise<SmartFilterResult> =>
      ipcRenderer.invoke(
        IPC.CATALOG.SMART_FILTER,
        input,
      ) as Promise<SmartFilterResult>,
  },

  scan: {
    start: (input: StartScanInput): Promise<StartScanResult> =>
      ipcRenderer.invoke(IPC.SCAN.START, input) as Promise<StartScanResult>,
    status: (input: ScanStatusInput): Promise<ScanStatusResult> =>
      ipcRenderer.invoke(IPC.SCAN.STATUS, input) as Promise<ScanStatusResult>,
    cancel: (input: CancelScanInput): Promise<CancelScanResult> =>
      ipcRenderer.invoke(IPC.SCAN.CANCEL, input) as Promise<CancelScanResult>,
    /**
     * Subscribe to the scan event stream. Returns an unsubscribe lambda
     * that the caller MUST invoke (e.g. from a `useEffect` cleanup) to
     * avoid leaking listeners on renderer hot-reload.
     *
     * The renderer never sees `IpcRendererEvent` — the wrapper strips
     * it so subscribers only deal in `ScanEvent` payloads.
     */
    onProgress: (callback: (event: ScanEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: ScanEvent) => {
        callback(payload);
      };
      ipcRenderer.on(IPC.SCAN.ON_PROGRESS, handler);
      return () => {
        ipcRenderer.off(IPC.SCAN.ON_PROGRESS, handler);
      };
    },
  },

  git: {
    status: (input: GitStatusInput): Promise<GitStatus> =>
      ipcRenderer.invoke(IPC.GIT.STATUS, input) as Promise<GitStatus>,
    branches: (input: GitBranchesInput): Promise<GitBranchesResult> =>
      ipcRenderer.invoke(IPC.GIT.BRANCHES, input) as Promise<GitBranchesResult>,
    openInEditor: (input: OpenInEditorInput): Promise<OpenInEditorResult> =>
      ipcRenderer.invoke(
        IPC.GIT.OPEN_IN_EDITOR,
        input,
      ) as Promise<OpenInEditorResult>,
  },

  settings: {
    get: (): Promise<GetSettingsResult> =>
      ipcRenderer.invoke(IPC.SETTINGS.GET, {}) as Promise<GetSettingsResult>,
    update: (input: UpdateSettingsInput): Promise<UpdateSettingsResult> =>
      ipcRenderer.invoke(
        IPC.SETTINGS.UPDATE,
        input,
      ) as Promise<UpdateSettingsResult>,
  },

  groups: {
    list: (): Promise<ListGroupsResult> =>
      ipcRenderer.invoke(IPC.GROUPS.LIST, {}) as Promise<ListGroupsResult>,
    create: (input: CreateGroupInput): Promise<CreateGroupResult> =>
      ipcRenderer.invoke(
        IPC.GROUPS.CREATE,
        input,
      ) as Promise<CreateGroupResult>,
    rename: (input: RenameGroupInput): Promise<RenameGroupResult> =>
      ipcRenderer.invoke(
        IPC.GROUPS.RENAME,
        input,
      ) as Promise<RenameGroupResult>,
    delete: (input: DeleteGroupInput): Promise<DeleteGroupResult> =>
      ipcRenderer.invoke(
        IPC.GROUPS.DELETE,
        input,
      ) as Promise<DeleteGroupResult>,
    setMembers: (input: SetGroupMembersInput): Promise<SetGroupMembersResult> =>
      ipcRenderer.invoke(
        IPC.GROUPS.SET_MEMBERS,
        input,
      ) as Promise<SetGroupMembersResult>,
  },

  /**
   * Phase 2 `app:*` namespace — native shell affordances.
   *
   * `setDockBadge` / `notify` / `showSpotlight` / `hideSpotlight` /
   * `registerActions` are standard invoke channels. The `on*`
   * methods are push-event subscribers; each follows the
   * `scan.onProgress` pattern — returns an unsubscribe lambda the
   * renderer MUST call from cleanup to avoid listener leaks on hot
   * reload.
   */
  app: {
    /**
     * Ask main to navigate the main window to a repo (ATR-006). One-way
     * `ipcRenderer.send` to the tray open-repo forwarder; the spotlight
     * and tray-popover renderers call this, main re-broadcasts
     * `tray:on:open-repo`, and the main-window bus navigates to
     * `/repos/<slug>`. Channel literal matches `TRAY_OPEN_REPO_REQUEST_CHANNEL`.
     */
    openRepo: (slug: string): void => {
      ipcRenderer.send("tray:request-open-repo", { slug });
    },
    setDockBadge: (input: SetDockBadgeInput): Promise<SetDockBadgeResult> =>
      ipcRenderer.invoke(
        IPC.APP.SET_DOCK_BADGE,
        input,
      ) as Promise<SetDockBadgeResult>,
    notify: (input: NotifyInput): Promise<NotifyResult> =>
      ipcRenderer.invoke(IPC.APP.NOTIFY, input) as Promise<NotifyResult>,
    showSpotlight: (): Promise<ShowSpotlightResult> =>
      ipcRenderer.invoke(
        IPC.APP.SHOW_SPOTLIGHT,
        {},
      ) as Promise<ShowSpotlightResult>,
    hideSpotlight: (): Promise<HideSpotlightResult> =>
      ipcRenderer.invoke(
        IPC.APP.HIDE_SPOTLIGHT,
        {},
      ) as Promise<HideSpotlightResult>,
    registerActions: (
      input: RegisterActionsInput,
    ): Promise<RegisterActionsResult> =>
      ipcRenderer.invoke(
        IPC.APP.REGISTER_ACTIONS,
        input,
      ) as Promise<RegisterActionsResult>,

    /**
     * Subscribe to native-menu command events. Fires when the user
     * activates a native menu item OR presses its accelerator. The
     * `commandId` payload is the `Action.id` registered via
     * `registerActions`.
     */
    onMenuCommand: (
      callback: (payload: MenuCommandPayload) => void,
    ): (() => void) => {
      const handler = (
        _event: IpcRendererEvent,
        payload: MenuCommandPayload,
      ) => {
        callback(payload);
      };
      ipcRenderer.on(IPC.MENU.ON_COMMAND, handler);
      return () => {
        ipcRenderer.off(IPC.MENU.ON_COMMAND, handler);
      };
    },

    /**
     * Subscribe to deep-link events. Fires when the OS opens an
     * `alltherepos://...` URL. Payload contracts:
     *   - `path` — URL portion after `alltherepos://` (no leading `/`).
     *   - `params` — merged path captures + query string.
     * See `contracts/protocol.v1.md`.
     */
    onDeepLink: (
      callback: (payload: DeepLinkPayload) => void,
    ): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: DeepLinkPayload) => {
        callback(payload);
      };
      ipcRenderer.on(IPC.PROTOCOL.ON_DEEP_LINK, handler);
      return () => {
        ipcRenderer.off(IPC.PROTOCOL.ON_DEEP_LINK, handler);
      };
    },

    /**
     * Subscribe to tray "open repo" events. Fires when the user
     * clicks a recent-repo row in the tray popover.
     */
    onTrayOpenRepo: (
      callback: (payload: TrayOpenRepoPayload) => void,
    ): (() => void) => {
      const handler = (
        _event: IpcRendererEvent,
        payload: TrayOpenRepoPayload,
      ) => {
        callback(payload);
      };
      ipcRenderer.on(IPC.TRAY.ON_OPEN_REPO, handler);
      return () => {
        ipcRenderer.off(IPC.TRAY.ON_OPEN_REPO, handler);
      };
    },
  },

  /**
   * Phase 3a `process:*` namespace — listening-port + dev-server
   * detection backed by lsof in the main process. `onUpdate` mirrors
   * the `scan.onProgress` subscriber pattern: returns an unsubscribe
   * lambda the renderer MUST call from cleanup. The poller in main
   * tracks subscriber count and pauses when zero are listening.
   */
  process: {
    list: (): Promise<ListProcessesResult> =>
      ipcRenderer.invoke(IPC.PROCESS.LIST, {}) as Promise<ListProcessesResult>,
    listForRepo: (
      input: ListProcessesForRepoInput,
    ): Promise<ListProcessesForRepoResult> =>
      ipcRenderer.invoke(
        IPC.PROCESS.LIST_FOR_REPO,
        input,
      ) as Promise<ListProcessesForRepoResult>,
    kill: (input: KillProcessInput): Promise<KillProcessResult> =>
      ipcRenderer.invoke(IPC.PROCESS.KILL, input) as Promise<KillProcessResult>,
    onUpdate: (
      callback: (payload: ProcessUpdateEvent) => void,
    ): (() => void) => {
      const handler = (
        _event: IpcRendererEvent,
        payload: ProcessUpdateEvent,
      ) => {
        callback(payload);
      };
      ipcRenderer.on(IPC.PROCESS.ON_UPDATE, handler);
      return () => {
        ipcRenderer.off(IPC.PROCESS.ON_UPDATE, handler);
      };
    },
  },

  /**
   * Phase 3a `launcher:*` namespace — installed editor/terminal
   * detection + "open in X" dispatch. `detect` is session-cached in
   * main; restart to re-detect.
   */
  launcher: {
    detect: (): Promise<DetectLauncherResult> =>
      ipcRenderer.invoke(
        IPC.LAUNCHER.DETECT,
        {},
      ) as Promise<DetectLauncherResult>,
    openInEditor: (input: OpenInEditorPhase3Input): Promise<LauncherResult> =>
      ipcRenderer.invoke(
        IPC.LAUNCHER.OPEN_IN_EDITOR,
        input,
      ) as Promise<LauncherResult>,
    openInTerminal: (input: OpenInTerminalInput): Promise<LauncherResult> =>
      ipcRenderer.invoke(
        IPC.LAUNCHER.OPEN_IN_TERMINAL,
        input,
      ) as Promise<LauncherResult>,
    openInFinder: (input: OpenSlugInput): Promise<LauncherResult> =>
      ipcRenderer.invoke(
        IPC.LAUNCHER.OPEN_IN_FINDER,
        input,
      ) as Promise<LauncherResult>,
    openRemote: (input: OpenSlugInput): Promise<LauncherResult> =>
      ipcRenderer.invoke(
        IPC.LAUNCHER.OPEN_REMOTE,
        input,
      ) as Promise<LauncherResult>,
    copyPath: (input: OpenSlugInput): Promise<LauncherResult> =>
      ipcRenderer.invoke(
        IPC.LAUNCHER.COPY_PATH,
        input,
      ) as Promise<LauncherResult>,
  },

  /**
   * Phase 3b `claude:*` namespace — Claude Code integration. Reads
   * `~/.claude.json` + per-project JSONL transcripts + per-repo
   * `.claude/` directories. Mutations (open CLAUDE.md, launch Claude
   * Code) delegate to LauncherService.
   *
   * `onUpdate` is the chokidar-driven push event; payload is the
   * project hash whose state changed. Renderer invalidates the
   * matching queries on receipt.
   */
  claude: {
    index: (): Promise<ClaudeIndexResult> =>
      ipcRenderer.invoke(IPC.CLAUDE.INDEX, {}) as Promise<ClaudeIndexResult>,
    projects: (): Promise<ClaudeProjectsResult> =>
      ipcRenderer.invoke(
        IPC.CLAUDE.PROJECTS,
        {},
      ) as Promise<ClaudeProjectsResult>,
    repoState: (input: ClaudeRepoStateInput): Promise<ClaudeRepoStateResult> =>
      ipcRenderer.invoke(
        IPC.CLAUDE.REPO_STATE,
        input,
      ) as Promise<ClaudeRepoStateResult>,
    sessionTranscript: (
      input: ClaudeSessionTranscriptInput,
    ): Promise<ClaudeSessionTranscriptResult> =>
      ipcRenderer.invoke(
        IPC.CLAUDE.SESSION_TRANSCRIPT,
        input,
      ) as Promise<ClaudeSessionTranscriptResult>,
    globalUsage: (
      input: ClaudeGlobalUsageInput,
    ): Promise<ClaudeGlobalUsageResult> =>
      ipcRenderer.invoke(
        IPC.CLAUDE.GLOBAL_USAGE,
        input,
      ) as Promise<ClaudeGlobalUsageResult>,
    launch: (input: ClaudeLaunchInput): Promise<ClaudeLaunchResult> =>
      ipcRenderer.invoke(
        IPC.CLAUDE.LAUNCH,
        input,
      ) as Promise<ClaudeLaunchResult>,
    openClaudeMd: (
      input: ClaudeOpenClaudeMdInput,
    ): Promise<ClaudeOpenClaudeMdResult> =>
      ipcRenderer.invoke(
        IPC.CLAUDE.OPEN_CLAUDE_MD,
        input,
      ) as Promise<ClaudeOpenClaudeMdResult>,
    onUpdate: (
      callback: (payload: ClaudeUpdateEvent) => void,
    ): (() => void) => {
      const handler = (
        _event: IpcRendererEvent,
        payload: ClaudeUpdateEvent,
      ) => {
        callback(payload);
      };
      ipcRenderer.on(IPC.CLAUDE.ON_UPDATE, handler);
      return () => {
        ipcRenderer.off(IPC.CLAUDE.ON_UPDATE, handler);
      };
    },
  },
} as const;

export type AtrApi = typeof api;
