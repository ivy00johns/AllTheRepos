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
// Launcher enums
// ---------------------------------------------------------------------------
//
// Declared here rather than down in the Phase 3a block because
// `SettingsSchema` — defined just below — persists `defaultEditor`, which is
// one of these ids. `@main/services/launcher` holds the detection table that
// is the runtime source of truth for the set; the unit suite pins the two
// together, so adding an editor means adding it in both places.

export const EDITOR_IDS = [
  "vscode",
  "cursor",
  "zed",
  "windsurf",
  "devin",
  "sublime",
  "xcode",
  "idea",
  "webstorm",
  "pycharm",
  "rider",
  "goland",
  "clion",
  "rubymine",
] as const;

export const EditorIdSchema = z.enum(EDITOR_IDS);
export type EditorIdZ = z.infer<typeof EditorIdSchema>;

export const TERMINAL_IDS = [
  "terminal",
  "iterm2",
  "warp",
  "ghostty",
  "alacritty",
  "kitty",
  "hyper",
] as const;

export const TerminalIdSchema = z.enum(TERMINAL_IDS);
export type TerminalIdZ = z.infer<typeof TerminalIdSchema>;

/**
 * The persisted `defaultEditor`.
 *
 * Wider than `EditorIdSchema` by exactly one value: `"none"` — the "no
 * default, use whatever is installed" choice the Settings page offers, kept a
 * first-class member of the union rather than an absent/empty value.
 *
 * Being a closed three-value enum (`vscode | cursor | none`) is what made
 * every other editor the detection table had already found unwritable: the
 * list offered Devin, Zod rejected it, and the choice was silently lost.
 */
export const DefaultEditorSchema = z.union([EditorIdSchema, z.literal("none")]);
export type DefaultEditorZ = z.infer<typeof DefaultEditorSchema>;

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
  isFavorite: z.boolean(),
  favoritedAt: IsoDateString.nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
  source: z.enum(["manual", "filesystem_scan"]),
  /** ATR-028: computed at read time — true when fullPath is gone from disk. */
  missing: z.boolean().optional(),
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
  /**
   * Any editor the launcher can detect, or `"none"`. Accepting the whole
   * `EditorId` set (not just vscode/cursor) is what makes the detection list
   * in Settings actually persist the choice it shows.
   */
  defaultEditor: DefaultEditorSchema,
  /**
   * Phase 3a — terminal the launcher opens a repo in. `null` means "first
   * available". Optional so settings files written before 3a still parse.
   */
  defaultTerminal: TerminalIdSchema.nullable().default(null),
  /**
   * Git host handles that belong to the user. Drives the "is this mine?"
   * classification in the catalog. Defaults to an empty list, which the
   * renderer bootstraps by inferring the dominant remote owner — so the
   * feature works before the user ever opens Settings.
   */
  identities: z.array(z.string().min(1)).default([]),
  /**
   * Whether the one-off "this build is not notarised" notice has been
   * dismissed. Defaulted, not required: a `settings.json` written before
   * this field existed still parses, and an un-notarised build is exactly
   * the common case, so the notice appears once and stays gone.
   */
  adHocNoticeDismissed: z.boolean().default(false),
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
// catalog:delete (ATR-028)
// ---------------------------------------------------------------------------

export const DeleteRepoInputSchema = z.object({
  slug: SlugSchema,
});

export const DeleteRepoResultSchema = z.object({
  slug: SlugSchema,
  deleted: z.boolean(),
});

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
// catalog:cover — project artwork resolution
// ---------------------------------------------------------------------------

export const CoverInputSchema = z.object({ slug: z.string().min(1) });

