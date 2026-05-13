/**
 * Typed wrapper around `ipcRenderer.invoke` exposed via contextBridge.
 *
 * This is the renderer-facing API surface; the preload is the ONLY place
 * that has access to `ipcRenderer`. Every method here MUST:
 *   - reference a channel name from `@shared/ipc`'s `IPC` registry
 *     (no inline string literals), and
 *   - return a Promise typed against the shared `@shared/types` shape.
 *
 * Phase 0 exposed `system.ping`. Phase 1 adds the five namespaces
 * required by the renderer: catalog, scan, git, settings, groups.
 *
 * The `scan.onProgress` method is the only non-`invoke` channel — it
 * subscribes to a push-style event stream from main. The preload wraps
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
  DeleteGroupInput,
  DeleteGroupResult,
  GetRepoInput,
  GetRepoResult,
  GetSettingsResult,
  GitBranchesInput,
  GitBranchesResult,
  GitStatus,
  GitStatusInput,
  ListGroupsResult,
  ListReposInput,
  ListReposResult,
  OpenInEditorInput,
  OpenInEditorResult,
  PingInput,
  PingResponse,
  RenameGroupInput,
  RenameGroupResult,
  RescanRepoInput,
  RescanRepoResult,
  ScanEvent,
  ScanStatusInput,
  ScanStatusResult,
  SearchReposInput,
  SearchReposResult,
  SetGroupMembersInput,
  SetGroupMembersResult,
  SetRepoTagsInput,
  SetRepoTagsResult,
  SmartFilterInput,
  SmartFilterResult,
  StartScanInput,
  StartScanResult,
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
      ipcRenderer.invoke(IPC.CATALOG.SEARCH, input) as Promise<SearchReposResult>,
    rescan: (input: RescanRepoInput): Promise<RescanRepoResult> =>
      ipcRenderer.invoke(IPC.CATALOG.RESCAN, input) as Promise<RescanRepoResult>,
    setTags: (input: SetRepoTagsInput): Promise<SetRepoTagsResult> =>
      ipcRenderer.invoke(IPC.CATALOG.SET_TAGS, input) as Promise<SetRepoTagsResult>,
    smartFilter: (input: SmartFilterInput): Promise<SmartFilterResult> =>
      ipcRenderer.invoke(IPC.CATALOG.SMART_FILTER, input) as Promise<SmartFilterResult>,
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
      ipcRenderer.invoke(IPC.GIT.OPEN_IN_EDITOR, input) as Promise<OpenInEditorResult>,
  },

  settings: {
    get: (): Promise<GetSettingsResult> =>
      ipcRenderer.invoke(IPC.SETTINGS.GET, {}) as Promise<GetSettingsResult>,
    update: (input: UpdateSettingsInput): Promise<UpdateSettingsResult> =>
      ipcRenderer.invoke(IPC.SETTINGS.UPDATE, input) as Promise<UpdateSettingsResult>,
  },

  groups: {
    list: (): Promise<ListGroupsResult> =>
      ipcRenderer.invoke(IPC.GROUPS.LIST, {}) as Promise<ListGroupsResult>,
    create: (input: CreateGroupInput): Promise<CreateGroupResult> =>
      ipcRenderer.invoke(IPC.GROUPS.CREATE, input) as Promise<CreateGroupResult>,
    rename: (input: RenameGroupInput): Promise<RenameGroupResult> =>
      ipcRenderer.invoke(IPC.GROUPS.RENAME, input) as Promise<RenameGroupResult>,
    delete: (input: DeleteGroupInput): Promise<DeleteGroupResult> =>
      ipcRenderer.invoke(IPC.GROUPS.DELETE, input) as Promise<DeleteGroupResult>,
    setMembers: (input: SetGroupMembersInput): Promise<SetGroupMembersResult> =>
      ipcRenderer.invoke(IPC.GROUPS.SET_MEMBERS, input) as Promise<SetGroupMembersResult>,
  },
} as const;

export type AtrApi = typeof api;
