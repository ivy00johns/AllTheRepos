# Contracts — AllTheRepos MVP

> **LEGACY (Next.js).** This document describes the original Next.js MVP
> surface (REST routes + server actions). It is SUPERSEDED for the Electron
> app by the IPC contracts in `ipc.v3*.md` (and `ipc.v1.md`) plus
> `data-layer.v1.*`. Read those for the current desktop architecture; this
> file is retained for historical context only.

**Contract version:** v1.0 — 2026-04-15
**Status:** Frozen for initial build. Changes require orchestrator approval + version bump.

## Domain Rules (normative — all agents enforce)

1. **`Repo.slug` is the stable identifier.** Generated as `kebab-case(name) + "-" + shortHash(full_path)`. Used in URLs and LanceDB keys. Never mutate after first write.
2. **`full_path` is absolute and canonical.** Always expanded from `~` and symlink-resolved before persistence. Unique constraint.
3. **Scanning is idempotent.** Re-scanning a repo updates metadata fields but preserves `id`, `slug`, `tags_json` (user-set), `notes`, and group memberships.
4. **Embedding regeneration is content-hash gated.** `readme_hash = sha256(readme_content ?? "")`. If unchanged since last embed, skip LanceDB upsert.
5. **Tags are a union of three sources** with precedence: `user_tags` (manual) > `heuristic_tags` (parser) > `smart_tags` (auto). Stored as a single `tags_json` array; each element is `{value: string, source: "user" | "heuristic" | "smart"}`.
6. **Primary language** is the language with the most bytes, or `null` if the repo has no language data. Never guess from file extension without byte counts.
7. **Dirty detection** uses `git status --porcelain=v1` — any output = dirty.
8. **All timestamps are ISO-8601 UTC strings.** Never bare epoch numbers across the wire.
9. **Scan paths may not overlap.** The scanner deduplicates found `.git` directories by canonical `full_path`.
10. **Settings are a single-row key/value blob.** The schema version column enables forward migrations.

## File Ownership

| Role         | Owns (exclusive write)                                                                                                                        | Read-only                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| backend      | `lib/db/**`, `lib/git/**`, `lib/embed/**`, `lib/search/**`, `lib/tag/**`, `app/api/**`, `app/actions/**`, `drizzle/**`, `lib/types.ts`        | `contracts/**`                 |
| frontend     | `app/(catalog)/**`, `app/settings/**`, `app/repos/**`, `components/**`, `app/page.tsx`, `app/layout.tsx`, `app/globals.css`                   | `contracts/**`, `lib/types.ts` |
| qe           | `tests/**`, `e2e/**`, `vitest.config.ts`, `playwright.config.ts`                                                                              | all                            |
| orchestrator | `contracts/**`, `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `.env.example`, `.gitignore`, `README.md`, `docs/**` | all                            |

Directory-level ownership wins. If frontend needs a type from `lib/types.ts`, import it — don't redefine it.

## Shared Types (single source of truth)

All entities live in `lib/types.ts` (owned by backend, consumed by frontend and qe). See `contracts/types.ts` for the frozen spec.

## API Surface

- `POST /api/scan` — trigger scan, streams progress (NDJSON)
- `POST /api/search` — semantic + FTS hybrid search
- `GET /api/repos` — paginated repo list with filters
- `GET /api/repos/[slug]` — single repo with expanded metadata
- `GET /api/groups` — all groups
- `GET /api/settings` — current settings

Server actions (mutations, used by frontend):

- `rescanRepo(slug)` — re-read metadata + re-embed if hash changed
- `setRepoTags(slug, tags)` — overwrites user tags, preserves heuristic
- `openInEditor(slug)` — opens VS Code via URL scheme
- `createGroup(data)`, `updateGroup(id, data)`, `deleteGroup(id)`
- `addRepoToGroup(slug, groupId)`, `removeRepoFromGroup(slug, groupId)`
- `saveSettings(data)`
- `addScanPath(path)`, `removeScanPath(path)`

All errors conform to `{ok: false, error: {code, message, details?}}` (see `ApiError`).

## Database Schema (frozen v1)

See `contracts/schema.md` for migration-ready Drizzle schema.

## Implementation Notes per Agent

### backend

- Use `better-sqlite3` with WAL mode (`PRAGMA journal_mode=WAL`).
- Data dir: `process.env.ATR_DATA_DIR || path.join(os.homedir(), ".alltherepos")`. Create on first run.
- Scanner: `find-git-repositories` for initial discovery, then per-repo metadata via `simple-git`.
- Scan is a `ReadableStream<ScanProgressEvent>` — yield progress events as NDJSON.
- Heuristic tagger: at minimum `package.json` (detect framework: next/react/vue/svelte/express/nestjs), `Cargo.toml`, `go.mod`, `requirements.txt`, `pyproject.toml`, `Gemfile`, file-extension heuristic for language bars.
- Embed: try Ollama first, fall back to OpenAI if `OPENAI_API_KEY` set. If both fail, log and skip (don't crash).
- LanceDB path: `{dataDir}/lance`. Table: `repo_embeddings`. Vector dim: 768 (nomic-embed-text).
- Search is hybrid: SQLite FTS5 keyword match UNION LanceDB vector top-k, then merged & scored.

### frontend

- Next.js App Router. Use server actions for mutations, route handlers for streaming.
- No client-side API calls to `/api/repos` on initial render — server components read directly from `lib/db`.
- **Keyboard shortcuts** (non-negotiable): `/` focus search, `j`/`k` nav, `enter` open, `esc` close, `g s` settings.
- Language bar: horizontal stacked bar with GitHub linguist colors. Source colors from `components/catalog/language-colors.ts` (seed from backend via `lib/languages.ts`).
- Repo card: slot-based. Left: name + primary language dot. Middle: last commit + dirty pill. Right: tag chips.
- Layout: three-column at `lg:` — sidebar 240px / center flex-1 / detail panel 360px (slide-in).
- All interactive elements use `shadcn/ui` primitives from `components/ui/`.
- Never hard-code colors — use CSS variables defined in `globals.css`.

### qe

- Vitest for unit (db, scanner, tagger, embed client).
- Playwright for E2E (happy path, keyboard nav, search).
- Contract tests: verify server-action return types match `lib/types.ts`.
- Minimum gate: unit coverage ≥60% on `lib/**`, 3+ green E2E scenarios.