export const CoverResultSchema = z.object({
  /** Data URL, or null when the project ships no usable artwork. */
  src: z.string().nullable(),
  source: z.enum(["readme", "file"]).nullable(),
  relativePath: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// catalog:move* — relocation on disk
// ---------------------------------------------------------------------------

export const MoveBlockerSchema = z.enum([
  "missing",
  "dirty",
  "running-process",
  "destination-exists",
  "target-outside-roots",
  "target-inside-source",
  "same-location",
  "cross-device",
  "unknown-repo",
]);

/**
 * Batch size is capped so a runaway selection can't ask the main process
 * to stat and rename thousands of directories in one synchronous-feeling
 * IPC call.
 */
export const MoveInputSchema = z.object({
  slugs: z.array(z.string().min(1)).min(1).max(500),
  targetDir: z.string().min(1),
});

export const MoveCheckEntrySchema = z.object({
  slug: z.string(),
  name: z.string(),
  fromPath: z.string(),
  toPath: z.string(),
  ok: z.boolean(),
  blockers: z.array(MoveBlockerSchema),
});

export const MoveCheckResultSchema = z.object({
  targetDir: z.string(),
  entries: z.array(MoveCheckEntrySchema),
  movableCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
});

export const MoveEntryResultSchema = z.object({
  slug: z.string(),
  moved: z.boolean(),
  fromPath: z.string(),
  toPath: z.string(),
  error: z.string().nullable(),
});

export const MoveResultSchema = z.object({
  targetDir: z.string(),
  entries: z.array(MoveEntryResultSchema),
  movedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  batchId: z.string().nullable(),
});

export const MoveUndoInputSchema = z.object({
  batchId: z.string().min(1).optional(),
});

export const MoveLastInputSchema = z.object({});

export const MoveLastResultSchema = z
  .object({
    batchId: z.string(),
    at: z.string(),
    count: z.number().int().nonnegative(),
    /** What sort of operation it was, so undo can be described honestly. */
    kind: z.enum(["repos", "folder", "create"]),
    /** Ready-made summary for the undo affordance, e.g. "moved 3 repos". */
    label: z.string(),
  })
  .nullable();

// ---------------------------------------------------------------------------
// catalog:folder* — restructuring directories, not just repos
// ---------------------------------------------------------------------------

export const FolderBlockerSchema = z.enum([
  "missing",
  "not-a-directory",
  "invalid-name",
  "destination-exists",
  "target-outside-roots",
  "target-inside-source",
  "same-location",
  "is-scan-root",
  "dirty-repos",
  "running-processes",
]);

export const FolderCheckInputSchema = z.object({
  fromPath: z.string().min(1),
  toPath: z.string().min(1),
});

export const AffectedRepoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  fromPath: z.string(),
  toPath: z.string(),
  isDirty: z.boolean(),
  hasProcess: z.boolean(),
});

export const FolderCheckResultSchema = z.object({
  fromPath: z.string(),
  toPath: z.string(),
  affected: z.array(AffectedRepoSchema),
  blockers: z.array(FolderBlockerSchema),
  ok: z.boolean(),
});

export const FolderRenameInputSchema = z.object({
  fromPath: z.string().min(1),
  newName: z.string().min(1).max(255),
});

export const FolderMoveInputSchema = z.object({
  fromPath: z.string().min(1),
  parentPath: z.string().min(1),
});

export const FolderCreateInputSchema = z.object({
  parentPath: z.string().min(1),
  name: z.string().min(1).max(255),
});

export const FolderOpResultSchema = z.object({
  ok: z.boolean(),
  fromPath: z.string(),
  toPath: z.string(),
  movedRepos: z.number().int().nonnegative(),
  batchId: z.string().nullable(),
  error: z.string().nullable(),
});

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
  editor: DefaultEditorSchema.optional(),
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

// --- scan-root management (driven from the rail) ---------------------------

export const PickScanPathInputSchema = z.object({});
export const PickScanPathResultSchema = z.object({
  /** `null` when the picker was cancelled. */
  path: z.string().nullable(),
});

export const AddScanPathInputSchema = z.object({ path: z.string().min(1) });
export const AddScanPathResultSchema = z.object({
  settings: SettingsSchema,
  added: z.boolean(),
  reason: z.string().nullable(),
});

export const RemoveScanPathInputSchema = z.object({
  path: z.string().min(1),
  /** Drop the catalog rows found there. Never touches files on disk. */
  forgetRepos: z.boolean(),
});
export const RemoveScanPathResultSchema = z.object({
  settings: SettingsSchema,
  removed: z.boolean(),
  forgotten: z.number().int().nonnegative(),
  reason: z.string().nullable(),
});

/**
 * Live catalog change, pushed when the watcher reconciles a batch of
 * filesystem events. `vanished` repos are reported, never deleted.
 */
export const CatalogChangeEventSchema = z.object({
  added: z.array(z.string()),
  updated: z.array(z.string()),
  vanished: z.array(z.string()),
  at: z.string(),
});

export const SetFavoriteInputSchema = z.object({
  slug: z.string().min(1),
  favorite: z.boolean(),
});
export const SetFavoriteResultSchema = RepoSchema.nullable();

// ---------------------------------------------------------------------------
// git:fetch / git:pull
// ---------------------------------------------------------------------------

export const SyncOutcomeSchema = z.enum([
  "updated",
  "already-current",
  "fetched",
  "no-remote",
  "no-upstream",
  "dirty",
  "diverged",
  "missing",
  "failed",
]);

export const SyncInputSchema = z.object({
  slugs: z.array(z.string().min(1)).min(1).max(500),
});

