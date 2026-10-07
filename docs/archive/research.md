# Building a developer repo management hub

**No tool today unifies local repo discovery, GitHub metadata, and AI-powered search into a single developer hub — which makes this a genuinely open niche worth filling.** Existing tools are fragmented across 30+ projects that each solve one slice: lazygit (63K stars) excels at single-repo TUI operations, gita handles batch CLI commands across repos, GitKraken offers multi-repo workspaces behind a paywall, and Backstage provides enterprise software catalogs that take weeks to configure. None of them combines filesystem scanning, remote API enrichment, semantic search, relationship mapping, and a personal knowledge base. The recommended stack is **Tauri 2.0 + Vite/React + SQLite (via Drizzle ORM) + LanceDB + Claude API**, prototyped first as a **Next.js localhost app** for rapid iteration.

---

## What exists today and where the gaps are

The repo management tool ecosystem splits into five categories, none of which overlap enough to constitute a complete solution.

**Portfolio and dashboard tools** serve narrow audiences. Backstage (Spotify's CNCF project, ~28K GitHub stars) models a full software catalog with its Kubernetes-inspired entity system — `kind`, `metadata`, `spec` — but requires significant YAML configuration and targets platform engineering teams, not individual developers. Sourcegraph offered universal code search but **went fully proprietary in 2024**, discontinuing its open-source edition and free tier entirely. DevDash provides terminal-based GitHub metric widgets but hasn't seen meaningful updates in three years. GitHub's own repository dashboard (GA February 2026) added filtering and saved views, but knows nothing about local clones and offers no AI features.

**Local repo CLI tools** are lightweight but siloed. `ghq` (Go, ~3K stars) organizes clones into URL-based directory structures (`~/ghq/github.com/user/repo`) and pairs well with `fzf`, but provides no metadata enrichment or status tracking. `gita` (Python, ~1.7K stars) displays branch status across registered repos and delegates batch git commands, but requires manual repo registration and has no GitHub API integration. `mr`/myrepos (Perl) is functionally abandoned since 2018. Google's `repo` tool is tightly coupled to Android's Gerrit workflow.

**Desktop Git clients** focus on operations, not portfolio management. GitHub Desktop is single-repo-at-a-time. GitKraken's Workspaces feature is the closest to a multi-repo hub — grouping repos, bulk pull/fetch, cross-IDE sync — but it's a **premium feature behind a subscription**. Tower is Mac/Windows-only and paid ($69/year) with no multi-repo dashboard.

**VS Code extensions** solve project switching, not repo intelligence. Project Manager (alefragnani) lets you bookmark and tag projects for quick switching. GitLens's Workspaces feature groups repos but lives behind the Pro paywall. The built-in multi-root workspace simply opens multiple folders with no aggregated intelligence.

**Raycast/Alfred extensions** enable fast repo opening — the Raycast Repository Manager even pulls from GitHub/GitLab/Bitbucket remotes — but these are launch-and-forget tools with no persistent state, no analysis, and no search.

Seven concrete gaps emerge from that survey that a custom tool would fill: no unified local-plus-remote view, no semantic search across a repo portfolio, no personal knowledge base or wiki layer, no relationship mapping between repos, no AI-powered auto-tagging across local and remote repos, no personal repo health dashboard aggregating stale branches and uncommitted changes, and no tool that bridges CLI efficiency with GUI richness.

---

## The recommended architecture: prototype fast, ship light

The architecture should be built in two phases, optimizing for the user's existing Next.js/React expertise while targeting a lightweight native app.

**Phase 1 (MVP, 2–4 weeks): Next.js localhost app.** This maximizes velocity. Next.js App Router with server actions provides direct access to Node.js APIs — `better-sqlite3` for the database, `simple-git` for local repo reading, `child_process` for git commands, and Octokit for GitHub API calls. No IPC layer needed; server actions call SQLite directly. Run via `next start` or `npm run dev`. The tradeoff — running in a browser tab without native system tray, menus, or global shortcuts — is acceptable for an MVP.

**Phase 2 (desktop app): Tauri 2.0 + Vite + React.** Port the React UI (not the Next.js-specific parts) to a Vite + React build. Tauri produces **~5–10 MB binaries** versus Electron's 100+ MB, uses **~30–40 MB RAM** versus Electron's 200–400 MB, and starts in under 500ms. Tauri 2.0 (released late 2024) is stable, on the ThoughtWorks Technology Radar at "Trial," and its official SQL plugin (`@tauri-apps/plugin-sql` v2.3.2) handles SQLite via sqlx. The Rust backend enables significantly faster filesystem scanning via the `walkdir` crate and native git operations via `git2`.

**Why not Tauri + Next.js directly?** Tauri requires `output: 'export'` (static export only), which eliminates server actions, API routes, and SSR — the exact features that make Next.js useful for data-heavy apps. Pure Vite + React aligns better with Tauri's architecture.

**Why not Electron?** It works — `better-sqlite3` is battle-tested in Electron apps like Folo (RSS reader) — but the binary size and memory overhead are unnecessary given Tauri's maturity. **Why not a VS Code extension?** Webview sandboxing, limited UI real estate, and the inability to run standalone make it too constrained for a full hub. Build a lightweight VS Code companion extension later that opens the main app or shows a sidebar summary. **Why not a TUI?** Screenshots, thumbnails, rich grouping UIs, and markdown rendering need a GUI. A TUI could serve as a complementary quick-status tool.

---

## Data model: six entities anchored by SQLite and Drizzle

**SQLite is the clear database choice** for a local-first desktop app — single-file storage, zero configuration, ACID transactions, FTS5 for full-text search, and the `sqlite-vec` extension for vector similarity search. Pair it with **Drizzle ORM** for type-safe schema definitions, migration management, and first-class `better-sqlite3` support. Store the database file at the platform-standard location: `~/Library/Application Support/YourApp/` on macOS, `%APPDATA%\YourApp\` on Windows, `~/.config/YourApp/` on Linux.

The data model centers on six entities. The **Repo** entity is the core, carrying identity fields (name, full_name, slug), location fields (local_path, remote_url, ssh_url), metadata from GitHub (description, primary language, language byte counts as JSON, topics, license, visibility, is_fork, is_archived), activity fields (last_commit_hash, last_commit_date, last_opened_date, last_synced_date), metrics (stars, forks, open issues, repo size), and user enrichment (notes, custom_tags, thumbnail_path, color, priority). Track `source` as an enum (manual, filesystem_scan, github_import) to know how each repo was discovered.

**Groups** support both manual collections and smart filters. A `is_smart` boolean flag with a `smart_filter` JSON column (e.g., `{"language": "TypeScript", "topics_include": ["nextjs"]}`) lets the app auto-populate groups. Nest groups via a nullable `parent_group_id` self-reference.

**RepoRelationship** captures inter-repo connections with a type enum: `depends_on`, `fork_of`, `monorepo_child`, `related`, `replaces`. This enables features like "show all repos in this project family" or "what depends on this shared library."

**Analysis** stores AI-generated content — summaries, deep dives, architecture reviews — linked to repos with the `model_used`, `prompt_used`, `analyzed_at`, and a `file_context` JSON recording which files were analyzed. This makes regeneration transparent.

**ActivityLog** records events (opened, committed, pr_created, synced, analyzed) with JSON details for flexible querying without schema changes.

A flexible **labels/annotations pattern** (inspired by Backstage's Kubernetes-style metadata) supplements typed fields: store arbitrary key-value annotations in a JSON column so the schema evolves without migrations for exploratory features.

---

## GitHub API strategy: GraphQL-first with smart caching

**GraphQL is overwhelmingly superior to REST for this use case.** A single GraphQL query fetches 100 repos with all metadata — name, description, URL, primary language, topics, stars, pushed_at, fork status, license, open issues, and even README content — in one request costing ~1 rate-limit point. The equivalent REST approach requires 3–4 calls per repo (metadata + languages + topics + README), consuming **~400 requests for 200 repos** versus GraphQL's 2 requests.

The key GraphQL query uses `viewer { repositories(first: 100, after: $cursor) { ... } }` with `@octokit/plugin-paginate-graphql` handling cursor-based pagination automatically. Include the README by requesting `object(expression: "HEAD:README.md") { ... on Blob { text } }` inline. For a user with 200–500 repos, the entire catalog syncs in 2–5 API calls, well within the **5,000 points/hour** authenticated limit.

**Authentication should use a Fine-Grained Personal Access Token.** GitHub officially recommends fine-grained over classic PATs. Scope it to `Metadata: read` and `Contents: read` — the minimum needed for repo metadata and README access. No OAuth flow or server infrastructure required for a personal tool. The one caveat: fine-grained PATs cannot span multiple organizations in a single token. If cross-org access is needed, fall back to a classic PAT with `repo` scope.

**For REST endpoints that remain useful** (conditional requests, specific endpoints), implement ETag-based caching: store the `ETag` response header per endpoint, send `If-None-Match` on subsequent requests, and **304 responses don't count against the rate limit**. This makes periodic polling essentially free for unchanged data.

**Local git integration** uses three libraries. `simple-git` (Node.js, wraps the git binary) reads remotes, branch info, commit logs, and working tree status. `git-url-parse` normalizes remote URLs — converting both `git@github.com:user/repo.git` and `https://github.com/user/repo.git` to a consistent `{owner, name}` pair. The correlation logic: scan local `.git/config` files → extract remote origin → parse to `owner/repo` → match against the GitHub API's `nameWithOwner` field. For the Tauri phase, the Rust `git2` crate provides native git operations without shelling out.

**Discovery works in four layers.** An initial filesystem scan finds `.git` directories using `find-git-repositories` (the npm package by GitKraken's team, battle-tested, with async progress callbacks and depth limiting). Ongoing, `chokidar` watches configured directories for new `.git` folders appearing in real time. GitHub API polling on a configurable schedule (default: hourly) enriches local repos with remote metadata and surfaces repos that exist on GitHub but aren't cloned locally. Users can also manually add repos via drag-and-drop or path input. Default scan paths — `~/`, `~/code`, `~/projects`, `~/dev` — should be user-configurable.

---

## AI features: semantic search, auto-tagging, and a repo wiki

The AI layer transforms this from a catalog into an intelligent knowledge base. Three capabilities matter most, and all are surprisingly affordable at personal scale.

**Semantic search** uses embeddings stored in **LanceDB**, the recommended vector database. LanceDB is embedded (no server process), has a **native TypeScript SDK** (`@lancedb/lancedb`), stores data as local files, supports hybrid vector + full-text search, and is proven in production by Continue.dev for exactly this use case — local codebase semantic search. It handles the scale of 100–1,000 repos with sub-millisecond query times. The runner-up, `sqlite-vec` (a SQLite extension for SIMD-accelerated vector search, sponsored by Mozilla), is worth considering if consolidating everything into a single SQLite file matters more than LanceDB's richer query capabilities.

For embedding models, run **`nomic-embed-text` v1.5 locally via Ollama** — it's open-source (Apache 2.0), supports 8,192 token context, outperforms OpenAI's `text-embedding-3-small` on most benchmarks, and costs nothing to run. If local compute is constrained, fall back to `text-embedding-3-small` at $0.02 per million tokens — embedding 500 repos' READMEs would cost roughly **$0.10–0.50 total**. For code-heavy search, Voyage Code 3 leads benchmarks but requires a proprietary API.

**Auto-tagging uses a three-layer approach**, escalating from free to cheap. Layer 1 (heuristic, free, instant): parse `package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, and file extensions to detect languages and frameworks automatically. Layer 2 (embedding clustering, near-free): cluster repo embeddings via HDBSCAN and use Claude to label each cluster once — one API call per cluster, not per repo. Layer 3 (LLM classification, ~$3.50 for 500 repos): send README + file tree to **Claude Haiku 4.5** ($1/$5 per million tokens) with a structured output schema that extracts primary language, frameworks, category (web-app/cli-tool/library/API/etc.), up to 8 tags, and activity status. Using the **Batch API** halves this to ~$1.75. All three layers should be implemented: Layer 1 runs on every sync, Layer 3 only on new or changed repos.

**The "deep dive" wiki feature** is the killer differentiator. The pipeline works as follows: read a repo's file tree (top 3 levels, excluding `node_modules`/`.git`), README, dependency files, CI config, and first 100 lines of main entry points — targeting 3–8K tokens of context. Send this to **Claude Sonnet 4** (or the latest Sonnet 4.6) with a structured output schema requesting an architecture overview, key modules, data flow patterns, API surface, dependency analysis, and setup instructions. Store the result as indexed Markdown with YAML frontmatter. Embed the wiki content in LanceDB alongside repo metadata for unified semantic search — so a query like "which of my projects handles authentication?" searches across both repo descriptions and generated wiki entries.

Cost management keeps this practical. **Initial full analysis of 500 repos costs $5–15** via Batch API with prompt caching (90% savings on the cached system prompt). Ongoing monthly costs for ~50 changed repos run **$1–2/month**. Track a content hash (SHA-256 of README + file tree) per repo; skip re-analysis when the hash hasn't changed. Route models by task: Haiku 4.5 for tagging and summarization, Sonnet 4 for deep dives, Opus 4.6 only for extremely complex repos requiring deep reasoning.

The Anthropic TypeScript SDK (`@anthropic-ai/sdk`, actively maintained, 13.4M npm downloads) supports streaming, tool use, structured outputs, batch processing, and prompt caching. Structured outputs use constrained decoding to guarantee valid JSON matching your schema — the model literally cannot produce invalid output. This eliminates parsing errors in the auto-tagging and summarization pipelines.

---

## Thumbnails, screenshots, and visual identity

For visual repo cards, use a three-tier approach. **Default**: fetch and cache GitHub's auto-generated social preview images (Open Graph images available for all repos via the `og:image` meta tag). **Custom cards**: use **Satori** (Vercel's JSX-to-SVG engine, ~2 MB, no browser dependency) to generate branded repo cards with the language breakdown bar, star count, last commit date, and custom tags. **Deployed app screenshots**: optionally use Puppeteer or Playwright to screenshot homepage URLs, triggered manually rather than automatically to avoid the ~100 MB Chromium dependency on every sync. Store all thumbnails as WebP files in the app data directory, referenced by path in SQLite.

---

## Conclusion

The concrete stack recommendation is **Tauri 2.0 + Vite + React + Tailwind + shadcn/ui** for the frontend, **SQLite via Drizzle ORM** for structured data, **LanceDB** for vector search, **Octokit with GraphQL** for GitHub integration, **simple-git + git-url-parse** for local repo correlation, **nomic-embed-text via Ollama** for embeddings, and **Claude Haiku 4.5 / Sonnet 4 via the Anthropic SDK** for AI features. Prototype first as a Next.js localhost app to validate the data model and UI before porting to Tauri.

The deepest competitive moat lies not in the catalog itself — that's table stakes — but in the AI-generated wiki layer and semantic search. No existing tool lets a developer ask "which of my repos implements OAuth?" and get an answer that spans local clones, GitHub metadata, and LLM-analyzed codebases. Build that first, and the rest is plumbing. Total ongoing cost for AI features across a 500-repo portfolio: roughly **$1–2 per month**, making this one of those rare projects where the AI capabilities are cheaper than the coffee consumed while building them.
