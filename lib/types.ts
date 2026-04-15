/**
 * CONTRACT v1 — Shared types (frozen)
 *
 * This file is the reference. The runtime copy lives at `lib/types.ts`
 * and MUST be kept in lockstep. Any change here requires:
 *  1. Bumping contract version in contracts/README.md
 *  2. Updating lib/types.ts identically
 *  3. Notifying all agents via orchestrator
 */

export type TagSource = "user" | "heuristic" | "smart";

export interface Tag {
  value: string;
  source: TagSource;
}

export interface LanguageBytes {
  /** Language name, e.g. "TypeScript", "Rust". */
  name: string;
  /** Bytes of source attributed to this language. */
  bytes: number;
  /** Hex color for UI (from GitHub linguist). */
  color: string;
}

/** Entity: Repo */
export interface Repo {
  id: number;
  slug: string;
  name: string;
  fullPath: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  currentBranch: string | null;
  lastCommitHash: string | null;
  lastCommitDate: string | null; // ISO-8601 UTC
  lastCommitMsg: string | null;
  isDirty: boolean;
  primaryLanguage: string | null;
  languages: LanguageBytes[];
  tags: Tag[];
  description: string | null;
  readmePreview: string | null; // first ~2kb only
  readmeHash: string | null;
  sizeBytes: number | null;
  lastScannedAt: string | null;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: "manual" | "filesystem_scan";
}

export interface RepoDetail extends Repo {
  readmeContent: string | null; // full README
  groups: Array<{ id: number; name: string }>;
}

/** Entity: Group */
export interface Group {
  id: number;
  name: string;
  description: string | null;
  isSmart: boolean;
  smartFilter: SmartFilter | null;
  parentGroupId: number | null;
  sortOrder: number;
  repoCount: number;
}

export interface SmartFilter {
  language?: string;
  tagsInclude?: string[];
  tagsExclude?: string[];
  dirtyOnly?: boolean;
  sinceDays?: number;
  hasRemote?: boolean;
}

/** Scan progress events (streamed NDJSON from POST /api/scan) */
export type ScanProgressEvent =
  | { kind: "started"; totalPaths: number }
  | { kind: "discovered"; fullPath: string; index: number; totalFound: number }
  | { kind: "indexed"; slug: string; name: string; index: number; totalFound: number }
  | { kind: "error"; fullPath: string; message: string }
  | { kind: "completed"; scanned: number; added: number; updated: number; errors: number; durationMs: number };

/** Search */
export interface SearchQuery {
  query: string;
  filters?: {
    language?: string | null;
    tags?: string[];
    groupIds?: number[];
    dirtyOnly?: boolean;
  };
  limit?: number; // default 50
}

export interface SearchHit {
  repo: Repo;
  score: number;
  matchKind: "fts" | "vector" | "hybrid";
  snippet: string | null;
}

/** Settings */
export interface Settings {
  scanPaths: string[];
  ollamaBaseUrl: string;
  ollamaEmbedModel: string;
  openaiEmbedModel: string | null;
  defaultEditor: "vscode" | "cursor" | "none";
  schemaVersion: number;
}

/** API envelopes */
export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code:
      | "NOT_FOUND"
      | "BAD_REQUEST"
      | "SCAN_FAILED"
      | "EMBED_UNAVAILABLE"
      | "DB_ERROR"
      | "VALIDATION"
      | "INTERNAL";
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResult<T> = ApiOk<T> | ApiError;

/** Server action result (same envelope as API) */
export type ActionResult<T> = ApiResult<T>;

/** Paginated repo list */
export interface RepoListQuery {
  q?: string;
  language?: string | null;
  tags?: string[];
  groupId?: number | null;
  dirtyOnly?: boolean;
  sort?: "lastCommit" | "name" | "lastScanned" | "lastOpened";
  order?: "asc" | "desc";
  limit?: number; // default 50, max 200
  offset?: number;
}

export interface RepoListResult {
  items: Repo[];
  total: number;
  limit: number;
  offset: number;
}
