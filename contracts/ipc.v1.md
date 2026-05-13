# IPC Contract v1 — Phase 0 + Phase 1 (frozen)

This document is the authoritative registry of IPC channels exposed by
the Electron main process to the renderer via the preload `contextBridge`.
Phase 0 channels are **stable v1**. Phase 1 channels are added below and
are also **frozen at v1**. Any further additions get a new version
document (`ipc.v2.md`). Both phase sections in this file are normative
for Phase 1 implementers.

Consumers (main, preload, renderer, qe-agent) MUST import channel names
from `src/shared/ipc.ts` and schemas from `src/shared/schemas.ts`. Do
not hard-code channel strings.

## Conventions

- **Namespace pattern:** `<namespace>:<verb>` (e.g. `system:ping`,
  `catalog:list`). Push-style streams use `<namespace>:on:<event>`
  (e.g. `scan:on:progress` in Phase 1). Phase 0 has no streams.
- **Validation:** every `ipcMain.handle` MUST call `.parse()` on the
  incoming payload using the corresponding `*InputSchema` before doing
  any work. Output is typed via the matching `*ResponseSchema`.
- **Preload surface:** all channels are reached from the renderer via
  `window.atr.<namespace>.<verb>(input)`. The bridge key (`atr`) is
  exported as `PRELOAD_BRIDGE_KEY` from `src/shared/ipc.ts`.
- **Security:** every handler must validate `event.senderFrame.url`
  against the renderer origin (see NEW-PLAN.md §3.4). This is a main
  process concern and not encoded in this contract.

## Reserved namespaces

| Namespace   | Phase | Notes                                                  |
| ----------- | ----- | ------------------------------------------------------ |
| `system`    | 0     | Health, ping, app lifecycle, version info.             |
| `catalog`   | 1     | Repo list / detail / search / tags / smart filter.     |
| `scan`      | 1     | Scanner job lifecycle + `scan:on:progress` stream.     |
| `git`       | 1     | Per-repo git status / branches / open-in-editor.       |
| `settings`  | 1     | User preferences read/write (electron-store backed).   |
| `groups`    | 1     | Group CRUD + repo membership.                          |
| `launcher`  | 2     | "Open in VSCode / Cursor / Finder / Term".             |
| `process`   | 3     | Port / running-server detection.                       |
| `claude`    | 3     | Claude Code projects + MCP scan.                       |

The `system`, `catalog`, `scan`, `git`, `settings`, and `groups`
namespaces are implemented in Phase 1. The remaining rows are listed so
later agents know which prefixes are pre-allocated.

## Phase 0 channels

### `system:ping`

Round-trip smoke test. Validates that preload exposed the bridge, that
the main-process handler is registered, and that Zod parsing is wired.

- **Constant:** `IPC.SYSTEM.PING` (`src/shared/ipc.ts`)
- **Input schema:** `PingInputSchema` (`src/shared/schemas.ts`)
- **Output schema:** `PingResponseSchema` (`src/shared/schemas.ts`)
- **Renderer call:** `window.atr.system.ping(input?)`

**Input shape**

```ts
{ nonce?: string }
```

**Output shape**

```ts
{
  ok: true;
  pong: "pong";
  mainProcessPid: number;       // process.pid in the main process
  receivedAt: string;           // ISO-8601 timestamp at handler entry
}
```

Handlers MUST set `receivedAt` from `new Date().toISOString()` at the
top of the handler and `mainProcessPid` from `process.pid`. The `nonce`
field is accepted but intentionally ignored by Phase 0 — it exists so
the renderer can keep ping calls cache-busted during dev.

## Required deps

- `zod` — already on the dependency tree at `^3.25.67`. No new deps
  are required for Phase 0. The infra agent does not need to install
  anything to satisfy this contract.

## File map

| File                       | Owner             | Purpose                                  |
| -------------------------- | ----------------- | ---------------------------------------- |
| `src/shared/types.ts`      | contract-author   | Re-exports + Phase 0 type additions.     |
| `src/shared/schemas.ts`    | contract-author   | Zod schemas for entities + IPC payloads. |
| `src/shared/ipc.ts`        | contract-author   | Channel name constants (`as const`).     |
| `contracts/ipc.v1.md`      | contract-author   | This document.                           |
| `src/main/ipc/system.ts`   | backend / infra   | `ipcMain.handle(IPC.SYSTEM.PING, ...)`.  |
| `src/preload/api.ts`       | backend / infra   | `window.atr.system.ping` wrapper.        |