export const SyncEntrySchema = z.object({
  slug: z.string(),
  name: z.string(),
  outcome: SyncOutcomeSchema,
  received: z.number().int().nonnegative(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  currentBranch: z.string().nullable(),
  message: z.string().nullable(),
});

export const SyncResultSchema = z.object({
  entries: z.array(SyncEntrySchema),
  updated: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// tasks:*
// ---------------------------------------------------------------------------

export const RepoTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  command: z.string(),
  detail: z.string().nullable(),
});

export const TaskListInputSchema = z.object({ slug: z.string().min(1) });
export const TaskListResultSchema = z.object({
  tasks: z.array(RepoTaskSchema),
});

export const TaskStartInputSchema = z.object({
  slug: z.string().min(1),
  taskId: z.string().min(1),
});
export const TaskStartResultSchema = z.object({
  runId: z.string().nullable(),
  started: z.boolean(),
  reason: z.string().nullable(),
});

export const TaskStopInputSchema = z.object({ runId: z.string().min(1) });
export const TaskStopResultSchema = z.object({ stopped: z.boolean() });

export const TaskActiveInputSchema = z.object({});
export const TaskActiveResultSchema = z.object({
  runs: z.array(
    z.object({
      runId: z.string(),
      slug: z.string(),
      taskId: z.string(),
      command: z.string(),
      startedAt: z.string(),
    }),
  ),
});

export const TaskOutputEventSchema = z.object({
  runId: z.string(),
  slug: z.string(),
  kind: z.enum(["started", "stdout", "stderr", "exited"]),
  chunk: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  at: z.string(),
});

/**
 * Update status.
 *
 * `unavailable` is distinct from `error`: it means we deliberately
 * didn't check (running from source, no token), not that checking broke.
 *
 * `downloading` and `ready` only ever appear on a build that can install:
 * `autoDownload` is off everywhere else, because a build macOS will refuse to
 * update must not spend a hundred megabytes proving it.
 */
export const UpdateStateSchema = z.enum([
  "idle",
  "checking",
  "available",
  "downloading",
  "ready",
  "current",
  "error",
  "unavailable",
]);
export type UpdateStateZ = z.infer<typeof UpdateStateSchema>;

/**
 * How the *running bundle* is signed, as read back off its own signature.
 *
 * This is the fact `canInstall` is derived from, and the reason the UI can
 * explain itself: "ad-hoc signed" and "running from source" are different
 * answers to the same question, and only one of them is fixable by the user.
 */
export const UpdateSignatureSchema = z.enum([
  "developer-id",
  "ad-hoc",
  "unsigned",
  "unknown",
]);
export type UpdateSignatureZ = z.infer<typeof UpdateSignatureSchema>;

export const UpdateStatusSchema = z.object({
  state: UpdateStateSchema,
  currentVersion: z.string(),
  newVersion: z.string().nullable(),
  releaseUrl: z.string().nullable(),
  message: z.string().nullable(),
  checkedAt: z.string().nullable(),
  /**
   * Whether this build may install an update itself, rather than asking
   * the user to download a DMG. True only for a packaged, Developer-ID
   * signed, Gatekeeper-accepted bundle — see `@main/services/signing`.
   */
  canInstall: z.boolean(),
  /** Why `canInstall` is what it is. */
  signature: UpdateSignatureSchema,
  /** 0–100 while a download is in flight; null at every other moment. */
  progress: z.number().nullable(),
});

export const UpdateCheckInputSchema = z.object({});
export const OpenReleaseInputSchema = z.object({});
export const OpenReleaseResultSchema = z.object({
  opened: z.boolean(),
  reason: z.string().nullable(),
});
export const UpdateStatusInputSchema = z.object({});
export const InstallUpdateInputSchema = z.object({});
export const InstallUpdateResultSchema = z.object({
  /**
   * False when the app declined to install — with `reason` saying why.
   * A refusal is a normal answer here, not an error: most builds cannot
   * install, and the caller is told so in words it can show a person.
   */
  started: z.boolean(),
  reason: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// graph:build
// ---------------------------------------------------------------------------

/**
 * How one repo relates to another, as asserted by a human or an agent.
 *
 * `part-of` is the load-bearing one: it claims the source belongs under
 * the target, which is what makes a curated link actionable for reorg.
 */
export const RepoLinkKindSchema = z.enum([
  "part-of",
  "depends-on",
  "supersedes",
  "forked-from",
  "related",
]);

export const RepoLinkSchema = z.object({
  id: z.number().int().positive(),
  fromSlug: z.string(),
  toSlug: z.string(),
  kind: RepoLinkKindSchema,
  why: z.string().nullable(),
  source: z.enum(["mcp", "ui"]),
  createdAt: z.string(),
});

/** Why two repos are connected. */
export const GraphSignalSchema = z.enum([
  "dependency",
  "reference",
  "submodule",
  "owner",
  "naming",
  "curated",
]);

export const GraphNodeSchema = z.object({
  slug: z.string(),
  name: z.string(),
  folder: z.string(),
  language: z.string().nullable(),
  isFavorite: z.boolean(),
  lastCommitDate: z.string().nullable(),
  cluster: z.number().int().nonnegative(),
  degree: z.number().int().nonnegative(),
});

export const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  weight: z.number(),
  signals: z.array(GraphSignalSchema),
  /** Short human reasons, e.g. the shared library names. */
  why: z.array(z.string()),
  /**
   * Directed detail for curated links on this edge.
   *
   * The edge itself stays undirected — the force layout and cluster
   * detection both depend on that — so direction rides along as
   * metadata the UI renders.
   */
  curated: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        kind: RepoLinkKindSchema,
        why: z.string().nullable(),
      }),
    )
    .optional(),
});

