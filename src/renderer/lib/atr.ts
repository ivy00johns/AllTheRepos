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
 * `AtrApi` (currently Phase 0 `system` namespace). Phase 1 extends the
 * renderer-side view of the bridge to cover catalog/scan/git/settings/
 * groups even before the preload exports them — backend agents will
 * physically wire the missing methods in their own files. Until then
 * the hooks built on top of this module receive `undefined` at runtime
 * and short-circuit (see `getAtr()` null check below).
 */

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

/**
 * Phase 0 + Phase 1 IPC surface as exposed on `window.atr` by the
 * preload script. Keep in sync with `src/preload/index.d.ts`.
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
    smartFilter(input: SmartFilterInput): Promise<SmartFilterResult>;
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
    status(input: GitStatusInput): Promise<GitStatus>;
    branches(input: GitBranchesInput): Promise<GitBranchesResult>;
    openInEditor(input: OpenInEditorInput): Promise<OpenInEditorResult>;
  };
  settings: {
    get(): Promise<GetSettingsResult>;
    update(input: UpdateSettingsInput): Promise<UpdateSettingsResult>;
  };
  groups: {
    list(): Promise<ListGroupsResult>;
    create(input: CreateGroupInput): Promise<CreateGroupResult>;
    rename(input: RenameGroupInput): Promise<RenameGroupResult>;
    delete(input: DeleteGroupInput): Promise<DeleteGroupResult>;
    setMembers(input: SetGroupMembersInput): Promise<SetGroupMembersResult>;
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
