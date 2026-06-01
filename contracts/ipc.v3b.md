# IPC Contract v3b — Phase 3b (Claude Code integration)

Extends `ipc.v1.md` (Phase 0+1+2) and `ipc.v3.md` (Phase 3a) with the
read-only Claude state namespace from `NEW-PLAN.md §5.4`.

The v1 conventions apply unchanged: frame-origin check on every
handler, Zod-validated input + output, `IPC.<NAMESPACE>.<ACTION>`
constants, no inline channel strings. ClaudeService is read-only;
launch + open-CLAUDE.md actions delegate to LauncherService.

## File map (Phase 3b additions)

| Concern              | File                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Channel constants    | `src/shared/ipc.ts` (`IPC.CLAUDE`)                                                                               |
| Zod schemas          | `src/shared/schemas.ts` (Phase 3b section)                                                                       |
| Shared types         | `src/shared/types.ts` (Phase 3b section)                                                                         |
| Main: claude service | `src/main/services/claude.ts`                                                                                    |
| Main: claude helpers | `src/main/claude/*.ts` (parsers, watcher, hash mapper)                                                           |
| Main: claude IPC     | `src/main/ipc/claude.ts`                                                                                         |
| Preload: bridge      | `src/preload/api.ts` (`claude` namespace)                                                                        |
| Renderer hooks       | `src/renderer/hooks/use-claude.ts`                                                                               |
| Renderer UI          | `src/renderer/components/claude/*`                                                                               |
| Renderer route       | `src/renderer/routes/claude.tsx` (global usage view)                                                             |
| Renderer detail      | `src/renderer/components/catalog/repo-detail-content.tsx` (Claude tab)                                           |
| Tests                | `tests/unit/main/services/claude.spec.ts`, `tests/unit/main/ipc/claude.spec.ts`, `tests/e2e/claude-flow.spec.ts` |

## Claude namespace

### `claude:index`

- **Direction:** invoke
- **Input:** `ClaudeIndexInputSchema` (empty)
- **Output:** `ClaudeIndexResultSchema` — `{ projectCount, sessionCount, totalTokens, durationMs }`
- **Behavior:** force a full re-walk of `~/.claude.json` + every
  project's `~/.claude/projects/<hash>/`. Idempotent. Renderer calls
  this from the settings page (manual "rescan Claude state").

### `claude:projects`

- **Input:** empty
- **Output:** `ClaudeProjectsResultSchema` — `{ projects: ClaudeProject[] }`
- **Behavior:** returns the in-memory project index. Cheap — no I/O
  on the happy path. Repeated calls during `INDEX` will see a stale
  view; renderer should listen to `claude:on:update` to invalidate.

### `claude:repoState`

- **Input:** `ClaudeRepoStateInputSchema` — `{ slug }`
- **Output:** `ClaudeRepoStateResultSchema`
- **Behavior:** loads the full state for one repo. Resolves the repo
  path via the existing `repoPathBySlug` helper, then:
  1. Checks `<repoPath>/.claude/` exists — sets `hasClaude`.
  2. Reads `<repoPath>/CLAUDE.md` if present (else null).
  3. Globs `<repoPath>/.claude/skills/**/SKILL.md`, parses frontmatter
     via gray-matter, extracts `name` + `description`.
  4. Globs `<repoPath>/.claude/agents/*.md`, same frontmatter pass.
  5. Reads `<repoPath>/.mcp.json` (per-project MCP) and
     `~/.claude/settings.json` (global MCP); merges into the
     `mcpServers` list with `configuredIn` source tag.
  6. Looks up the project hash by reverse-mapping `repoPath`, then
     attaches the cached session list for that hash.
- **Performance:** cached per slug with a 30s TTL. Cache invalidated
  when chokidar fires for the matching project hash.

### `claude:sessionTranscript`