The right-hand `src/main/...` and `src/preload/...` files are NOT part
of Phase 0's contract-author deliverable — they are the consumers of
this contract authored in Wave 2.

---

## Phase 1 channels (frozen)

All Phase 1 channels live behind the bridge key `atr`. Renderer call
sites use `window.atr.<namespace>.<verb>(input)`. Every handler MUST
`.parse()` the input through the named schema before doing work and
SHOULD `.parse()` the response in dev mode.

The streaming `scan:on:progress` channel is the only push-style event in
Phase 1. Main pushes via `webContents.send(IPC.SCAN.ON_PROGRESS, event)`;
the renderer subscribes via `ipcRenderer.on` (proxied through the
preload as `window.atr.scan.onProgress(cb)`).

### Catalog namespace

#### `catalog:list`

Paginated repo list with filters. Maps 1:1 to the legacy
`GET /api/repos` + `lib/db/queries.ts > listRepos()`.

- **Constant:** `IPC.CATALOG.LIST`
- **Input schema:** `ListReposInputSchema`
- **Output schema:** `ListReposResultSchema`
- **Renderer call:** `window.atr.catalog.list(input)`
- **Idempotency:** pure read, safe to retry.
- **Notes:** when `smart: true` is passed alongside `q`, the handler
  delegates to `catalog:smartFilter` semantics internally (Phase 4) —
  for Phase 1, treat `smart` as a no-op and fall back to regular
  filtered list.

#### `catalog:get`

Single repo detail by slug.

- **Constant:** `IPC.CATALOG.GET`
- **Input schema:** `GetRepoInputSchema`
- **Output schema:** `GetRepoResultSchema` (`RepoDetail | null`)
- **Renderer call:** `window.atr.catalog.get({ slug })`
- **Idempotency:** pure read.
- **Notes:** `null` ⇒ caller should surface NOT_FOUND. Side-effect: the
  handler updates `last_opened_at` ONLY when the renderer subsequently
  calls `git:openInEditor`; the `catalog:get` call itself does NOT
  touch the row.

#### `catalog:search`

Hybrid FTS5 + LanceDB vector search. Maps 1:1 to the legacy
`POST /api/search` + `lib/search/query.ts > hybridSearch()`.

- **Constant:** `IPC.CATALOG.SEARCH`
- **Input schema:** `SearchReposInputSchema`
- **Output schema:** `SearchReposResultSchema` (`SearchHit[]`)
- **Renderer call:** `window.atr.catalog.search(input)`
- **Idempotency:** pure read.
- **Notes:** `mode` defaults to `"hybrid"`. When the embedding service
  is unavailable, the handler falls back to FTS-only and still returns
  a valid `SearchHit[]` (with `matchKind: "fts"`).

#### `catalog:rescan`

Refresh metadata for a single repo. Maps 1:1 to the legacy
`rescanRepo(slug)` Server Action.

- **Constant:** `IPC.CATALOG.RESCAN`
- **Input schema:** `RescanRepoInputSchema`
- **Output schema:** `RescanRepoResultSchema` (`Repo`)
- **Renderer call:** `window.atr.catalog.rescan({ slug })`
- **Idempotency:** safe to re-issue. Each call re-reads metadata; the
  underlying upsert preserves slug, user tags, and group memberships.
- **Notes:** does NOT emit `scan:on:progress` events; that stream is
  for full-tree scans only.

#### `catalog:setTags`

Overwrite user tags (heuristic tags preserved). Maps 1:1 to
`setRepoTags(slug, tags)`.

- **Constant:** `IPC.CATALOG.SET_TAGS`
- **Input schema:** `SetRepoTagsInputSchema`
- **Output schema:** `SetRepoTagsResultSchema` (`Repo`)
- **Renderer call:** `window.atr.catalog.setTags({ slug, tags })`
- **Idempotency:** last-write-wins; safe to retry.
- **Notes:** server caps the merged tag set at 12 entries.