export const GraphClusterSchema = z.object({
  id: z.number().int().nonnegative(),
  label: z.string(),
  size: z.number().int().nonnegative(),
  slugs: z.array(z.string()),
  folders: z.array(
    z.object({ folder: z.string(), count: z.number().int().nonnegative() }),
  ),
  /** How many distinct folders the cluster is spread across. */
  folderSpread: z.number().int().nonnegative(),
  dominantFolder: z.string(),
  /** Members living outside the dominant folder — the reorg candidates. */
  strays: z.array(z.string()),
});

export const GraphBuildInputSchema = z.object({});
export const GraphResultSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  clusters: z.array(GraphClusterSchema),
  builtAt: z.string(),
});

/**
 * Curated links touching one repo, resolved to the *other* side.
 *
 * The graph page asks for the whole map at once and pays for it; the
 * catalog wants one repo's assertions on selection, which is a single
 * indexed read. Hence a shape of its own rather than a `GraphEdge` reuse.
 */
export const RepoRelationsInputSchema = z.object({ slug: z.string().min(1) });

export const RepoRelationSchema = z.object({
  /** The repo on the other end of the link. */
  slug: z.string(),
  name: z.string(),
  kind: RepoLinkKindSchema,
  /**
   * `outgoing` when the selected repo asserts the link, `incoming` when
   * another repo asserts it about this one. Direction is kept because
   * `part-of` reads very differently each way.
   */
  direction: z.enum(["outgoing", "incoming"]),
  why: z.string().nullable(),
  source: z.enum(["mcp", "ui"]),
  createdAt: z.string(),
});

export const RepoRelationsResultSchema = z.object({
  relations: z.array(RepoRelationSchema),
});

/**
 * Assert a curated link, from the catalog itself.
 *
 * Mirrors the MCP's `link` tool with one difference: both ends are named
 * by slug. The renderer never holds a path — the panel has the slug of the
 * repo on screen and the picker hands back another — so the main process
 * resolves slugs to ids and the path-addressing rule (`db/links.ts`) stays
 * where it is enforced.
 */
export const AssertRepoLinkInputSchema = z.object({
  fromSlug: z.string().min(1),
  toSlug: z.string().min(1),
  kind: RepoLinkKindSchema,
  /**
   * Required, exactly as it is for the MCP. A curated link outranks every
   * derived signal on the map, so an unexplained one is worse than none.
   */
  why: z.string().trim().min(1).max(500),
});

export const AssertRepoLinkResultSchema = z.object({ link: RepoLinkSchema });

/**
 * Remove a curated link.
 *
 * Both ends are named so nothing is guessed: `RepoRelation.direction`
 * tells the panel which side it is looking at, and it can therefore say
 * which end is `from` without a second round trip.
 */
export const RemoveRepoLinkInputSchema = z.object({
  fromSlug: z.string().min(1),
  toSlug: z.string().min(1),
  kind: RepoLinkKindSchema,
});

export const RemoveRepoLinkResultSchema = z.object({ removed: z.boolean() });

export const CountUnderInputSchema = z.object({ path: z.string().min(1) });
export const CountUnderResultSchema = z.object({
  count: z.number().int().nonnegative(),
});

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

// ===========================================================================
// Phase 2 IPC schemas — app:* + push-event payloads
// ===========================================================================
//
// Each Phase 2 channel listed in `contracts/ipc.v1.md` has a matching
// input/output schema below; each push-event channel has a payload schema.
// Handlers MUST `.parse()` inputs; event publishers SHOULD `.parse()`
// payloads in dev mode before `webContents.send(...)`.
//
// See `contracts/actions.v1.md` for the Action grammar and the baseline
// Phase 2 action list, and `contracts/protocol.v1.md` for the
// `alltherepos://` URL grammar.

