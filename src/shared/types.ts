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
  /** Optional editor override; defaults to Settings.defaultEditor. */
  editor?: "vscode" | "cursor" | "none";
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

/** Input for `settings:get`. Empty. */
export interface GetSettingsInput {
  // intentionally empty — Zod schema is `z.object({})`.
}

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

/** Input for `groups:list`. Empty. */
export interface ListGroupsInput {
  // intentionally empty — Zod schema is `z.object({})`.
}

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