- **Input:** `ClaudeSessionTranscriptInputSchema` — `{ sessionId, cursor?, maxBytes? }`
- **Output:** `ClaudeSessionTranscriptResultSchema` — `{ events, nextCursor, hasMore }`
- **Behavior:** lazy-load a chunk of one session's transcript.
  - Resolve sessionId to its JSONL file path via the index.
  - Open with a streaming read at byte offset `cursor`.
  - Read up to `maxBytes` (default 64 KB, capped server-side at
    256 KB), then continue to the end of the current line so events
    are never split mid-JSON.
  - Parse each line via `JSON.parse` inside a try/catch — silently
    skip malformed lines (Claude Code's format is not a stable
    public schema, per the plan).
  - Return `events` (validated against `TranscriptEventSchema` —
    `.passthrough()` so unknown keys survive), `nextCursor` (the
    next byte offset to read from, or null at EOF), `hasMore`
    (`nextCursor !== null`).

### `claude:globalUsage`

- **Input:** `ClaudeGlobalUsageInputSchema` — `{ from?, to? }` (ISO-8601 date strings)
- **Output:** `ClaudeGlobalUsageResultSchema`
- **Behavior:** sums every session's tokenUsage, optionally filtered
  by `lastActivityAt ∈ [from, to]`. Returns:
  - `totalTokens` — overall sum
  - `byProject` — array of `{ hash, repoPath, repoSlug, totalTokens }`, sorted desc
  - `byDay` — array of `{ date, totalTokens }`, contiguous days within the range (zero-filled)
  - `byWeek`, `byMonth` — same pattern at weekly / monthly granularity
- **Performance:** computed lazily from the cached session list.
  Re-computed on `claude:on:update` invalidating the in-memory cache.

### `claude:launch`

- **Input:** `ClaudeLaunchInputSchema` — `{ slug, resumeSessionId?, starterPrompt? }`
- **Output:** `ClaudeLaunchResultSchema` (= `LauncherResultSchema`)
- **Behavior:** builds the launch command and delegates to
  `launcherService.openInTerminal({ slug, command })`. Command shape:
  - Base: `claude`
  - With resume: `claude --resume <sessionId>`
  - With starter prompt: append `--prompt <quoted>`
- **Safety:** `starterPrompt` is shell-quoted before injection — `'`
  → `'\''`, wrap in single quotes. `resumeSessionId` is validated as a
  **UUID** (`z.string().uuid()`) in `ClaudeLaunchInputSchema`; since it is
  interpolated unquoted into the `claude --resume <sessionId>` command
  string, the UUID constraint is what prevents shell injection (a UUID
  contains no shell metacharacters). This matches Claude Code's on-disk
  session-id format. (Resolved ATR-023 drift + ATR-026 injection guard.)

### `claude:openClaudeMd`

- **Input:** `ClaudeOpenClaudeMdInputSchema` — `{ slug }`
- **Behavior:** resolves the repo's `CLAUDE.md` path, calls
  `launcherService.openInEditor` with the file path (NOT the repo
  directory — the editor opens at the file). If the editor scheme
  doesn't support file targets, fall back to opening the repo and
  surface a one-line note.

### `claude:on:update` (event stream — main → renderer)

- **Payload:** `ClaudeUpdateEventSchema` — `{ projectHash, reason }`
- **Reasons:** `"session-added"` | `"session-updated"` | `"session-removed"`
- **Cadence:** debounced ~300ms inside ClaudeService to avoid the
  thundering-herd when Claude Code is actively writing to the
  JSONL file.

## Channel ↔ schema ↔ constant cross-reference