// ---------------------------------------------------------------------------
// Actions registry — used by `app:registerActions` and validated by the
// renderer before shipping its registry over the bridge.
// ---------------------------------------------------------------------------

/**
 * Action id grammar — kebab-case, dot-namespaced.
 * Examples: `catalog.refresh`, `app.open-settings`, `repo.copy-path`.
 */
export const ActionIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9.-]*$/, "action id must be kebab-case + dots");

/** Scope enum — see `ActionScope` in ./types.ts. */
export const ActionScopeSchema = z.enum([
  "global",
  "catalog",
  "repo-detail",
  "settings",
  "spotlight",
]);

/**
 * Loose Electron Accelerator sanity check. We do NOT try to validate
 * every Electron-permitted modifier here — main rejects unbindable
 * shortcuts at registration time. We only enforce a printable-ASCII
 * shape so a malformed string from a renderer bug fails fast at the
 * IPC boundary.
 */
export const AcceleratorSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\x20-\x7E]+$/, "shortcut must be printable ASCII");

export const ActionSchema = z.object({
  id: ActionIdSchema,
  label: z.string().min(1).max(120),
  scope: ActionScopeSchema,
  shortcut: AcceleratorSchema.optional(),
  icon: z.string().min(1).max(64).optional(),
  hint: z.string().min(1).max(200).optional(),
  group: z.string().min(1).max(64).optional(),
  devOnly: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Notification primitives
// ---------------------------------------------------------------------------

export const NotificationActionSchema = z.object({
  type: z.literal("button"),
  text: z.string().min(1).max(64),
});

// ---------------------------------------------------------------------------
// app:setDockBadge
// ---------------------------------------------------------------------------

export const SetDockBadgeInputSchema = z.object({
  /**
   * Dock badge count. `null` ⇒ clear. Capped at 9999 so a runaway
   * caller cannot render a wall of numerals into the dock.
   */
  count: z.number().int().nonnegative().max(9999).nullable(),
});

export const SetDockBadgeResultSchema = z.object({
  badge: z.string(),
});

// ---------------------------------------------------------------------------
// app:notify
// ---------------------------------------------------------------------------

export const NotifyInputSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  silent: z.boolean().optional(),
  /** macOS reliably shows ≤1 action button on banners; cap defensively. */
  actions: z.array(NotificationActionSchema).max(3).optional(),
});

export const NotifyResultSchema = z.object({
  shown: z.boolean(),
});

// ---------------------------------------------------------------------------
// app:showSpotlight / app:hideSpotlight
// ---------------------------------------------------------------------------

export const ShowSpotlightInputSchema = z.object({}).strict();
export const ShowSpotlightResultSchema = z.object({
  visible: z.literal(true),
});

export const HideSpotlightInputSchema = z.object({}).strict();
export const HideSpotlightResultSchema = z.object({
  visible: z.literal(false),
});

// ---------------------------------------------------------------------------
// app:registerActions
// ---------------------------------------------------------------------------

export const RegisterActionsInputSchema = z.object({
  /** Capped at 200 to bound menu / accelerator binding work on main. */
  actions: z.array(ActionSchema).max(200),
});

export const RegisterActionsResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Push-event payloads (main → renderer)
// ---------------------------------------------------------------------------

/** Payload for `menu:on:command`. */
export const MenuCommandPayloadSchema = z.object({
  commandId: ActionIdSchema,
});

/**
 * Payload for `protocol:on:deep-link`. `path` is the URL portion AFTER
 * `alltherepos://` with no leading or trailing slash. `params` include
 * both query-string entries AND named path captures (see
 * `contracts/protocol.v1.md`).
 */
export const DeepLinkPayloadSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[^/].*$/, "path must not start with '/'"),
  params: z.record(z.string(), z.string()),
});