#### `catalog:smartFilter`

LLM-tagged smart filter — **Phase 4 feature, contract locked in
Phase 1**. The handler MUST exist in Phase 1; it MAY return an empty
array until the LLM-tagging job is implemented in Phase 4.

- **Constant:** `IPC.CATALOG.SMART_FILTER`
- **Input schema:** `SmartFilterInputSchema`
- **Output schema:** `SmartFilterResultSchema` (`SearchHit[]`)
- **Renderer call:** `window.atr.catalog.smartFilter({ prompt, limit? })`
- **Idempotency:** pure read.
- **Notes:** Phase 1 implementers SHOULD register a stub handler that
  returns `[]` so the renderer can wire the UI affordance without
  conditional channel checks.

### Scan namespace

#### `scan:start`

Start a new repo scan. Maps to the legacy `POST /api/scan` route.

- **Constant:** `IPC.SCAN.START`
- **Input schema:** `StartScanInputSchema`
- **Output schema:** `StartScanResultSchema` (`{ jobId, status, startedAt }`)
- **Renderer call:** `window.atr.scan.start({ paths? })`
- **Idempotency:** **NOT idempotent.** Each call spawns a new scan job.
  Implementers SHOULD reject overlapping scans with a 409-shaped error
  (or queue them via the JobQueue service — TBD by backend-services).
- **Related stream:** `scan:on:progress` events are emitted while the
  job runs.

#### `scan:status`

Poll status for an in-flight or recently completed scan.

- **Constant:** `IPC.SCAN.STATUS`
- **Input schema:** `ScanStatusInputSchema`
- **Output schema:** `ScanStatusResultSchema`
- **Renderer call:** `window.atr.scan.status({ jobId })`
- **Idempotency:** pure read.
- **Notes:** `status: "unknown"` is returned for jobIds the service no
  longer has metadata for (e.g. after app restart). The renderer should
  treat that as terminal.

#### `scan:cancel`

Cooperative cancel by jobId.

- **Constant:** `IPC.SCAN.CANCEL`
- **Input schema:** `CancelScanInputSchema`
- **Output schema:** `CancelScanResultSchema`
- **Renderer call:** `window.atr.scan.cancel({ jobId })`
- **Idempotency:** safe to re-issue. Returns `cancelled: false` if the
  job already ended.

#### `scan:on:progress` (event stream — main → renderer)

Push-style event stream emitted by the main process during a running
scan job. The renderer subscribes once at app start.

- **Constant:** `IPC.SCAN.ON_PROGRESS`
- **Payload schema:** `ScanEventSchema` (`progress | repo | done | error`)
- **Preload wrapper:** `window.atr.scan.onProgress(cb): () => void`
  (returns an unsubscribe function).
- **Notes:** events MUST be tagged with the originating `jobId` if the
  service ever supports concurrent scans. For Phase 1 there is exactly
  one job at a time so the payload omits `jobId` — implementers MAY
  add it later in a backwards-compatible way.

### Git namespace

#### `git:status`

Return dirty state + ahead/behind for one repo. Used by repo cards
and the detail page header.

- **Constant:** `IPC.GIT.STATUS`
- **Input schema:** `GitStatusInputSchema`
- **Output schema:** `GitStatusSchema`
- **Renderer call:** `window.atr.git.status({ slug })`
- **Idempotency:** pure read. Heavyweight (`git status --porcelain` +
  `rev-list --count`) — debounce on the renderer side.

#### `git:branches`

List local branches for one repo.

- **Constant:** `IPC.GIT.BRANCHES`
- **Input schema:** `GitBranchesInputSchema`
- **Output schema:** `GitBranchesResultSchema` (`GitBranch[]`)
- **Renderer call:** `window.atr.git.branches({ slug })`
- **Idempotency:** pure read.

#### `git:openInEditor`

Launch the configured editor pointed at the repo path. Maps to the
legacy `openInEditor(slug)` Server Action.

