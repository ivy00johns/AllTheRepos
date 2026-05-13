/**
 * CONTRACT v1 — Zod schemas for entities and IPC payloads shared between
 * the Electron main process and the renderer.
 *
 * Every `ipcMain.handle` MUST `.parse()` its input through the schema
 * defined here, and (where useful) `.parse()` its output before returning.
 * This is the type-safe substitute for electron-trpc described in
 * NEW-PLAN.md §3.3.
 *
 * Phase 0 scope: entity schemas for Repo / Group / Tag / ScanEvent and
 * the trivial `system:ping` channel. Do not add Phase 1+ channels here.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/** ISO-8601 UTC string. We don't try to be exhaustive — just a sanity check. */
const IsoDateString = z.string().min(1);

// ---------------------------------------------------------------------------
// Entity schemas
// ---------------------------------------------------------------------------

export const TagSourceSchema = z.enum(["user", "heuristic", "smart"]);

export const TagSchema = z.object({
  value: z.string().min(1),
  source: TagSourceSchema,
});

export const LanguageBytesSchema = z.object({
  name: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  color: z.string().min(1),
});

export const RepoSchema = z.object({
  id: z.number().int(),
  slug: z.string().min(1),
  name: z.string().min(1),
  fullPath: z.string().min(1),
  remoteUrl: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  currentBranch: z.string().nullable(),
  lastCommitHash: z.string().nullable(),
  lastCommitDate: IsoDateString.nullable(),
  lastCommitMsg: z.string().nullable(),
  isDirty: z.boolean(),
  primaryLanguage: z.string().nullable(),
  languages: z.array(LanguageBytesSchema),
  tags: z.array(TagSchema),
  description: z.string().nullable(),
  readmePreview: z.string().nullable(),
  readmeHash: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  lastScannedAt: IsoDateString.nullable(),
  lastOpenedAt: IsoDateString.nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
  source: z.enum(["manual", "filesystem_scan"]),
});

export const SmartFilterSchema = z.object({
  language: z.string().optional(),
  tagsInclude: z.array(z.string()).optional(),
  tagsExclude: z.array(z.string()).optional(),
  dirtyOnly: z.boolean().optional(),
  sinceDays: z.number().int().nonnegative().optional(),
  hasRemote: z.boolean().optional(),
});

export const GroupSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  description: z.string().nullable(),
  isSmart: z.boolean(),
  smartFilter: SmartFilterSchema.nullable(),
  parentGroupId: z.number().int().nullable(),
  sortOrder: z.number().int(),
  repoCount: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Scan event (locked in Phase 0, consumed in later phases)
// ---------------------------------------------------------------------------

export const ScanEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("progress"),
    processed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    currentPath: z.string(),
  }),
  z.object({
    kind: z.literal("repo"),
    repo: RepoSchema,
  }),
  z.object({
    kind: z.literal("done"),
    totalRepos: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("error"),
    message: z.string(),
    path: z.string().nullable(),
  }),
]);

// ---------------------------------------------------------------------------
// Phase 0 IPC: system:ping
// ---------------------------------------------------------------------------

export const PingInputSchema = z.object({
  nonce: z.string().optional(),
});

export const PingResponseSchema = z.object({
  ok: z.literal(true),
  pong: z.literal("pong"),
  mainProcessPid: z.number().int().nonnegative(),
  receivedAt: IsoDateString,
});

// ===========================================================================
// Phase 1 IPC schemas
// ===========================================================================
//
// Every Phase 1 channel listed in `contracts/ipc.v1.md` has a corresponding
// input schema and output schema below. The handler MUST `.parse()` its
// payload against the input schema before any work and SHOULD `.parse()` its
// return value against the output schema in dev mode.
//
// Reuse of the entity schemas above is intentional — when the entity shape
// evolves (in a new contract version), every channel that ferries that
// entity automatically picks up the new shape.

// ---------------------------------------------------------------------------
// Shared primitives reused by multiple Phase 1 channels
// ---------------------------------------------------------------------------

/** A non-empty repo slug. */
export const SlugSchema = z.string().min(1);

/** Settings entity (mirrors `Settings` in contracts/types.ts). */
export const SettingsSchema = z.object({
  scanPaths: z.array(z.string().min(1)),
  ollamaBaseUrl: z.string().min(1),
  ollamaEmbedModel: z.string().min(1),
  openaiEmbedModel: z.string().nullable(),
  defaultEditor: z.enum(["vscode", "cursor", "none"]),
  schemaVersion: z.number().int().nonnegative(),
});

/** Filter sub-object used by `catalog:list` and `catalog:search`. */
export const SearchFiltersSchema = z.object({
  language: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  groupIds: z.array(z.number().int()).optional(),
  dirtyOnly: z.boolean().optional(),
});