/** Payload for `tray:on:open-repo`. */
export const TrayOpenRepoPayloadSchema = z.object({
  slug: SlugSchema,
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
export type ActionZ = z.infer<typeof ActionSchema>;
export type ActionScopeZ = z.infer<typeof ActionScopeSchema>;
export type NotificationActionZ = z.infer<typeof NotificationActionSchema>;
export type MenuCommandPayloadZ = z.infer<typeof MenuCommandPayloadSchema>;
export type DeepLinkPayloadZ = z.infer<typeof DeepLinkPayloadSchema>;
export type TrayOpenRepoPayloadZ = z.infer<typeof TrayOpenRepoPayloadSchema>;

// ===========================================================================
// Phase 3a — process detection + launcher
// ===========================================================================

// ---------------------------------------------------------------------------
// Process namespace
// ---------------------------------------------------------------------------

/**
 * One listening process surfaced by the lsof poller. `repoSlug` is set
 * when ProcessService matched the cwd (or any ancestor cwd, walking
 * `ppid`) against a catalog repo; null otherwise.
 */
export const ProcessInfoSchema = z.object({
  pid: z.number().int().positive(),
  ppid: z.number().int().nonnegative(),
  command: z.string().min(1),
  commandLine: z.string().min(1),
  port: z.number().int().min(0).max(65535),
  protocol: z.enum(["tcp"]).or(z.string().min(1)),
  cwd: z.string().nullable(),
  repoSlug: z.string().nullable(),
  firstSeenAt: z.number().int().nonnegative(),
  observedAt: z.number().int().nonnegative(),
});
export type ProcessInfoZ = z.infer<typeof ProcessInfoSchema>;

export const ListProcessesInputSchema = z.object({}).strict();
export const ListProcessesResultSchema = z.object({
  processes: z.array(ProcessInfoSchema),
  snapshotAt: z.number().int().nonnegative(),
});

export const ListProcessesForRepoInputSchema = z
  .object({ slug: z.string().min(1) })
  .strict();
export const ListProcessesForRepoResultSchema = ListProcessesResultSchema;

export const KillProcessInputSchema = z
  .object({
    pid: z.number().int().positive(),
    escalateMs: z.number().int().min(100).max(60_000).optional(),
  })
  .strict();
export const KillProcessResultSchema = z.object({
  pid: z.number().int().positive(),
  finalSignal: z.enum(["SIGINT", "SIGTERM", "SIGKILL", "noop"]),
  stopped: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});

export const ProcessUpdateEventSchema = ListProcessesResultSchema;

export type ListProcessesResultZ = z.infer<typeof ListProcessesResultSchema>;
export type KillProcessInputZ = z.infer<typeof KillProcessInputSchema>;
export type KillProcessResultZ = z.infer<typeof KillProcessResultSchema>;
export type ProcessUpdateEventZ = z.infer<typeof ProcessUpdateEventSchema>;

// ---------------------------------------------------------------------------
// Launcher namespace
// ---------------------------------------------------------------------------

// `EditorIdSchema` / `TerminalIdSchema` (and the `DefaultEditorSchema` union
// built on them) are declared near the top of this file, ahead of
// `SettingsSchema` — see the "Launcher enums" section.

export const DetectedEditorSchema = z.object({
  id: EditorIdSchema,
  name: z.string().min(1),
  available: z.boolean(),
  scheme: z.string().nullable(),
  appPath: z.string().nullable(),
  cliPath: z.string().nullable(),
});
export type DetectedEditorZ = z.infer<typeof DetectedEditorSchema>;

export const DetectedTerminalSchema = z.object({
  id: TerminalIdSchema,
  name: z.string().min(1),
  available: z.boolean(),
  appPath: z.string().nullable(),
});
export type DetectedTerminalZ = z.infer<typeof DetectedTerminalSchema>;

export const DetectLauncherInputSchema = z.object({}).strict();
export const DetectLauncherResultSchema = z.object({
  editors: z.array(DetectedEditorSchema),
  terminals: z.array(DetectedTerminalSchema),
  defaults: z.object({
    editor: EditorIdSchema.nullable(),
    terminal: TerminalIdSchema.nullable(),
  }),
});
export type DetectLauncherResultZ = z.infer<typeof DetectLauncherResultSchema>;

export const OpenInEditorPhase3InputSchema = z
  .object({
    slug: z.string().min(1),
    editorId: EditorIdSchema.optional(),
  })
  .strict();
export const OpenInTerminalInputSchema = z
  .object({
    slug: z.string().min(1),
    terminalId: TerminalIdSchema.optional(),
    command: z.string().optional(),
  })
  .strict();
export const OpenSlugInputSchema = z
  .object({ slug: z.string().min(1) })
  .strict();
export const LauncherResultSchema = z.object({
  ok: z.boolean(),
  reason: z.string().nullable().optional(),
});
export type LauncherResultZ = z.infer<typeof LauncherResultSchema>;
export type OpenInEditorPhase3InputZ = z.infer<
  typeof OpenInEditorPhase3InputSchema
>;
export type OpenInTerminalInputZ = z.infer<typeof OpenInTerminalInputSchema>;

// ===========================================================================
// Phase 3b — Claude Code integration
// ===========================================================================

/**
 * Token-usage block as emitted by Claude Code on each assistant turn.
 * Keys match the wire format in `<session>.jsonl` (`usage.input_tokens`
 * etc.) but exposed in camelCase. `cacheCreationInputTokens` and
 * `cacheReadInputTokens` may be absent on older sessions — default 0.
 */
export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type TokenUsageZ = z.infer<typeof TokenUsageSchema>;

/**
 * One Claude session — derived from a single `<sessionId>.jsonl` file.
 * Only the file header / footer is parsed eagerly; the transcript body
 * is loaded on demand via `claude:sessionTranscript`.
 */
export const ClaudeSessionSchema = z.object({
  id: z.string().min(1),
  projectHash: z.string().min(1),
  startedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  /** Total number of newline-delimited JSON events in the file. */
  messageCount: z.number().int().nonnegative(),
  /** Sum across every assistant message that emitted a `usage` block. */
  tokenUsage: TokenUsageSchema,
  /** Absolute path to the `.jsonl` file. */
  filePath: z.string().min(1),
  /** File size in bytes — useful for the renderer's "open at offset" UX. */
  sizeBytes: z.number().int().nonnegative(),
});
export type ClaudeSessionZ = z.infer<typeof ClaudeSessionSchema>;

/**
 * One Claude project — derived from `~/.claude.json`'s project map.
 * `repoSlug` is bound when ClaudeService can match `repoPath` to a
 * catalog repo (same realpath trick as ProcessService); null otherwise.
 */
export const ClaudeProjectSchema = z.object({
  hash: z.string().min(1),
  repoPath: z.string().min(1),
  repoSlug: z.string().nullable(),
  sessionCount: z.number().int().nonnegative(),
  lastActivityAt: z.string().nullable(),
  totalTokens: z.number().int().nonnegative(),
});
export type ClaudeProjectZ = z.infer<typeof ClaudeProjectSchema>;

/**
 * Per-repo skill — `.claude/skills/<name>/SKILL.md`. Frontmatter is
 * extracted via gray-matter; `name` and `description` are pulled from
 * frontmatter when present, falling back to the directory name +
 * empty string.
 */
export const ClaudeSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  /** Absolute path to the SKILL.md file. */
  path: z.string().min(1),
  /** Whole frontmatter blob — opaque to main; renderer renders selected keys. */
  frontmatter: z.record(z.string(), z.unknown()),
});
export type ClaudeSkillZ = z.infer<typeof ClaudeSkillSchema>;

