/**
 * Service interface contracts — Phase 1 IPC ↔ services boundary.
 *
 * This file is the IPC agent's view of what the backend-services agent
 * must export. It declares interface types only; the concrete
 * implementations live under `@main/services/*` and `@main/db/*`
 * (owned by backend-services).
 *
 * The IPC handlers import the concrete service instances by name from
 * the service modules. If a service shape drifts from this file, the
 * handler module's `tsc` will fail — that is intentional. This file is
 * the integration contract between the two backend agents.
 *
 * NOTE: keep this file in lockstep with NEW-PLAN.md §3 service split.
 */

import type { EventEmitter } from "node:events";

import type {
  CancelScanResult,
  CreateGroupInput,
  DeleteGroupResult,
  DeleteRepoResult,
  GetRepoResult,
  GitBranch,
  GitStatus,
  Group,
  ListReposInput,
  ListReposResult,
  OpenInEditorInput,
  RescanRepoResult,
  ScanEvent,
  ScanStatusResult,
  SearchReposInput,
  SearchReposResult,
  SetGroupMembersResult,
  SetRepoTagsResult,
  Settings,
  StartScanInput,
  StartScanResult,
} from "@shared/types";

// ---------------------------------------------------------------------------
// CatalogService — repo CRUD + group CRUD (groups live in the same DB).
// ---------------------------------------------------------------------------

export interface CatalogService {
  list(input: ListReposInput): Promise<ListReposResult>;
  get(slug: string): Promise<GetRepoResult>;
  rescan(slug: string): Promise<RescanRepoResult>;
  setTags(slug: string, tags: string[]): Promise<SetRepoTagsResult>;
  /** ATR-028: drop one catalog row (FTS/memberships/vector included); disk untouched. */
  deleteRepo(slug: string): Promise<DeleteRepoResult>;

  // Group methods (catalog owns the same DB; grouping them here avoids
  // a separate import for a 1-table service).
  listGroups(): Promise<Group[]>;
  createGroup(input: CreateGroupInput): Promise<Group>;
  renameGroup(id: number, name: string): Promise<Group>;
  deleteGroup(id: number): Promise<DeleteGroupResult>;
  setGroupMembers(
    groupId: number,
    slugs: string[],
  ): Promise<SetGroupMembersResult>;
}

// ---------------------------------------------------------------------------
// SearchService — hybrid FTS + vector search.
// ---------------------------------------------------------------------------

export interface SearchService {
  /**
   * Ranked hits, plus whether the vector half of the pipeline ran — a search
   * that silently answered with keywords alone is the bug this carries the
   * answer to.
   */
  search(input: SearchReposInput): Promise<SearchReposResult>;
}

// ---------------------------------------------------------------------------
// GitService — per-repo git status / branches / editor launch.
// ---------------------------------------------------------------------------

export interface GitService {
  status(slug: string): Promise<GitStatus>;
  branches(slug: string): Promise<GitBranch[]>;
  /**
   * Resolves the editor target URI for the repo + editor preference.
   * Returns `null` for `uri` when no launchable editor is configured.
   * Does NOT call `shell.openExternal` — the IPC handler does that via
   * the allowlist helper.
   */
  resolveEditorUri(input: OpenInEditorInput): Promise<{ uri: string | null }>;
  /**
   * Side-effect: stamps `repos.last_opened_at = now()` after a
   * successful editor launch. Called from the IPC handler once
   * `openExternalAllowlisted` returns `ok: true`.
   */
  markOpened(slug: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// SettingsService — wraps electron-store.
// ---------------------------------------------------------------------------

export interface SettingsService {
  get(): Promise<Settings>;
  /**
   * Last-write-wins merge over the existing blob. The handler is
   * responsible for Zod-validating the patch before this call.
   */
  update(patch: Partial<Settings>): Promise<Settings>;
}

// ---------------------------------------------------------------------------
// ScanService — scanner job lifecycle + progress event stream.
// ---------------------------------------------------------------------------

export interface ScanService {
  /** Spawns a new scan job. Rejects on overlap if the impl chooses to. */
  start(input: StartScanInput): Promise<StartScanResult>;
  status(jobId: string): Promise<ScanStatusResult>;
  cancel(jobId: string): Promise<CancelScanResult>;
  /** Optional boot step — e.g. resume an unfinished job. Phase 1: no-op OK. */
  boot(): Promise<void>;
  /**
   * Push-style channel. Emits `"progress"` with a `ScanEvent` payload.
   * The IPC layer subscribes once at app boot and forwards each event
   * to every BrowserWindow via `webContents.send`.
   */
  events: EventEmitter & {
    on(event: "progress", listener: (e: ScanEvent) => void): EventEmitter;
    off(event: "progress", listener: (e: ScanEvent) => void): EventEmitter;
  };
}

// ---------------------------------------------------------------------------
// Migration runners — backend-services owns implementations.
// ---------------------------------------------------------------------------

/** First-run copy of `~/.alltherepos/*` into `app.getPath('userData')/*`. */
export type MigrateLegacyDataFn = () => Promise<void>;

/** Drizzle migration runner (runs `drizzle/*.sql` against alltherepos.db). */
export type RunDrizzleMigrationsFn = () => Promise<void>;
