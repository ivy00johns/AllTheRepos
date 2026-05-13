# Data Layer Contract v1 — Phase 1 (frozen)

This document specifies the on-disk layout, concurrency model, and
migration path for the AllTheRepos Electron data layer. Phase 1
implementers MUST honor these locations and access rules; renderer code
MUST NOT touch any of them directly — every read/write goes through the
IPC channels in `contracts/ipc.v1.md`.

## Storage locations (macOS)

All paths are computed in the **main process** at boot via
`app.getPath('userData')`. On macOS this resolves to:

```
~/Library/Application Support/AllTheRepos/
```

The exact files / directories the main process manages:

| Purpose                | Path                                                         | Backed by                    |
| ---------------------- | ------------------------------------------------------------ | ---------------------------- |
| SQLite catalog DB      | `app.getPath('userData') + '/alltherepos.db'`                | `better-sqlite3` + Drizzle   |
| LanceDB vector store   | `app.getPath('userData') + '/lance/'`                        | `@lancedb/lancedb`           |
| User settings blob     | `app.getPath('userData') + '/settings.json'`                 | `electron-store`             |
| Migration sentinel     | `app.getPath('userData') + '/MIGRATED'`                      | plain file (touch on copy)   |

Resolved on a typical machine:

- SQLite: `~/Library/Application Support/AllTheRepos/alltherepos.db`
- LanceDB: `~/Library/Application Support/AllTheRepos/lance/`
- Settings: `~/Library/Application Support/AllTheRepos/settings.json`

No data is written outside `app.getPath('userData')` in Phase 1.

### Why `userData` and not `~/.alltherepos/`?

`~/.alltherepos/` is the legacy Next.js location. macOS guidance is
"app-private state belongs in `~/Library/Application Support/<appname>`"
(see NEW-PLAN.md §6 "Move data location") and Electron's `userData` path
resolves to exactly that directory on macOS. Putting data here:

- Survives `rm -rf ~/.alltherepos/` cleanup attempts the user does on
  the legacy CLI install.
- Plays nicely with Time Machine excludes / iCloud sync policies.
- Auto-namespaces by app name when electron-builder ships a different
  productName in a future fork / variant.

## First-run migration from `~/.alltherepos/`

On boot, the main process MUST check for a legacy install and migrate
data exactly once:

```
const legacyDir = path.join(os.homedir(), '.alltherepos');
const userDataDir = app.getPath('userData');
const sentinel = path.join(userDataDir, 'MIGRATED');

if (!fs.existsSync(sentinel) && fs.existsSync(legacyDir)) {
  // COPY (don't move) so the legacy CLI install keeps working in Phase 1.
  await copyIfExists(path.join(legacyDir, 'alltherepos.db'),
                     path.join(userDataDir, 'alltherepos.db'));
  await copyDirIfExists(path.join(legacyDir, 'lance'),
                        path.join(userDataDir, 'lance'));
  fs.writeFileSync(sentinel, new Date().toISOString());
}
```

Rules:

1. **COPY, do not MOVE.** Phase 1 leaves the legacy `~/.alltherepos/`
   intact. Phase 2 (or later) MAY add a "remove legacy data" affordance
   in Settings; Phase 1 does not.
2. **Idempotent.** The presence of the `MIGRATED` sentinel file gates
   the migration. Even if the legacy directory reappears later, the
   migration does not re-run. (Users who want a forced re-import can
   manually delete the sentinel.)
3. **No symlink in Phase 1.** NEW-PLAN.md §6 suggests symlinking the
   legacy location back for CLI muscle memory; defer that to Phase 5
   polish — it's not necessary for the desktop app to work.
4. **No destructive operations.** The migration must not delete, move,
   or rename anything in `~/.alltherepos/`.

## SQLite

### Engine + bindings

- `better-sqlite3` is the only SQLite driver. Synchronous API, single
  connection, lives in the main process for the lifetime of the app.
- Drizzle ORM provides the query builder + migrations runner.
- The existing `lib/db/client.ts` already configures `journal_mode=WAL`
  and `foreign_keys=ON`. **The Electron port MUST do the same.** Both
  PRAGMAs are required:
  - `WAL` mode lets the (future) embed worker thread read while the
    main thread writes, without blocking. It also speeds up the
    `repos` upsert hot path during scans.
  - `foreign_keys = ON` is what makes `groups:delete` cascade through
    `repo_groups`.

### Connection model

- **Singleton.** A single `Database` instance is created once in the
  main process and reused by all services (CatalogService, GitService,
  scanner worker, etc.).
- **No connection in the renderer.** This is non-negotiable. The
  preload bridge exposes IPC channels; the renderer has no path to the
  SQLite file. This is both a security and a correctness rule (WAL
  mode does not coordinate across multiple `better-sqlite3` processes
  on its own).
