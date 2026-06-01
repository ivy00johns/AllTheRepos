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

export const EditorIdSchema = z.enum([
  "vscode",
  "cursor",
  "zed",
  "windsurf",
  "sublime",
  "xcode",
  "idea",
  "webstorm",
  "pycharm",
  "rider",
  "goland",
  "clion",
  "rubymine",
]);
export type EditorIdZ = z.infer<typeof EditorIdSchema>;

export const TerminalIdSchema = z.enum([
  "terminal",
  "iterm2",
  "warp",
  "ghostty",
  "alacritty",
  "kitty",
  "hyper",
]);
export type TerminalIdZ = z.infer<typeof TerminalIdSchema>;

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