- **Constant:** `IPC.GIT.OPEN_IN_EDITOR`
- **Input schema:** `OpenInEditorInputSchema`
- **Output schema:** `OpenInEditorResultSchema`
- **Renderer call:** `window.atr.git.openInEditor({ slug, editor? })`
- **Idempotency:** safe to re-issue (each call attempts a fresh launch).
- **Notes:** the handler MUST validate the resolved URI against the
  `shell.openExternal` allowlist from NEW-PLAN.md §3.4. On success the
  handler updates `repos.last_opened_at = now()`. **Phase 2 will
  expand this** with editor detection, fallback CLI, etc. — Phase 1
  needs only `vscode://file/<path>` / `cursor://file/<path>` URI
  dispatch with a graceful `opened: false` when no editor is
  configured.

### Settings namespace

#### `settings:get`

Read the full Settings blob. **Backed by electron-store**, not SQLite.

- **Constant:** `IPC.SETTINGS.GET`
- **Input schema:** `GetSettingsInputSchema` (`z.object({}).strict()`)
- **Output schema:** `GetSettingsResultSchema` (`Settings`)
- **Renderer call:** `window.atr.settings.get()`
- **Idempotency:** pure read.
- **Notes:** the store file lives at `app.getPath('userData')/settings.json`
  (see `contracts/data-layer.v1.md`). On first run the handler MUST
  seed the file with the defaults from `lib/types.ts > Settings`.

#### `settings:update`

Partial update — only provided keys are applied. Maps to the legacy
`saveSettings(patch)` Server Action.

- **Constant:** `IPC.SETTINGS.UPDATE`
- **Input schema:** `UpdateSettingsInputSchema` (`Settings.partial()`)
- **Output schema:** `UpdateSettingsResultSchema` (`Settings`)
- **Renderer call:** `window.atr.settings.update(patch)`
- **Idempotency:** last-write-wins.
- **Notes:** when `scanPaths` is in the patch, the entire array is
  replaced (no per-element diff). The legacy `addScanPath` /
  `removeScanPath` Server Actions are subsumed by this channel — the
  renderer is expected to compute the new array client-side.

### Groups namespace

#### `groups:list`

List all groups, sorted by `(sortOrder, name)`. Maps to
`GET /api/groups`.

- **Constant:** `IPC.GROUPS.LIST`
- **Input schema:** `ListGroupsInputSchema` (`z.object({}).strict()`)
- **Output schema:** `ListGroupsResultSchema` (`Group[]`)
- **Renderer call:** `window.atr.groups.list()`
- **Idempotency:** pure read.

#### `groups:create`

Create a new group.

- **Constant:** `IPC.GROUPS.CREATE`
- **Input schema:** `CreateGroupInputSchema`
- **Output schema:** `CreateGroupResultSchema` (`Group`)
- **Renderer call:** `window.atr.groups.create(input)`
- **Idempotency:** **NOT idempotent** — re-invoking inserts a duplicate
  row. The renderer SHOULD disable the submit button while the request
  is in flight.

#### `groups:rename`

Rename a group (name-only patch). The legacy `updateGroup(id, patch)`
covered every field; in Phase 1 we narrow to rename because that's the
only UI affordance shipped — other patches go through future channels
when needed.

- **Constant:** `IPC.GROUPS.RENAME`
- **Input schema:** `RenameGroupInputSchema`
- **Output schema:** `RenameGroupResultSchema` (`Group`)
- **Renderer call:** `window.atr.groups.rename({ id, name })`
- **Idempotency:** last-write-wins.

#### `groups:delete`

Delete a group. Repo memberships cascade via the FK on `repo_groups`.

- **Constant:** `IPC.GROUPS.DELETE`
- **Input schema:** `DeleteGroupInputSchema`
- **Output schema:** `DeleteGroupResultSchema`
- **Renderer call:** `window.atr.groups.delete({ id })`
- **Idempotency:** safe to retry — deleting an already-deleted id
  still returns `{ deleted: true, id }`.

#### `groups:setMembers`

Replace the entire member set for a group. The legacy
`addRepoToGroup` / `removeRepoFromGroup` Server Actions are subsumed
by this channel — the renderer computes the new slug array client-side
and sends the full set.

- **Constant:** `IPC.GROUPS.SET_MEMBERS`
- **Input schema:** `SetGroupMembersInputSchema`
- **Output schema:** `SetGroupMembersResultSchema`
- **Renderer call:** `window.atr.groups.setMembers({ groupId, slugs })`
- **Idempotency:** last-write-wins.