- **Worker threads** that need DB access (e.g. the scanner worker)
  MUST receive their results via `parentPort.postMessage` and let the
  main thread perform the writes, OR open a second `better-sqlite3`
  handle to the same file (WAL mode supports this; the writes from
  multiple processes are serialized by SQLite's locking).

### Schema + migrations

- Schema is defined in Drizzle TypeScript in `lib/db/schema.ts`
  (existing). Phase 1 implementers port this file unchanged into the
  Electron main process.
- The initial migration ships as `drizzle/0000_initial.sql`. Phase 1
  continues to use it; no schema changes are planned. **TODO:** if
  Phase 1 implementers find they need new columns (e.g. for the
  scanner's `lastError`), they add a `drizzle/0001_*.sql` and call out
  in their handoff notes. Do NOT modify `0000_initial.sql`.
- The frozen v1 schema is documented in `contracts/schema.md` and
  remains authoritative.

### Concurrency

- **One writer at a time.** SQLite's locking + WAL mode handle this.
  Don't add an in-process mutex; let SQLite serialize.
- **Reads in any service.** Multiple services can call `db.select()`
  concurrently within a single Node event loop.
- **The renderer NEVER touches SQLite.** All reads go through IPC.
- Long-running writes (the scanner inserting hundreds of repos)
  SHOULD batch via Drizzle transactions to amortize the WAL fsync cost.

## LanceDB

- Storage path: `app.getPath('userData') + '/lance/'`. The directory
  must exist before the first `lancedb.connect()` call (create it if
  missing).
- Table name: `repo_embeddings`. Vector dim 768 (nomic-embed-text).
- Migration: copy the entire `~/.alltherepos/lance/` directory tree in
  the first-run migration (see above).
- The embed worker thread owns the LanceDB handle; main-thread code
  reaches into LanceDB only via the worker.

## electron-store (Settings)

- File: `app.getPath('userData') + '/settings.json'`.
- Schema: the `Settings` interface from `contracts/types.ts`. The
  shared Zod schema is `SettingsSchema` in `src/shared/schemas.ts`.
- On first run, if the file does not exist, the handler MUST write the
  defaults:
  ```json
  {
    "scanPaths": [],
    "ollamaBaseUrl": "http://localhost:11434",
    "ollamaEmbedModel": "nomic-embed-text",
    "openaiEmbedModel": null,
    "defaultEditor": "vscode",
    "schemaVersion": 1
  }
  ```
- `electron-store` v9+ ships ESM-only; the main process is already ESM
  in the electron-vite scaffold, so this is fine.
- `electron-store` writes synchronously via a temp-file + rename, which
  is durable across crashes. Don't wrap it in a custom queue.
- **Migration from SQLite-backed settings.** The legacy app stored
  settings in the SQLite `settings` table (see `contracts/schema.md`).
  On first run with a copied legacy DB present, the
  `SettingsService` MUST read the legacy row, write it to
  `settings.json`, and thereafter ignore the SQLite row. The legacy
  `settings` table is NOT dropped in Phase 1; it remains a read-only
  fallback.

## Renderer access rules (non-negotiable)

1. The renderer process has `nodeIntegration: false` and `sandbox: true`
   (see NEW-PLAN.md §3.4). It cannot `require('better-sqlite3')` or
   `require('@lancedb/lancedb')` — the bindings live in main, period.
2. Every renderer-side data read is `window.atr.<namespace>.<verb>()`.
   No `fetch('/api/...')` calls; there is no HTTP server in Phase 1.
3. TanStack Query owns the renderer-side cache. Cache invalidation is
   triggered by:
   - explicit `queryClient.invalidateQueries(...)` after mutations, and
   - subscriptions to `scan:on:progress` that invalidate the catalog
     queries when a `repo` or `done` event arrives.

## What this contract does NOT cover

- The actual Drizzle schema (see `contracts/schema.md`).
- Editor URI dispatch (covered by `contracts/ipc.v1.md > git:openInEditor`,
  to be deepened in Phase 2).
- The JobQueue durability layer (Phase 4 — out of scope here).
- Cross-platform paths (Phase 6 — Windows/Linux paths will need their
  own data-layer contract version).

## Open questions / flags for Phase 1 implementers

- **Scanner concurrency limit.** Not encoded in this contract. Pick a
  value (suggest `os.cpus().length / 2`) in the backend-services
  agent's implementation notes.
- **Embed worker startup cost.** First call to `embed()` lazy-spawns
  the worker; document the warmup latency in the QE report.
- **Bigger-than-RAM repos.** If a single `readme_content` exceeds the
  SQLite max blob size (rare), the upserter should truncate to the
  existing 2KB preview rule (`REPO_PREVIEW_MAX` in
  `lib/db/queries.ts`). This is already the legacy behavior; flag if
  not.