/** Per-repo agent — `.claude/agents/<slug>.md`. Same shape as skill. */
export const ClaudeAgentSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  path: z.string().min(1),
  frontmatter: z.record(z.string(), z.unknown()),
});
export type ClaudeAgentZ = z.infer<typeof ClaudeAgentSchema>;

/**
 * MCP server entry from `.mcp.json` (per-repo) or
 * `~/.claude/settings.json` `mcpServers` (global). `status` is
 * informational — "running" maps to ProcessService matching a PID
 * to the server's command, "configured" means the file says so but
 * we have no live-process evidence.
 */
export const ClaudeMcpServerSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["stdio", "sse", "http", "unknown"]),
  command: z.string().nullable(),
  args: z.array(z.string()).nullable(),
  configuredIn: z.enum(["project", "global"]),
  status: z.enum(["configured", "running", "unavailable"]),
});
export type ClaudeMcpServerZ = z.infer<typeof ClaudeMcpServerSchema>;

/**
 * Full Claude state for a repo. `hasClaude=false` when no
 * `.claude/` directory exists AND `~/.claude.json` has no entry
 * for the repo path (renderer renders an empty-state CTA).
 */
export const ClaudeRepoStateSchema = z.object({
  hasClaude: z.boolean(),
  claudeMdPath: z.string().nullable(),
  claudeMdContent: z.string().nullable(),
  settingsPath: z.string().nullable(),
  /** ms since epoch — used to invalidate the cache in the renderer. */
  generatedAt: z.number().int().nonnegative(),
  skills: z.array(ClaudeSkillSchema),
  agents: z.array(ClaudeAgentSchema),
  mcpServers: z.array(ClaudeMcpServerSchema),
  sessions: z.array(ClaudeSessionSchema),
  totalTokens: z.number().int().nonnegative(),
});
export type ClaudeRepoStateZ = z.infer<typeof ClaudeRepoStateSchema>;

// Inputs / outputs ----------------------------------------------------------

