# API Contract — v1 (frozen)

All endpoints return `ApiResult<T>` envelopes. Errors follow `ApiError`. Server actions use the same envelope (`ActionResult<T>`).

## Route Handlers

### `POST /api/scan`

Trigger a scan. Streams NDJSON of `ScanProgressEvent`.

**Request body** (JSON):
```ts
{ paths?: string[] }  // optional override; default = settings.scanPaths
```

**Response**: `content-type: application/x-ndjson`. One JSON object per line conforming to `ScanProgressEvent`.

Terminal event is always `{kind: "completed", ...}` or a `{kind: "error"}` followed by connection close.

### `POST /api/search`

Hybrid FTS + vector search.

**Request body**: `SearchQuery`
**Response**: `ApiOk<SearchHit[]>`

Scoring: FTS rank normalized + vector cosine similarity; merged top-N.

### `GET /api/repos`

Paginated list with filters.

**Query params**: conform to `RepoListQuery` (flatten arrays via `?tags=a&tags=b`)
**Response**: `ApiOk<RepoListResult>`

### `GET /api/repos/[slug]`

Single repo detail.

**Response**: `ApiOk<RepoDetail>` or `ApiError{code:"NOT_FOUND"}`.

### `GET /api/groups`

**Response**: `ApiOk<Group[]>` — always sorted by `sortOrder, name`.

### `GET /api/settings`

**Response**: `ApiOk<Settings>`.

## Server Actions (`app/actions/`)

All exported `async` functions. Must be imported with `"use server"` directive at top of file.

```ts
// app/actions/repos.ts
export async function rescanRepo(slug: string): Promise<ActionResult<Repo>>
export async function setRepoTags(slug: string, tags: string[]): Promise<ActionResult<Repo>>
export async function openInEditor(slug: string): Promise<ActionResult<{ opened: boolean }>>

// app/actions/groups.ts
export async function createGroup(
  input: { name: string; description?: string; isSmart?: boolean; smartFilter?: SmartFilter | null; parentGroupId?: number | null }
): Promise<ActionResult<Group>>
export async function updateGroup(id: number, patch: Partial<Group>): Promise<ActionResult<Group>>
export async function deleteGroup(id: number): Promise<ActionResult<{ deleted: true }>>
export async function addRepoToGroup(slug: string, groupId: number): Promise<ActionResult<{ added: true }>>
export async function removeRepoFromGroup(slug: string, groupId: number): Promise<ActionResult<{ removed: true }>>

// app/actions/settings.ts
export async function saveSettings(patch: Partial<Settings>): Promise<ActionResult<Settings>>
export async function addScanPath(path: string): Promise<ActionResult<Settings>>
export async function removeScanPath(path: string): Promise<ActionResult<Settings>>
```

## Backend library surface (for server components)

```ts
// lib/db/queries.ts
export function listRepos(query: RepoListQuery): Promise<RepoListResult>
export function getRepoBySlug(slug: string): Promise<RepoDetail | null>
export function listGroups(): Promise<Group[]>
export function getSettings(): Promise<Settings>

// lib/git/scanner.ts
export function scanPaths(paths: string[]): AsyncIterable<ScanProgressEvent>

// lib/search/query.ts
export function hybridSearch(q: SearchQuery): Promise<SearchHit[]>
```

The Electron app keeps this entry point in `src/main/services/search.ts`, where
it also takes the search `mode` (`"fts"`, `"vector"` or `"hybrid"`) and returns
`{ hits, semantic }` rather than a bare array — `semantic` reports whether the
vector store took part, and why not when it did not. See
`contracts/ipc.v1.md > catalog:search`.

## Error Codes

| Code | Meaning |
|---|---|
| `NOT_FOUND` | Resource missing |
| `BAD_REQUEST` | Request validation failed |
| `SCAN_FAILED` | Filesystem scan error (permission, missing path) |
| `EMBED_UNAVAILABLE` | Ollama + OpenAI both unavailable — non-fatal; FTS fallback still works |
| `DB_ERROR` | SQLite failure |
| `VALIDATION` | Zod schema mismatch on server action input |
| `INTERNAL` | Unexpected — caller should retry once then surface to user |

## HTTP Status Map

- `200` — `ok: true` responses
- `400` — `BAD_REQUEST`, `VALIDATION`
- `404` — `NOT_FOUND`
- `500` — `DB_ERROR`, `INTERNAL`, `SCAN_FAILED`, `EMBED_UNAVAILABLE`