/** A single search hit (matches `SearchHit` in contracts/types.ts). */
export const SearchHitSchema = z.object({
  repo: RepoSchema,
  score: z.number(),
  matchKind: z.enum(["fts", "vector", "hybrid"]),
  snippet: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// catalog:list
// ---------------------------------------------------------------------------

export const ListReposInputSchema = z.object({
  q: z.string().optional(),
  language: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  groupId: z.number().int().nullable().optional(),
  smart: z.boolean().optional(),
  dirtyOnly: z.boolean().optional(),
  sort: z.enum(["lastCommit", "name", "lastScanned", "lastOpened"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export const ListReposResultSchema = z.object({
  items: z.array(RepoSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// catalog:get
// ---------------------------------------------------------------------------

export const GetRepoInputSchema = z.object({
  slug: SlugSchema,
});

/** RepoDetail extends Repo with `readmeContent` and `groups`. */
export const RepoDetailSchema = RepoSchema.extend({
  readmeContent: z.string().nullable(),
  groups: z.array(
    z.object({
      id: z.number().int(),
      name: z.string().min(1),
    }),
  ),
});

/** Null ⇒ caller maps to NOT_FOUND. */
export const GetRepoResultSchema = RepoDetailSchema.nullable();

// ---------------------------------------------------------------------------
// catalog:search
// ---------------------------------------------------------------------------

export const SearchReposInputSchema = z.object({
  q: z.string().min(1),
  mode: z.enum(["fts", "vector", "hybrid"]).optional(),
  filters: SearchFiltersSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const SearchReposResultSchema = z.array(SearchHitSchema);

// ---------------------------------------------------------------------------
// catalog:rescan
// ---------------------------------------------------------------------------

export const RescanRepoInputSchema = z.object({
  slug: SlugSchema,
});

export const RescanRepoResultSchema = RepoSchema;

// ---------------------------------------------------------------------------
// catalog:setTags
// ---------------------------------------------------------------------------

export const SetRepoTagsInputSchema = z.object({
  slug: SlugSchema,
  tags: z.array(z.string()).max(12),
});

export const SetRepoTagsResultSchema = RepoSchema;

// ---------------------------------------------------------------------------
// catalog:smartFilter (Phase 4 — contract locked in Phase 1)
// ---------------------------------------------------------------------------

export const SmartFilterInputSchema = z.object({
  prompt: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional(),
});

export const SmartFilterResultSchema = z.array(SearchHitSchema);

// ---------------------------------------------------------------------------
// scan:start / scan:status / scan:cancel
// ---------------------------------------------------------------------------

export const StartScanInputSchema = z.object({
  paths: z.array(z.string().min(1)).optional(),
});

export const StartScanResultSchema = z.object({
  jobId: z.string().min(1),
  status: z.literal("running"),
  startedAt: IsoDateString,
});

export const ScanStatusInputSchema = z.object({
  jobId: z.string().min(1),
});

export const ScanStatusResultSchema = z.object({
  jobId: z.string().min(1),
  status: z.enum(["running", "done", "error", "cancelled", "unknown"]),
  processed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  startedAt: IsoDateString,
  endedAt: IsoDateString.nullable(),
  errorMessage: z.string().nullable(),
});

export const CancelScanInputSchema = z.object({
  jobId: z.string().min(1),
});

export const CancelScanResultSchema = z.object({
  jobId: z.string().min(1),
  cancelled: z.boolean(),
});

// ---------------------------------------------------------------------------
// git:*
// ---------------------------------------------------------------------------

export const GitStatusInputSchema = z.object({
  slug: SlugSchema,
});

export const GitStatusSchema = z.object({
  slug: SlugSchema,
  isDirty: z.boolean(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  currentBranch: z.string().nullable(),
  upstream: z.string().nullable(),
});

export const GitBranchesInputSchema = z.object({
  slug: SlugSchema,
});

export const GitBranchSchema = z.object({
  name: z.string().min(1),
  isCurrent: z.boolean(),
  lastCommitHash: z.string().nullable(),
  lastCommitDate: IsoDateString.nullable(),
  lastCommitMsg: z.string().nullable(),
});

export const GitBranchesResultSchema = z.array(GitBranchSchema);

export const OpenInEditorInputSchema = z.object({
  slug: SlugSchema,
  editor: z.enum(["vscode", "cursor", "none"]).optional(),
});

export const OpenInEditorResultSchema = z.object({
  opened: z.boolean(),
  uri: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// settings:*
// ---------------------------------------------------------------------------

export const GetSettingsInputSchema = z.object({}).strict();
export const GetSettingsResultSchema = SettingsSchema;

/**
 * Partial Settings — every key optional. Pass-through values are merged
 * server-side over the current Settings blob.
 */
export const UpdateSettingsInputSchema = SettingsSchema.partial();
export const UpdateSettingsResultSchema = SettingsSchema;

// ---------------------------------------------------------------------------
// groups:*
// ---------------------------------------------------------------------------

export const ListGroupsInputSchema = z.object({}).strict();
export const ListGroupsResultSchema = z.array(GroupSchema);

export const CreateGroupInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  isSmart: z.boolean().optional(),
  smartFilter: SmartFilterSchema.nullable().optional(),
  parentGroupId: z.number().int().nullable().optional(),
});
export const CreateGroupResultSchema = GroupSchema;

export const RenameGroupInputSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
});
export const RenameGroupResultSchema = GroupSchema;

export const DeleteGroupInputSchema = z.object({
  id: z.number().int(),
});
export const DeleteGroupResultSchema = z.object({
  deleted: z.literal(true),
  id: z.number().int(),
});

export const SetGroupMembersInputSchema = z.object({
  groupId: z.number().int(),
  slugs: z.array(SlugSchema),
});
export const SetGroupMembersResultSchema = z.object({
  groupId: z.number().int(),
  memberCount: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Convenience inferred types (prefer the hand-written types in ./types.ts
// where they exist; these exist for handler-internal use).
// ---------------------------------------------------------------------------

export type RepoZ = z.infer<typeof RepoSchema>;
export type GroupZ = z.infer<typeof GroupSchema>;
export type TagZ = z.infer<typeof TagSchema>;
export type ScanEventZ = z.infer<typeof ScanEventSchema>;
export type PingInputZ = z.infer<typeof PingInputSchema>;
export type PingResponseZ = z.infer<typeof PingResponseSchema>;
export type SettingsZ = z.infer<typeof SettingsSchema>;
export type SearchHitZ = z.infer<typeof SearchHitSchema>;
export type RepoDetailZ = z.infer<typeof RepoDetailSchema>;
export type GitStatusZ = z.infer<typeof GitStatusSchema>;
export type GitBranchZ = z.infer<typeof GitBranchSchema>;