export const ClaudeIndexInputSchema = z.object({}).strict();
export const ClaudeIndexResultSchema = z.object({
  projectCount: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

export const ClaudeProjectsInputSchema = z.object({}).strict();
export const ClaudeProjectsResultSchema = z.object({
  projects: z.array(ClaudeProjectSchema),
});

export const ClaudeRepoStateInputSchema = z
  .object({ slug: z.string().min(1) })
  .strict();
export const ClaudeRepoStateResultSchema = ClaudeRepoStateSchema;

export const ClaudeSessionTranscriptInputSchema = z
  .object({
    sessionId: z.string().min(1),
    /** Byte offset cursor for pagination. 0 = start. */
    cursor: z.number().int().nonnegative().default(0),
    /** Max bytes to read in this chunk. Server caps at 256 KB. */
    maxBytes: z.number().int().min(1024).max(262_144).optional(),
  })
  .strict();
export const TranscriptEventSchema = z
  .object({
    type: z.string(),
    timestamp: z.string().optional(),
    uuid: z.string().optional(),
  })
  .passthrough();
export const ClaudeSessionTranscriptResultSchema = z.object({
  events: z.array(TranscriptEventSchema),
  nextCursor: z.number().int().nonnegative().nullable(),
  hasMore: z.boolean(),
});

export const ClaudeGlobalUsageInputSchema = z
  .object({
    /** Inclusive ISO-8601 date (YYYY-MM-DD). Omit for "all time". */
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .strict();
export const ClaudeGlobalUsageResultSchema = z.object({
  totalTokens: z.number().int().nonnegative(),
  byProject: z.array(
    z.object({
      hash: z.string().min(1),
      repoPath: z.string().min(1),
      repoSlug: z.string().nullable(),
      totalTokens: z.number().int().nonnegative(),
      /**
       * ATR-020 — this project's OWN weekly token series, bucketed with
       * the same ISO-Monday logic + zero-fill as the global `byWeek`.
       * Optional so older `globalUsage` payloads (pre-ATR-020) still
       * validate; the renderer falls back to a flat sparkline when absent.
       */
      byWeek: z
        .array(
          z.object({
            weekStart: z.string(),
            totalTokens: z.number().int().nonnegative(),
          }),
        )
        .optional(),
    }),
  ),
  byDay: z.array(
    z.object({
      date: z.string(),
      totalTokens: z.number().int().nonnegative(),
    }),
  ),
  byWeek: z.array(
    z.object({
      weekStart: z.string(),
      totalTokens: z.number().int().nonnegative(),
    }),
  ),
  byMonth: z.array(
    z.object({
      monthStart: z.string(),
      totalTokens: z.number().int().nonnegative(),
    }),
  ),
});

export const ClaudeLaunchInputSchema = z
  .object({
    slug: z.string().min(1),
    /**
     * Resume a specific session via `claude --resume <sessionId>`.
     * UUID-validated: the value is interpolated UNQUOTED into the launch
     * command string (`buildLaunchCommand`), so constraining it to a UUID
     * closes a shell-injection vector while matching Claude Code's real
     * session-id format (e.g. `f9a3248a-…`). See ATR-026.
     */
    resumeSessionId: z.string().uuid().optional(),
    /** Trusted starter prompt injected as a one-shot CLI arg. */
    starterPrompt: z.string().optional(),
  })
  .strict();
export const ClaudeLaunchResultSchema = LauncherResultSchema;

export const ClaudeOpenClaudeMdInputSchema = z
  .object({ slug: z.string().min(1) })
  .strict();
export const ClaudeOpenClaudeMdResultSchema = LauncherResultSchema;

/** Push event payload — `{ projectHash }` of the project whose state changed. */
export const ClaudeUpdateEventSchema = z.object({
  projectHash: z.string().min(1),
  reason: z.enum(["session-added", "session-updated", "session-removed"]),
});

export type ClaudeIndexResultZ = z.infer<typeof ClaudeIndexResultSchema>;
export type ClaudeProjectsResultZ = z.infer<typeof ClaudeProjectsResultSchema>;
export type ClaudeRepoStateInputZ = z.infer<typeof ClaudeRepoStateInputSchema>;
export type ClaudeSessionTranscriptInputZ = z.infer<
  typeof ClaudeSessionTranscriptInputSchema
>;
export type ClaudeSessionTranscriptResultZ = z.infer<
  typeof ClaudeSessionTranscriptResultSchema
>;
export type ClaudeGlobalUsageInputZ = z.infer<
  typeof ClaudeGlobalUsageInputSchema
>;
export type ClaudeGlobalUsageResultZ = z.infer<
  typeof ClaudeGlobalUsageResultSchema
>;
export type ClaudeLaunchInputZ = z.infer<typeof ClaudeLaunchInputSchema>;
export type ClaudeOpenClaudeMdInputZ = z.infer<
  typeof ClaudeOpenClaudeMdInputSchema
>;
export type ClaudeUpdateEventZ = z.infer<typeof ClaudeUpdateEventSchema>;
export type TranscriptEventZ = z.infer<typeof TranscriptEventSchema>;