| Channel                    | Constant                        | Input schema                         | Output schema                         |
| -------------------------- | ------------------------------- | ------------------------------------ | ------------------------------------- |
| `claude:index`             | `IPC.CLAUDE.INDEX`              | `ClaudeIndexInputSchema`             | `ClaudeIndexResultSchema`             |
| `claude:projects`          | `IPC.CLAUDE.PROJECTS`           | `ClaudeProjectsInputSchema`          | `ClaudeProjectsResultSchema`          |
| `claude:repoState`         | `IPC.CLAUDE.REPO_STATE`         | `ClaudeRepoStateInputSchema`         | `ClaudeRepoStateResultSchema`         |
| `claude:sessionTranscript` | `IPC.CLAUDE.SESSION_TRANSCRIPT` | `ClaudeSessionTranscriptInputSchema` | `ClaudeSessionTranscriptResultSchema` |
| `claude:globalUsage`       | `IPC.CLAUDE.GLOBAL_USAGE`       | `ClaudeGlobalUsageInputSchema`       | `ClaudeGlobalUsageResultSchema`       |
| `claude:launch`            | `IPC.CLAUDE.LAUNCH`             | `ClaudeLaunchInputSchema`            | `ClaudeLaunchResultSchema`            |
| `claude:openClaudeMd`      | `IPC.CLAUDE.OPEN_CLAUDE_MD`     | `ClaudeOpenClaudeMdInputSchema`      | `ClaudeOpenClaudeMdResultSchema`      |
| `claude:on:update`         | `IPC.CLAUDE.ON_UPDATE`          | —                                    | `ClaudeUpdateEventSchema`             |

## Domain rules

- **JSONL parsing is best-effort.** Claude Code's transcript format
  is not a stable public schema. Every line is parsed inside a
  try/catch; malformed lines are silently skipped. Token usage is
  accumulated by walking events where `event.message?.usage` is
  present and shaped like `{ input_tokens, output_tokens, ... }`.
- **Project-hash → repo-path mapping** comes from `~/.claude.json`'s
  `projects` map, where each key IS the repo path and the value
  has a `projectId` (the hash on disk under `~/.claude/projects/`).
  Do NOT try to invert the hash algorithm — read it from the file.
- **Session start/end timestamps** are extracted by reading the
  first and last newline-delimited JSON events in the file:
  - First non-system event's `timestamp` field → `startedAt`.
  - Last non-system event's `timestamp` field → `lastActivityAt`.
  - File mtime is used as a fallback for `lastActivityAt` only.
  - Avoid slurping the whole file — read the first 16 KB and the
    last 16 KB; this covers >99% of sessions and degrades safely.
- **MCP server status** is `"configured"` when the file lists it
  but ProcessService doesn't have a matching live PID. `"running"`
  is reserved for Phase 3b+ once ProcessService can match the MCP
  server's command. `"unavailable"` is the catch-all when parsing
  the entry partially fails.
- **chokidar lifecycle:** one watcher rooted at `~/.claude/projects/`
  with `ignoreInitial: true`, `awaitWriteFinish: { stabilityThreshold: 250 }`.
  On `add` / `change` / `unlink` events for `*.jsonl` files, debounce
  by 300ms then re-parse just the affected session and emit
  `claude:on:update`.
- **No write paths in ClaudeService.** Mutating CLAUDE.md is the
  user's editor's job, not ours. Launching Claude Code is the
  terminal's job, not ours — we just build the command line.

## Definition of done (Phase 3b)

- [ ] `pnpm typecheck` clean (no new errors)
- [ ] `pnpm test` — new unit specs pass for: JSONL parser timestamp
      extraction, token usage aggregation, frontmatter parsing,
      project-hash mapping, transcript pagination cursor math,
      MCP server merger.
- [ ] Renderer Claude tab renders for a repo with a `.claude/`
      directory; falls back to an empty-state CTA when not.
- [ ] Global Claude usage view renders the heatmap + sparklines.
- [ ] `qa-report.json` updated with Phase 3b gate decision; prior
      chain (MVP → P0 → P1 → P2 → P3a → P3b) preserved.

## Out of scope (Phase 3b)

- Smart suggestions / scoring on Claude usage — Phase 4 intelligence.
- LLM auto-tagging using Claude transcripts — Phase 4.
- Per-repo MCP server "start/stop" controls — read-only in 3b.
- Cross-machine Claude project sync — never (per brief).