## Channel ↔ schema ↔ constant cross-reference

| Channel string             | IPC constant                   | Input schema                    | Output schema                    |
| -------------------------- | ------------------------------ | ------------------------------- | -------------------------------- |
| `system:ping`              | `IPC.SYSTEM.PING`              | `PingInputSchema`               | `PingResponseSchema`             |
| `catalog:list`             | `IPC.CATALOG.LIST`             | `ListReposInputSchema`          | `ListReposResultSchema`          |
| `catalog:get`              | `IPC.CATALOG.GET`              | `GetRepoInputSchema`            | `GetRepoResultSchema`            |
| `catalog:search`           | `IPC.CATALOG.SEARCH`           | `SearchReposInputSchema`        | `SearchReposResultSchema`        |
| `catalog:rescan`           | `IPC.CATALOG.RESCAN`           | `RescanRepoInputSchema`         | `RescanRepoResultSchema`         |
| `catalog:setTags`          | `IPC.CATALOG.SET_TAGS`         | `SetRepoTagsInputSchema`        | `SetRepoTagsResultSchema`        |
| `catalog:smartFilter`      | `IPC.CATALOG.SMART_FILTER`     | `SmartFilterInputSchema`        | `SmartFilterResultSchema`        |
| `scan:start`               | `IPC.SCAN.START`               | `StartScanInputSchema`          | `StartScanResultSchema`          |
| `scan:status`              | `IPC.SCAN.STATUS`              | `ScanStatusInputSchema`         | `ScanStatusResultSchema`         |
| `scan:cancel`              | `IPC.SCAN.CANCEL`              | `CancelScanInputSchema`         | `CancelScanResultSchema`         |
| `scan:on:progress` (event) | `IPC.SCAN.ON_PROGRESS`         | — (push-only)                   | `ScanEventSchema`                |
| `git:status`               | `IPC.GIT.STATUS`               | `GitStatusInputSchema`          | `GitStatusSchema`                |
| `git:branches`             | `IPC.GIT.BRANCHES`             | `GitBranchesInputSchema`        | `GitBranchesResultSchema`        |
| `git:openInEditor`         | `IPC.GIT.OPEN_IN_EDITOR`       | `OpenInEditorInputSchema`       | `OpenInEditorResultSchema`       |
| `settings:get`             | `IPC.SETTINGS.GET`             | `GetSettingsInputSchema`        | `GetSettingsResultSchema`        |
| `settings:update`          | `IPC.SETTINGS.UPDATE`          | `UpdateSettingsInputSchema`     | `UpdateSettingsResultSchema`     |
| `groups:list`              | `IPC.GROUPS.LIST`              | `ListGroupsInputSchema`         | `ListGroupsResultSchema`         |
| `groups:create`            | `IPC.GROUPS.CREATE`            | `CreateGroupInputSchema`        | `CreateGroupResultSchema`        |
| `groups:rename`            | `IPC.GROUPS.RENAME`            | `RenameGroupInputSchema`        | `RenameGroupResultSchema`        |
| `groups:delete`            | `IPC.GROUPS.DELETE`            | `DeleteGroupInputSchema`        | `DeleteGroupResultSchema`        |
| `groups:setMembers`        | `IPC.GROUPS.SET_MEMBERS`       | `SetGroupMembersInputSchema`    | `SetGroupMembersResultSchema`    |

## Error envelope

IPC handlers MAY throw — `ipcMain.handle` rejects the renderer promise
with an `Error`. To preserve the legacy `ApiResult<T>` semantics where
useful, the preload wrapper SHOULD catch and translate thrown errors
into the same `ApiError` shape used by the Next.js routes (see
`contracts/types.ts > ApiError`). Phase 1 implementers may choose to
return raw values and let the renderer use TanStack Query's
`error`/`data` split — both styles are acceptable as long as the
channel's success-path schema is honored.

## Required deps (Phase 1)

- `zod` (already on the tree). No new shared deps.
- Main process will add `electron-store` for the `settings:*` namespace;
  that's a backend-services concern, not a contract concern.
