# AllTheRepos — MVP Implementation Plan

## Scope (locked 2026-04-15)

**Phase 1 MVP** — Next.js localhost app. John's repos only. Local filesystem scan. No GitHub sync (deferred). Heuristic auto-tagging + semantic search (LanceDB). No deep-dive wiki yet.

## Goals

A personal, dark-mode repo hub John can run at `localhost:3000`:

1. **Discover** — scan `~/Repos`, `~/AllTheRepos`, `~/code` (configurable) for `.git` directories
2. **Enrich** — read each repo's README, last commit, current branch, dirty status, language via heuristic parsing
3. **Catalog** — persist to SQLite, browsable grid with language bars + metadata
4. **Search** — natural-language semantic search across repo metadata (embedded via Ollama)
5. **Filter** — by language, tag, group, recency, dirty status, keyboard shortcuts

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router | Server actions, John's fluency |
| Language | TypeScript (strict) | Contracts |
| DB | better-sqlite3 + Drizzle ORM | Local-first, type-safe |
| Vector | @lancedb/lancedb | Embedded, native TS |
| Embeddings | Ollama `nomic-embed-text` (default), `text-embedding-3-small` fallback | Free local + cloud escape hatch |
| Git | simple-git + find-git-repositories + git-url-parse | Battle-tested |
| UI | Tailwind 4 + shadcn/ui | Dark OLED style tokens |
| Fonts | JetBrains Mono + IBM Plex Sans | Per design system |
| Testing | Vitest + Playwright | Unit + E2E |

## Design System

Source of truth: [design-system/alltherepos/MASTER.md](../../design-system/alltherepos/MASTER.md)

- Dark OLED only for v1
- Accent `#22C55E` (green) — reserved for "active", "clean tree", primary CTAs
- Destructive `#EF4444` — dirty tree, delete
- Language-color mapping (GitHub linguist palette) for language bars
- Keyboard-first: `/` focus search, `g r` groups view, `j/k` nav, `enter` open

### Page overrides

Main catalog page uses **three-column IDE layout** (not "Horizontal Scroll Journey" from the landing-page system):
- Left: groups/tags sidebar (200px, collapsible)
- Center: search bar (sticky top) + repo card grid
- Right: detail panel (slides in on repo select, 360px)

## MVP Feature Set

### IN

1. Filesystem scan with progress (async, resumable)
2. Repo CRUD in SQLite
3. Heuristic tagging: parse `package.json`, `Cargo.toml`, `go.mod`, `requirements.txt`, `pyproject.toml`, `Gemfile`, `pom.xml`, `*.csproj`
4. Git metadata: current branch, last commit date/hash/message, dirty status, tracked remote URL
5. Embedding pipeline: README + description + tags → vector → LanceDB
6. Semantic search: natural-language query against LanceDB
7. Filter/sort UI: language, tag, group, last-commit, dirty
8. Manual groups + smart groups (JSON filter)
9. Detail panel: full metadata + README preview + "open in editor" (VS Code URL scheme)
10. Settings: scan paths, Ollama URL, embedding model

### OUT (deferred)

- GitHub API sync (Phase 1b)
- Deep-dive Claude wiki (Phase 1c)
- Relationships graph
- Thumbnails / Satori cards
- Activity log
- VS Code companion extension
- Tauri port (Phase 2)

## Data Model (SQLite via Drizzle)

```
repos
  id, slug (unique), name, full_path (unique), remote_url, default_branch
  current_branch, last_commit_hash, last_commit_date, last_commit_msg
  is_dirty, primary_language, languages_json, tags_json, description
  readme_content, readme_hash, size_bytes
  last_scanned_at, last_opened_at, created_at, updated_at
  source (enum: manual | filesystem_scan)

groups
  id, name, description, is_smart, smart_filter_json, parent_group_id, sort_order

repo_groups (join)
  repo_id, group_id

scan_paths
  id, path, enabled, last_scanned_at

settings (single-row k/v json blob)
  id=1, data_json
```

LanceDB table: `repo_embeddings` — `{repo_id, vector, content_hash, updated_at}`

## Architecture

```
app/
  (catalog)/page.tsx                 # main grid
  repos/[slug]/page.tsx              # detail page (fallback when no panel)
  settings/page.tsx
  api/
    scan/route.ts                    # POST trigger scan (SSE progress)
    search/route.ts                  # POST semantic search
  actions/                           # server actions for mutations
    repos.ts, groups.ts, settings.ts
components/
  catalog/ (RepoCard, LanguageBar, SearchBar, FilterChips, DetailPanel)
  groups/  (GroupSidebar, GroupEditor, SmartFilterBuilder)
  ui/      (shadcn primitives)
lib/
  db/        (drizzle schema, migrations, client)
  git/       (scanner, metadata, parser)
  embed/     (ollama client, openai fallback, chunker)
  search/    (lancedb client, query builder)
  tag/       (heuristic extractors per ecosystem)
  types.ts   # shared types (single source of truth)
```

## Contract Points (authored in phase 1)

1. **Shared types** — `Repo`, `Group`, `LanguageBytes`, `ScanProgress`, `SearchHit` (single source in `lib/types.ts`)
2. **Scanner API** — `scanPaths(paths: string[], onProgress): AsyncGenerator<ScanProgress>`
3. **Search API** — `POST /api/search { query, filters } → SearchHit[]`
4. **Server actions** — `rescanRepo(id)`, `updateTags(id, tags)`, `upsertGroup(g)`, `setSettings(s)`

## Team

| Agent | Ownership |
|---|---|
| backend | `lib/db/`, `lib/git/`, `lib/embed/`, `lib/search/`, `lib/tag/`, `app/api/`, `app/actions/` |
| frontend | `app/(catalog)/`, `app/settings/`, `app/repos/`, `components/`, `app/layout.tsx`, `app/globals.css` |
| qe | `tests/`, `e2e/`, contract conformance |
| orchestrator | `contracts/`, `drizzle/`, scaffold, `package.json`, `next.config.ts`, `tailwind.config.ts` |

## Acceptance Criteria

1. `pnpm dev` → app on :3000
2. Settings → add scan path → click Scan → progress streams → repo cards appear
3. Each card shows: name, primary lang + bar, last commit (relative), dirty indicator, tags
4. Typing in search bar returns results within 500ms (FTS + semantic hybrid)
5. Sidebar: create manual group, drag-drop repo, smart group by `language=TypeScript`
6. Detail panel: click card → metadata + README rendered
7. "Open in VS Code" button launches editor
8. Keyboard: `/` focuses search, `j/k` navigates grid, `enter` opens, `esc` closes panel
9. All tests green, QA gate passes, contract diff clean

## Build Sequence

1. [orchestrator] scaffold Next.js + configure tooling + commit
2. [orchestrator] author contracts (types, API shapes, action signatures)
3. [backend + frontend + qe] spawn in parallel
4. [orchestrator] contract diff + E2E validation
5. [qe] final gate report
