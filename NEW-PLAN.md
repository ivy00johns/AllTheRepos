# AllTheRepos Desktop — Architecture & Feature Design Report

*An opinionated build plan for evolving the Next.js localhost catalog into a deep, native-feeling macOS developer hub.*

---

## 1. Executive Summary

1. **Don't ship a wrapped Next.js app.** Migrate the UI to a **Vite + React + Tailwind 4 + shadcn** renderer inside an **electron-vite** monorepo. Keep every React component, hook, and Tailwind class you already wrote; replace Next.js Route Handlers and Server Actions with a single typed IPC layer. The cost of Nextron's outdated bundling and the SSR-in-Electron contortions outweigh the benefit of keeping `app/` routing.
2. **Treat the main process as a real backend.** Move SQLite, Drizzle, LanceDB, simple-git, the scanner, the watcher, and all node-only code into the main process as a set of services. Expose them to the renderer through a **thin, hand-written, type-safe IPC façade** built on `ipcMain.handle` + `contextBridge` + Zod — not electron-trpc (the runtime tax isn't worth it for a single-user app).
3. **Build the depth features around three pillars** that no existing tool combines well: (a) **live process & port awareness per repo** (lsof + cwd matching), (b) **first-class Claude Code integration** (parse `~/.claude/projects/<hash>/*.jsonl`, surface skills, MCPs, token spend), and (c) **a Cmd-K spotlight palette** with global hotkey that turns the app into a Raycast-style launcher for repos.
4. **Distribute as a signed, notarized, auto-updating `.app`.** Use **electron-builder** with `@electron/notarize`, a Developer ID Application cert from keychain in CI, GitHub Releases as the update feed, and **electron-updater** with delta updates. macOS-only for now — don't pay the cross-platform tax until you need it.
5. **Move data to `~/Library/Application Support/AllTheRepos/`** (the macOS-blessed location) but keep a `~/.alltherepos/` symlink for muscle memory and CLI tools. Keep SQLite+FTS5 and LanceDB; both work fine in Electron once you unpack the right `.node` binaries from asar.
6. **Build in 6 phases over ~8 weekends**: scaffold → parity → tray/hotkey → process/IDE/Claude integrations → intelligence layer (deps, health, LLM tagging) → polish/signing/updates. Each phase ships a usable app; nothing is left half-done.

---

## 2. Why Electron (and a Brief Tauri Acknowledgment)

You've already chosen Electron; this report doesn't relitigate that. Two notes for the record:

- **Tauri 2** would give you a ~10–15 MB bundle instead of ~120 MB, sandboxed-by-default permissions, and less RAM, in exchange for Rust glue code on the main side and a less-friendly native-module story (no `better-sqlite3` drop-in; you'd reach for `tauri-plugin-sql` or `rusqlite`, and your LanceDB Node SDK becomes either the Rust SDK or an out-of-process daemon). The Claude Code log parser you'd write today in 80 lines of TS becomes 200+ lines of Rust.
- **For a single-developer, single-user, depth-over-breadth tool where your existing Drizzle/LanceDB/simple-git stack is already JavaScript**, Electron is the pragmatic choice. The Tauri win materializes when you're shipping to thousands of users who care about installer size and battery; you can revisit it in a year if those constraints emerge.

The architecture below is also engineered so that *if* you ever migrate to Tauri, the renderer and shared schemas port unchanged — only the main-process services would need rewriting.

---

## 3. Architecture Overview

### 3.1 Process model

```
┌──────────────────────── MAIN PROCESS (Node) ────────────────────────┐
│                                                                     │
│  Services (singletons, plain TS classes):                           │
│    • CatalogService     (better-sqlite3 + Drizzle, FTS5)            │
│    • VectorService      (LanceDB)                                   │
│    • ScanService        (find-git-repositories, NDJSON streams)     │
│    • WatcherService     (chokidar v4, FSEvents on macOS)            │
│    • GitService         (simple-git, isomorphic-git for reads)      │
│    • ProcessService     (lsof / ps parsing, port→repo matching)     │
│    • LauncherService    (open -a, URL schemes, AppleScript bridge)  │
│    • ClaudeService      (~/.claude/projects/* parser + MCP scan)    │
│    • DepIntelService    (lockfile parsing, OSV-Scanner CLI bridge)  │
│    • EmbeddingService   (Ollama nomic-embed-text, OpenAI fallback)  │
│    • JobQueue           (p-queue + SQLite durability)               │
│                                                                     │
│  IPC layer:                                                         │
│    ipc/                                                             │
│      ├── catalog.ts        ipcMain.handle('catalog:*')              │
│      ├── scan.ts                                                    │
│      ├── git.ts                                                     │
│      ├── claude.ts                                                  │
│      ├── process.ts                                                 │
│      ├── launcher.ts                                                │
│      └── schemas.ts        (Zod schemas shared with renderer)       │
│                                                                     │
│  Windows: MainWindow, SpotlightWindow (frameless, alwaysOnTop),     │
│           SettingsWindow (optional), Tray                           │
└─────────────────────────────────────────────────────────────────────┘
              ▲                                       ▲
              │ contextBridge (preload, no Node leak) │
              ▼                                       ▼
┌────────────── PRELOAD ──────────────┐  ┌─── PRELOAD (spotlight) ───┐
│ window.atr = {                      │  │ Same surface, narrower    │
│   catalog: {...},                   │  │                           │
│   git: {...},                       │  └───────────────────────────┘
│   claude: {...},                    │
│   scan: {...},                      │           ▲
│   onProgress(cb), onWatch(cb), ...  │           │
│ }                                   │           │
└─────────────────────────────────────┘           │
              ▲                                   │
              │                                   │
┌──────────── RENDERER (Vite + React 19) ────────┴────────────────────┐
│  Pure web app. No Node, no fs, no electron.                          │
│  • shadcn/ui, Tailwind 4, IBM Plex Sans + JetBrains Mono             │
│  • TanStack Query (server-state) + Zustand (UI state)                │
│  • TanStack Router for in-app navigation                             │
│  • cmdk for palette, uFuzzy for ranking                              │
│  • Framer Motion for transitions                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Recommended folder structure

```
alltherepos/
├── electron.vite.config.ts
├── package.json
├── electron-builder.yml
├── tsconfig.json
├── tsconfig.node.json
├── resources/                  # icons, dmg background, entitlements.plist
│   ├── icon.icns
│   ├── tray/                   # template images for dark/light menu bar
│   └── entitlements.mac.plist
├── drizzle/                    # migrations
├── src/
│   ├── main/                   # MAIN PROCESS
│   │   ├── index.ts            # app.whenReady, single instance lock
│   │   ├── window/
│   │   │   ├── main-window.ts
│   │   │   ├── spotlight.ts
│   │   │   └── tray.ts
│   │   ├── services/
│   │   │   ├── catalog.ts
│   │   │   ├── vector.ts
│   │   │   ├── scan.ts
│   │   │   ├── watcher.ts
│   │   │   ├── git.ts
│   │   │   ├── process.ts
│   │   │   ├── launcher.ts
│   │   │   ├── claude.ts
│   │   │   ├── deps.ts
│   │   │   ├── embedding.ts
│   │   │   ├── health.ts
│   │   │   └── job-queue.ts
│   │   ├── ipc/
│   │   │   ├── register.ts     # wires all handlers
│   │   │   ├── catalog.ts
│   │   │   ├── git.ts
│   │   │   ├── claude.ts
│   │   │   ├── process.ts
│   │   │   ├── launcher.ts
│   │   │   ├── scan.ts
│   │   │   └── settings.ts
│   │   ├── workers/            # worker_threads (heavy CPU)
│   │   │   ├── scanner.worker.ts
│   │   │   └── embed.worker.ts
│   │   ├── updater.ts          # electron-updater
│   │   ├── protocol.ts         # alltherepos:// URL scheme
│   │   ├── menu.ts             # native menu bar
│   │   └── shortcuts.ts        # globalShortcut
│   ├── preload/
│   │   ├── index.ts            # contextBridge.exposeInMainWorld('atr', api)
│   │   ├── api.ts              # typed wrapper around ipcRenderer.invoke
│   │   └── index.d.ts          # window.atr types (consumed by renderer)
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── routes/             # TanStack Router
│   │   ├── components/
│   │   │   ├── repo-card/
│   │   │   ├── three-column/
│   │   │   ├── language-bar/
│   │   │   ├── command-palette/
│   │   │   ├── spotlight/
│   │   │   ├── claude-panel/
│   │   │   ├── process-panel/
│   │   │   └── ui/             # shadcn primitives
│   │   ├── hooks/
│   │   │   ├── use-repos.ts    # TanStack Query wrappers
│   │   │   └── use-watch.ts    # subscribes to main-process events
│   │   ├── stores/             # Zustand slices (ui only)
│   │   ├── lib/
│   │   └── styles/
│   └── shared/                 # ✅ imported by main AND renderer
│       ├── types.ts            # Repo, Group, ScanEvent, etc.
│       ├── schemas.ts          # Zod
│       └── constants.ts
├── tests/
│   ├── unit/                   # vitest, mostly services
│   └── e2e/                    # playwright (driving electron)
└── scripts/
    ├── rebuild-natives.mjs
    └── notarize.mjs
```

A few non-obvious choices worth defending:

- **`src/shared/` is the only place renderer and main both import from.** This is what lets you keep type-safe `Repo` objects across the IPC boundary without electron-trpc's runtime cost. Zod schemas live here so the same validator runs at the IPC entry point and (optionally) inside React forms.
- **`src/preload/api.ts`** is a hand-written, fully typed wrapper. The renderer doesn't see `ipcRenderer` — it sees `window.atr.git.listBranches(repoId)`. Curtailing the surface this way is the single most important security decision in the app.
- **Worker threads** are kept inside `main/workers/` rather than as separate Electron utility processes. Worker threads share Node's V8 instance, start in <50ms, and are the right primitive for parallel scanning and batched embedding generation. Reserve Electron `utilityProcess` for things that genuinely need their own V8 isolate (e.g., if you ever embed a JS-based MCP server).

### 3.3 IPC contract pattern (the type-safe alternative to electron-trpc)

```ts
// shared/schemas.ts
export const ListReposInput = z.object({
  query: z.string().optional(),
  groupId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

// main/ipc/catalog.ts
ipcMain.handle('catalog:list', async (_e, raw) => {
  const input = ListReposInput.parse(raw);   // guard, every channel
  return catalogService.list(input);
});

// preload/api.ts
export const api = {
  catalog: {
    list: (input: z.infer<typeof ListReposInput>) =>
      ipcRenderer.invoke('catalog:list', input) as Promise<Repo[]>,
  },
} as const;
contextBridge.exposeInMainWorld('atr', api);

// renderer/hooks/use-repos.ts
export const useRepos = (q: string) =>
  useQuery({ queryKey: ['repos', q], queryFn: () => window.atr.catalog.list({ query: q }) });
```

This gives you ~95% of electron-trpc's developer experience with ~5% of its runtime overhead. The Hyper.media team's published post-mortem found electron-trpc imposed a 7-layer stack and a 133% complexity tax versus direct IPC for simple getters; given AllTheRepos has dozens of simple read APIs, the tax is real. Use electron-trpc only if/when you start needing live subscriptions across many windows with complex middleware. As a Quality Engineer, you'll also appreciate that Zod schemas make IPC handlers trivially unit-testable in isolation — feed them parsed input, assert on output, no Electron runtime required.

### 3.4 Security baseline (non-negotiable defaults)

Every `BrowserWindow` is created with:

```ts
webPreferences: {
  contextIsolation: true,      // default since v12, but be explicit
  nodeIntegration: false,
  sandbox: true,               // ↓ if you absolutely need require() in preload
  preload: path.join(__dirname, '../preload/index.cjs'),
  webSecurity: true,
}
```

A strict CSP is set via response headers in `session.defaultSession.webRequest.onHeadersReceived`:
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://avatars.githubusercontent.com; connect-src 'self' http://localhost:11434 https://api.openai.com;`

`shell.openExternal` is wrapped in an allowlist that rejects anything that isn't `https:`, `vscode:`, `cursor:`, `zed:`, `idea:`, `webstorm:`, `pycharm:`, `rider:`, `xcode:`, `subl:`, or `alltherepos:`. Every `ipcMain.handle` validates `event.senderFrame.url` to make sure the request came from your own renderer (not a sneaky `<webview>`). Note the 2026 Electron CVE on contextBridge VideoFrame transfer — irrelevant here because you'll never pass WebCodecs objects across the bridge, but it's a useful reminder to keep the bridge surface tight.

---

## 4. Migration Path from the Current Next.js App

You have three viable paths. I'll spell out each and then tell you which one to actually take.

### Path A — Next.js static export inside Electron
- `next.config.js` → `output: 'export'`, `images.unoptimized: true`, drop `app/api/*` and Server Actions.
- Electron loads `out/index.html` via `electron-serve` or a custom `protocol.registerFileProtocol`.
- All `fetch('/api/...')` calls are replaced with `window.atr.*` IPC calls.
- **Pros:** least code rewrite; you keep `app/` routing.
- **Cons:** App Router static export is brittle (dynamic segments, route groups, parallel routes all need workarounds). You're paying for the Next.js bundle (~200 KB extra in your renderer) for routing you don't really need in a single-window app. RSC and Server Actions, the actual reason to use Next.js, are gone.

### Path B — Nextron
- Officially blessed Next.js + Electron template.
- **Pros:** Fastest scaffold, opinionated.
- **Cons:** Historically lags Electron and Next.js versions; the Pages-Router-only constraint or the `next-electron-rsc` workaround adds a layer of mystery. Multiple users have reported sluggish startup vs. plain Vite. Not the path for a power user who'll outgrow defaults in week two.

### Path C — Vite + React + Electron (**RECOMMENDED**)
- Scaffold with `npm create @quick-start/electron@latest alltherepos -- --template react-ts` (this is the electron-vite/electron-toolkit template — main, preload, renderer pre-split, HMR works in all three).
- Copy every React component, hook, Tailwind class, and font import from your Next.js project's `components/`, `lib/`, `hooks/`, and `app/globals.css` verbatim.
- Convert each `app/<route>/page.tsx` into a route in **TanStack Router** (file-based, similar mental model).
- Replace every Route Handler / Server Action with a function on a main-process service plus an IPC handler. This is mostly mechanical: the body of your Server Action becomes the body of `catalogService.someMethod`; the function signature stays the same; the call site swaps `'use server'` for `window.atr.catalog.someMethod`.
- Image/font handling: just ship the Plex/JetBrains Mono `.woff2` in `src/renderer/assets/` and import normally. No `next/image`, no `next/font` — `<img>` is fine in a desktop app, and Tailwind's `@font-face` works.

**Why this is the right path:** You stop fighting framework boundaries. Server Actions in Next.js were a clever way to colocate server code with React components on the web; in Electron, you have a much better tool — direct IPC. You spend the migration day rewriting roughly 8–15 thin functions and end up with code that's easier to reason about, faster, and not coupled to a framework that's optimized for a different problem.

**Estimated rewrite scope:** ~10–20% of total LOC. Most of it is the API-route → IPC handler shuffle and the routing swap. The 80% that is shadcn + Tailwind + your three-column layout + language bars is 100% portable.

---

## 5. Deep Feature Design

For each feature: **what it does**, **mechanics**, **UX sketch**, and **prior art notes** so you can lift the best parts.

### 5.1 Repo catalog (feature parity baseline)
**What:** Three-column IDE-style layout: groups/filters | repo list | repo detail. Already designed; port as-is.

**Mechanics:** `CatalogService` wraps `repos`, `groups`, `tags`, `repo_tags`, `repo_groups` tables. Drizzle queries, FTS5 virtual table, the same heuristic tag-detector for `package.json` etc. The only new piece is `repos.last_opened_at` so the activity timeline (5.7) has something to render.

**UX:** Reuse what works. Add a 4th column that slides in on `o` (open) — the **deep panel** with tabs: *Overview / Git / Claude / Processes / Deps / Notes*. This is the IDE-like "drill in without changing context" pattern Linear nails.

### 5.2 Port & process detection — the killer feature
**What:** Per repo, show which dev servers are running, on which ports, with kill buttons. Show port conflicts globally ("port 3000 is taken by `repo-alpha`'s Next.js, you wanted it for `repo-beta`").

**Mechanics on macOS:**
```bash
# All listening ports + PID + command (fast, ~100ms for typical dev box)
lsof -nP -iTCP -sTCP:LISTEN -F pcnTL
# For each PID, get cwd and full argv:
lsof -p <pid> -F n -d cwd   # cwd is the first DIR line
ps -o command= -p <pid>      # full command line
```
`lsof -F` produces field-prefixed parseable output (no fragile column parsing). Run every 2–3 seconds on a `setInterval` when the app is focused; back off to 15s when blurred; pause when the tray menu isn't open and no repo card requesting "live" view is mounted. Hold the parsed snapshot in `ProcessService` memory; emit a `process:update` IPC event when it changes (diffed).

**Associating ports to repos:** match the PID's `cwd` against the catalog. If `cwd` is under a known repo path (or any of its parents up to the repo root), bind that process to that repo. Cache the cwd-to-repo lookup with a trie keyed on absolute paths. Edge case: tools like `pnpm dev` spawn child node processes — walk the parent chain via `ppid` until you find a PID whose `cwd` matches a known repo.

**Linux / Windows fallbacks:** `ss -tlnpH` on Linux, `Get-NetTCPConnection` PowerShell cmdlet on Windows. Defer until cross-platform phase.

**UX:**
- Repo card gets a **green pulsing dot + port chip** ("3000") when something is listening for that repo. Click the chip → copy URL, open in browser, or kill (with confirmation; SIGINT first, SIGTERM after 3s, SIGKILL after 8s).
- A dedicated **Processes view** (tray menu item: "Running dev servers (3)") shows a flat table across all repos. Modeled on Orbstack's beautiful "Containers" list and TablePlus's process panel.
- **Conflict banner** appears in the repo header if you try to launch something on an occupied port; offer to free it.

**Prior art notes:** Orbstack and Docker Desktop nail the "kill running thing" affordance but are container-scoped. No general tool I've seen surfaces *user-space* dev servers per repo. This is a wedge.

### 5.3 Launch actions (open in X)
**What:** One-click open repo in editor, terminal, browser, file manager, Claude Code, GitHub.

**Mechanics on macOS:**
- **Editors (URL scheme — preferred when supported):** `vscode://file//Users/.../repo`, `cursor://file//Users/.../repo`, `zed://file//Users/.../repo`, JetBrains uses `idea://open?file=/path` / `webstorm://open?file=/path` / `pycharm://open?file=/path` / `rider://open?file=/path`. Xcode: `open -a Xcode /path` (it has no scheme).
- **Editors (CLI fallback):** `code`, `cursor`, `zed`, `idea`, `subl`, `xed` — but these require shell PATH which Electron's spawned shells often lack. Resolve full paths via `which` lookup at first run and cache.
- **Terminals:** Terminal.app accepts `open -a Terminal /path`. iTerm2 uses an AppleScript bridge (`osascript -e 'tell app "iTerm" to ...'`) for proper "new window in directory". Warp registered `warp://action/open_path?path=...` in 2024. Ghostty: `open -a Ghostty /path` opens, but to cd you must inject a startup command via env. Alacritty/Kitty: `alacritty --working-directory /path`, `kitty --directory /path`. Build a `terminalProfiles` table; let the user pick a default and per-repo overrides.
- **Claude Code:** spawn `claude` with `cwd: repoPath`, optionally piping in an initial prompt via `--prompt` or stdin. Capture stdout/stderr for a "session is running" indicator. Better UX is to open Claude Code in the user's chosen terminal: build the command line (`cd /path && claude`) and dispatch to `LauncherService.openInTerminal(repo, { command })`.
- **Finder:** `shell.showItemInFolder(repoPath)` or `shell.openPath(repoPath)`.
- **Copy path:** `clipboard.writeText`.
- **Open remote in browser:** parse `git remote get-url origin`, normalize SSH → HTTPS, `shell.openExternal(url)`.

**UX:** A row of small icon buttons on every repo card, plus a `⏎` (enter) menu in the detail view, plus a Cmd-K command for each. Detect which editors/terminals are installed (`/Applications/Visual Studio Code.app` exists?) and only show those — clean UI, no JetBrains-Toolbox-style "11 IDEs you don't have."

**Prior art notes:** JetBrains Toolbox nails the "I have 12 versions of WebStorm installed" case; Warp Drive's launch configurations are the closest analogue to what you want — multi-step "open these 3 apps in this layout" macros. Steal the "Launch Configuration" abstraction: a named, repo-bound recipe of actions. Alfred workflows have done this pattern for over a decade (the "trigger N actions from one keyword" workflow), and they're a useful reference for the data shape — a workflow is fundamentally `{ trigger, actions[], variables }`. Borrow that schema even if you don't expose it as scriptable user-extensibility yet.

### 5.4 Claude Code integration — go deep
This is the biggest differentiator. Claude Code stores everything in plain JSONL on disk; nobody else has built a great viewer for it.

**What's in `~/.claude/`:**
- `~/.claude/projects/<project-hash>/<session-id>.jsonl` — full transcripts (one event per line: user messages, assistant messages, tool calls, tool results). The `<project-hash>` is computed from the absolute project path.
- `~/.claude/projects/<project-hash>/session-memory/summary.md` — auto-extracted summaries that drive cross-session memory.
- `~/.claude/todos/<session-id>-*.json` — TodoWrite task lists.
- `~/.claude/history.jsonl` — global command/prompt history.
- `~/.claude/shell-snapshots/` and `~/.claude/backups/` — non-cleanup paths.
- `~/.claude.json` — the global registry with one entry per project. Cleanup driven by `cleanupPeriodDays` (default 30) for most paths.
- `~/.claude/settings.json` — global settings.
- Per-repo `<repo>/.claude/` — `CLAUDE.md`, `settings.json`, `skills/<name>/SKILL.md`, `agents/`, and `.mcp.json` for MCP servers.

**Mechanics:**
- `ClaudeService.indexProjects()` walks `~/.claude.json` and `~/.claude/projects/`. The mapping from project-hash to repo path is recorded in `~/.claude.json` — read it from there rather than trying to invert the hash.
- For each project, list `*.jsonl` files, parse first/last lines for start/end timestamps without slurping the whole file. Lazy-load full transcripts on demand.
- For each repo, glob `.claude/skills/**/SKILL.md` and `.claude/agents/*.md` and parse YAML frontmatter (name, description) for the skills/agents list.
- Read `.mcp.json` per repo and `~/.claude/settings.json` to compute "effective MCP servers for this project".
- **Token usage:** parse the transcript events; Claude Code emits `usage` blocks (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) on assistant messages. Sum these per session and per project. (Caveat: format is not a stable public schema — gate parsing behind a try/catch and ignore lines you don't recognize.)
- Watch `~/.claude/projects/<hash>/` with chokidar so token totals and "active session" indicators update live while Claude Code runs in another terminal.

**UX:**
- **Claude tab in repo detail view:**
  - Top: CLAUDE.md preview (markdown, rendered, with "edit" button that opens it in your editor).
  - Skills list: cards for each `SKILL.md`, click to preview.
  - Agents: same treatment.
  - MCP servers: list with status (configured / installed / running — last derived from process list).
  - Sessions table: session ID, started, last activity, message count, token total ($ estimate), "open in terminal at this point" (uses `claude --resume <session-id>` from this repo).
  - "Launch Claude Code" button at top, with optional starter prompt text area; respects the user's default terminal.
- **Global Claude view** (sidebar item): rolled-up token usage by week, month, by project, with sparklines. Lightly inspired by the GitHub contributions calendar but flipped to a token-cost heat map.

**Why no one has built this well:** community tools like Mantra and ClaudeFast's Code Kit exist but are CLI-shaped or paywalled. A polished native panel that surfaces *this* repo's Claude state alongside your dev server status is a unique-to-you experience.

### 5.5 Git deep view per repo
**What:** Beyond branch + last commit, show stash, recent commits with graph, ahead/behind, worktrees, submodules, dirty file preview.

**Mechanics:** Keep `simple-git` as the workhorse; it shells out to system `git` which is fine. For high-frequency status, prefer `git status --porcelain=v2 --branch -uall` (single call, parseable, includes ahead/behind). Worktrees: `git worktree list --porcelain`. Submodules: `git submodule status --recursive`. Diff previews: `git diff --stat HEAD` for the panel; on click, `git diff <file>` lazy-loaded into a Monaco-based diff viewer in the renderer (lazy import Monaco only when the diff tab is opened — saves ~3 MB on cold start).

If you want raw speed for the catalog scan, look at **isomorphic-git** for read-only metadata (no shell-out overhead, ~10× faster for batch operations on many repos). Use simple-git for write paths.

**UX:** Borrow GitButler's left-rail compact branch list and Sourcetree's status icons. Don't try to be Tower — write/merge/rebase UIs are a swamp, and you already have VS Code/Cursor for that. Aim for **read-deep, write-shallow**: easy commit/stash/checkout-switch, but defer rebase/merge to the user's editor.

### 5.6 Dependency intelligence
**What:** Per repo, list installed deps with version, outdated status, vuln count, licenses. Cross-repo, answer "which 12 repos use React 18?".

**Mechanics:**
- Parse lockfiles in main: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` (use bun's CLI to dump), `Cargo.lock`, `go.sum`, `requirements.txt` + `poetry.lock` + `uv.lock`, `Gemfile.lock`, `composer.lock`, `pubspec.lock`. Normalize into a `repo_dependencies(repo_id, ecosystem, name, version, is_direct, license)` table.
- Outdated detection: avoid running `npm outdated` (slow, network). Instead, query npm registry via batched `/v1/packages/by-package-name/<name>` or use the official `pacote` library directly to fetch latest versions. Cache in `dep_versions_cache(name, ecosystem, latest, fetched_at)` with a 24h TTL. For Cargo, use crates.io's `/api/v1/crates/<name>` JSON.
- Vuln scanning: shell out to **OSV-Scanner** (`osv-scanner -r --json <repo-path>`). It supports every ecosystem above and runs in seconds; cache results keyed on the lockfile's hash. Trivy is an alternative but heavier. `npm audit`/`yarn audit` are ecosystem-locked and noisier — skip them.
- Licenses: most lockfiles include license fields directly; for the ones that don't, fetch alongside the version query.

**UX:**
- Repo detail "Deps" tab: a flat sortable table with columns *name / current / latest / Δ / license / 🛡️ vulns*. Rows colored by severity. Filter chips: *outdated*, *critical*, *direct only*.
- Global "Deps explorer" view: type "react" → list of every repo using it, with version distribution as a tiny bar chart per major version. This is what makes the multi-repo manager genuinely better than per-repo tools.

### 5.7 Activity & history
**What:** Per-repo timeline: last opened, last commit, last scan, last dev server start. Calendar heatmap per repo and globally.

**Mechanics:** A `repo_events(repo_id, kind, ts, payload_json)` table. Insert on every IPC action that touches a repo. Watchers emit `file_change` events (debounced 5s per repo). Calendar heatmap is just a SQL group-by-day query rendered with a small custom component (don't pull in d3 for this — 30 colored squares is hand-rolled SVG).

**UX:** GitHub-style heatmap squares in the repo card hover state; clicking a square filters the timeline. Inspired by Linear's "Updates" feed and Arc's pinned-tab activity dots.

### 5.8 Quick switcher / Spotlight palette
**What:** Two things, often confused:
1. **In-app Cmd-K palette** — fuzzy-find repos & actions, scoped to the current window.
2. **Global hotkey spotlight** — Cmd-Shift-Space (configurable) summons a Raycast-shaped frameless window from anywhere.

**Mechanics:**
- In-app: use **cmdk** (the shadcn-compatible command primitive). Actions registered in a central registry (`actions/registry.ts`) with id, label, shortcut, icon, scope, handler. The same registry also feeds the native menu and the global spotlight.
- Global hotkey: `globalShortcut.register('CommandOrControl+Shift+Space', () => spotlight.toggle())`. **macOS Accessibility caveat:** pure `globalShortcut` no longer triggers the system Accessibility prompt for unsigned-but-not-input-monitoring uses on recent macOS, but you should still test post-signing; some users will need to grant Input Monitoring if they install hotkey-conflict-resolution tooling. Document this clearly in onboarding.
- Spotlight window: `frame: false`, `transparent: true` (with `vibrancy: 'sidebar'` for the macOS blur), `alwaysOnTop: true`, `skipTaskbar: true`, `show: false`. On invoke, position via `screen.getCursorScreenPoint()` to put it on the current display, centered horizontally, ~25% from top. Restore focus to the previous app on `blur` (`Menu.sendActionToFirstResponder('hide:')`).
- Fuzzy search: **uFuzzy** for the win — sub-ms search across 1000s of items, smaller than Fuse, better ranking than Fzf.

**UX:** Spotlight starts in repo-search mode. Type to filter; arrow keys to navigate; ⏎ opens default action; ⌘⏎ opens secondary; `>` to switch into action-search mode (Raycast pattern). Top result shows live status badges (port, dirty, last opened). Behavior should mirror Raycast so closely that the muscle memory transfers.

### 5.9 Project notes / scratchpad
**What:** Per-repo markdown notes; quick-capture from menu bar without opening the app.

**Mechanics:** Store notes in `~/Library/Application Support/AllTheRepos/notes/<repo-id>.md` (a single file per repo, version-trackable). Also optionally write a copy to `<repo>/.alltherepos/notes.md` (gitignored by default; the user can choose to commit). This dual-store gives you "follow me to a new laptop via the app database" and "live with the repo" simultaneously.

**UX:** Notes tab is a Monaco editor in markdown mode with live preview side-by-side. Quick-capture from the tray pops a tiny 400×300 window pre-targeted at "Inbox" (a virtual repo, or the most-recently-opened one). Inspired by Cron/Notion Calendar's quick-add pattern.

### 5.10 Smart suggestions & health scoring

**Suggestions engine:** runs on app idle, surfaces 3–5 cards on the home view.

Suggestion rules (start with these, learn what's useful):
- "8 repos untouched 6+ months" — candidates to archive.
- "3 repos have uncommitted changes from yesterday" — risk of losing work.
- "This repo has 47 outdated deps and 3 critical CVEs."
- "You've opened repo X in Claude Code 5 days in a row — pin it?"
- "Branch `feature/x` in repo Y is 23 commits behind main."

**Health score (0–100):** transparent additive points so you can debug the score per repo.

| Signal | Points |
|---|---|
| README.md present | +10 |
| LICENSE present | +5 |
| Tests directory or test script in package.json | +15 |
| Recent commit (≤30d) | +15 |
| No uncommitted changes | +10 |
| Outdated direct deps < 25% | +15 |
| Zero critical vulns | +15 |
| CI config present (.github/workflows, etc.) | +10 |
| `.claude/CLAUDE.md` present | +5 |

Show the score as a small ring on the repo card with a tooltip that breaks down the contributors.

### 5.11 Tagging evolution — LLM auto-categorization
**Mechanics:** A background job in `JobQueue` reads README.md + top-level file listing + `package.json` description for each repo, sends to Ollama (`llama3.2:3b` is plenty for tagging) or OpenAI, prompts for a small fixed taxonomy (web-app, library, cli, learning, experiment, prod, archived). Store as `repo_tags(repo_id, tag, source='llm', confidence)`. The user can confirm/edit. Re-runs only when README hash changes.

**Visual organization:** add a **Board view** (kanban with columns = groups or tags), and a **Hierarchical view** (tree by directory ancestry of the repo path — surprisingly useful for "all repos under `~/work/clients/acme/`"). Don't try to invent new metaphors; copy what Linear does for "List / Board / Timeline" toggles.

### 5.12 Backup, snapshots, themes, density
- **Snapshots:** `app:export` writes the entire `~/Library/Application Support/AllTheRepos/` (SQLite + LanceDB + notes) to a `.tar.zst` with a manifest. Schedule a daily silent snapshot to `~/Library/Application Support/AllTheRepos/snapshots/`, keep last 7.
- **Themes:** Tailwind 4's `@theme` directive makes this near-trivial. Ship 4 themes: *OLED black* (current), *Slate dark*, *Light*, *High-contrast*. Custom accent: a single CSS var (`--accent`) overridable in settings.
- **Density:** `compact | comfortable | spacious` controls Tailwind class swaps via a Zustand store; persisted to settings JSON.
- **Keymaps:** ship Linear-style defaults; expose a settings panel that's literally the action registry rendered as `<input>` capture rows.

---

## 6. macOS-Specific Capabilities

| Capability | Recommendation |
|---|---|
| **Menu bar / Tray** | `Tray` with a template image (transparent PNG, 22×22 @2x). Click opens a quick popover (use a hidden BrowserWindow positioned next to `tray.getBounds()`, not the built-in menu — the popover lets you render React: list of running dev servers, recent repos, quick capture). |
| **Global hotkey** | `globalShortcut.register` for spotlight. Default ⌘⇧Space, configurable. Detect conflicts with macOS Spotlight at first launch and prompt to remap. |
| **Notifications** | `new Notification({ title, body, silent, actions })`. macOS natively styles these. Use `actions` for "Kill server" / "Open repo" buttons. |
| **Dock badge** | `app.dock.setBadge(String(runningDevServers.length))`. Clear when zero. |
| **URL scheme** | Register `alltherepos://` in `electron-builder.yml` → `mac.protocols`. Handle `app.on('open-url')` to route `alltherepos://repo/<id>` and `alltherepos://action/<name>`. |
| **Quick Look** | Skip — Quick Look extensions require a separate signed XPC bundle; not worth the complexity. Use a side-panel preview inside the app instead. |
| **Services menu** | Optional. Register a `NSServices` entry via Info.plist for "Open in AllTheRepos" on a folder. Defer to later phases. |
| **Touch Bar** | Skip. Touch Bar is dead — last Touch Bar MBP shipped 2021, current Macs don't have it. |
| **macOS Tahoe (26) considerations** | Tahoe's new Liquid Glass material is exposed via vibrancy options Electron passes through to `NSVisualEffectView`. Use `vibrancy: 'fullscreen-ui'` or `'sidebar'` on the spotlight window for the right blur. Tahoe also tightened FSEvents behavior — make sure to claim a Full Disk Access exemption only if scanning paths outside the user's home; otherwise normal home-dir scans require no special permissions. |
| **Code signing** | Developer ID Application cert (not Mac App Store — you'd lose the ability to ship anything that calls `lsof` or `osascript`). Cert in macOS Keychain locally; base64-encoded `.p12` in GitHub Secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`) for CI. |
| **Notarization** | `@electron/notarize` with an App Store Connect API key (not app-specific passwords — keys don't expire when you change your Apple ID). Stapler runs automatically inside electron-builder's afterSign hook. Plan for ~3–8 min added to CI. |
| **Entitlements** | `hardenedRuntime: true`, `entitlements.mac.plist` with `com.apple.security.cs.allow-jit` (required for Electron) and `com.apple.security.cs.allow-unsigned-executable-memory` only if you ship Electron <12 (you won't). |

---

## 7. Data Architecture

### Keep what works
- **SQLite via better-sqlite3 + Drizzle** — keep. The synchronous API is *correct* for a single-threaded service in a single-user desktop app; you don't need async overhead. FTS5 is excellent.
- **LanceDB** — keep. It's embedded, file-based, no daemon, has stable Node bindings, and your existing nomic-embed-text pipeline works as-is. LanceDB's columnar Lance format also gives you free "time travel" (versioned tables) you might use later for snapshot/diff.

### What to change
- **Move data location.** Current `~/.alltherepos/` is fine for a localhost project but the macOS-blessed location is `~/Library/Application Support/AllTheRepos/`. Use `app.getPath('userData')` to discover it; on first run, if `~/.alltherepos/` exists, migrate (copy then write `MIGRATED` flag) and symlink the old location back for CLI muscle memory.
- **Don't switch to DuckDB or sqlite-vss.** Each would be a tempting "one DB" play, but: DuckDB lacks FTS5-quality full text and isn't really meant for the read-heavy/single-writer pattern you have; sqlite-vss is solid but its packaging story in Electron is worse than LanceDB's (more `.dylib` unpacking gymnastics). libSQL/Turso would only matter if you wanted sync, which is explicitly out of scope.
- **Don't switch to pglite.** It's brilliant tech, but Postgres semantics buy you nothing here.

### Packaging the native modules
Both better-sqlite3 and LanceDB ship platform-specific `.node` binaries. In electron-builder, asar must unpack them or the dynamic loader can't `dlopen` them at runtime:

```yaml
# electron-builder.yml
asar: true
asarUnpack:
  - "**/node_modules/better-sqlite3/**"
  - "**/node_modules/@lancedb/**/*.node"
  - "**/node_modules/@lancedb/**/*.dylib"
npmRebuild: true
```

In `package.json`:
```json
"scripts": {
  "postinstall": "electron-rebuild -f -w better-sqlite3"
}
```
(For LanceDB, the published `@lancedb/lancedb-darwin-arm64` packages are prebuilt — they don't need `electron-rebuild`, just `asarUnpack`.)

### File-system watcher strategy at 1000+ repos
- Use chokidar v4+ (it dropped 12 of its 13 deps and bundles fsevents natively on macOS — much smaller install, ESM-only, Node 20+).
- **Don't watch inside every repo.** That's tens of thousands of watches and `.git/objects` chatter that hammers FSEvents. Instead:
  - Watch only the parent directory of each repo (one watch per repo) with `depth: 1, ignoreInitial: true, ignored: ['.git', 'node_modules', 'dist', '.next', 'target', '.venv']`.
  - For the "is this repo dirty" signal, run a debounced `git status --porcelain` on receiving any event in that repo (cheap, cached).
  - For **active** repos (currently focused in the UI), increase to `depth: 3` to catch most edits without descending into `node_modules`.
- Coalesce events through a 200ms debouncer per repo, then emit a single `repo:changed` IPC event with the changed kinds (`workdir`, `index`, `head`).
- On modern macOS, FSEvents coalesces aggressively under memory pressure — add an `awaitWriteFinish: { stabilityThreshold: 500 }` to avoid half-written-file events.

### State management in renderer
- **Server state:** TanStack Query, no debate. The cache invalidation, background refetch, and `useQuery({ subscribed: true })` patterns map perfectly onto IPC events (each main-process event becomes a `queryClient.invalidateQueries`).
- **UI state:** Zustand for the bits you actually need globally (sidebar collapse, density, active tab, spotlight open). Don't pull in Redux Toolkit — Zustand is 1 KB and you'll never miss the rest.
- **Forms:** react-hook-form + Zod (the same schemas you use at the IPC boundary).
- **Routing:** TanStack Router file-based. Type-safe params, code-split routes, doesn't fight Electron's `file://` protocol the way Next.js does.

### Background job/queue
For embedding generation, repo scans, vuln scans — you need a single in-process queue with concurrency limits, retry, and pause-on-low-battery. Don't pull in Redis. Use **p-queue** (300 LOC, well-trusted) with a tiny SQLite-backed durability layer (one `jobs(id, kind, payload_json, status, attempts, scheduled_at)` table) so jobs survive app restarts.

---

## 8. Tech Stack (versions current as of May 2026)

| Concern | Choice | Version | Rationale |
|---|---|---|---|
| Runtime shell | **Electron** | 36.x stable | Ships Chromium 132+, Node 22. Stay on stable, never on beta for an everyday tool. |
| Build tool | **electron-vite** | 3.x | Vite for renderer, esbuild for main/preload, HMR everywhere, monorepo-ready. The `@quick-start/electron` template is the cleanest starting point. |
| Packager | **electron-builder** | 26.x | More mature DMG/zip/auto-update story than Forge; Forge is great but its Vite + native-module + electron-updater story still has rough edges per several 2025 post-mortems. Builder's `asarUnpack` syntax is also easier for the LanceDB case. |
| UI framework | **React** | 19 | You already use it; Server Components irrelevant in Electron. |
| Styling | **Tailwind** | 4.x | Already in use. `@theme` directive makes multi-theme trivial. |
| Components | **shadcn/ui** | latest | Already in use; copy-paste philosophy fits Electron well. |
| Routing | **TanStack Router** | 1.x | File-based, type-safe, no SSR baggage. |
| Server state | **TanStack Query** | 5.x | Pairs natively with IPC events for invalidation. |
| UI state | **Zustand** | 5.x | Tiny, no provider hell. |
| Command palette | **cmdk** | latest | Shadcn-blessed primitive, accessible. |
| Fuzzy search | **uFuzzy** | 1.x | Best-in-class for size+speed. |
| Forms | **react-hook-form** + **Zod** | latest | Same Zod schemas guard IPC. |
| Charts | **Visx** or hand-rolled SVG | — | Avoid Chart.js bloat; you have ~6 chart types and they're all simple. |
| Editor (notes/diffs) | **Monaco** | latest | Lazy-loaded, only when a markdown/diff tab opens. |
| Markdown render | **react-markdown** + **remark-gfm** + **shiki** | latest | shiki for syntax highlighting via WASM; no themes engine fight. |
| DB | **better-sqlite3** + **Drizzle** | latest | Already in use; sync API is right for main-process. |
| Vector | **LanceDB** | 0.x (Node) | Already in use; prebuilt darwin-arm64 binaries. |
| File watch | **chokidar** | 5.x | ESM-only, single dep, bundled fsevents. |
| Git | **simple-git** for writes, **isomorphic-git** for read-heavy scan | latest | Speed where it matters, correctness for writes. |
| HTTP | native `fetch` | Node 22 | No need for axios/got. |
| Job queue | **p-queue** + sqlite durability | latest | In-process; no Redis. |
| Updater | **electron-updater** | 6.x | Delta updates on macOS via Squirrel.Mac; GitHub Releases as feed. |
| Code sign | **@electron/osx-sign**, **@electron/notarize** | latest | First-party Electron packages; supported by electron-builder. |
| Testing — unit | **Vitest** | 2.x | Fast, ESM-native, matches Vite. Plays nicely with your QE instincts — services are plain TS classes and trivially unit-testable. |
| Testing — E2E | **Playwright** (`@playwright/test`) | 1.5x | Has first-class Electron driver (`_electron.launch`). Spectron is dead since 2022; WDIO is heavier. Given your day job at Tricentis, you'll find Playwright's tracing + selector strategies feel familiar territory. |
| Linting | **Biome** | 2.x | Replaces ESLint+Prettier with one config + one binary; massive speedup in CI. |
| Logging | **electron-log** | latest | Writes to platform-correct location; rolling files. |
| Env / settings | **electron-store** | 10.x | Single-user JSON settings; encrypted option for tokens. |

---

## 9. Phased Build Plan

Each phase is sized to a long weekend or two. Each ends with a usable, committable state.

### Phase 0 — Scaffold & migration ground-truth (1–2 days)
- `npm create @quick-start/electron@latest alltherepos -- --template react-ts`
- Strip the example UI; install Tailwind 4, shadcn primitives you already use, fonts.
- Set up `src/shared/` with Zod schemas for `Repo`, `Group`, `Tag`, `ScanEvent`.
- Wire one trivial IPC end-to-end (`ping → pong`) to validate the preload pattern.
- Set up Vitest + Playwright; one passing E2E test that opens the window.
- Configure electron-builder for a local dev DMG build (unsigned is fine here).

**Deliverable:** Empty window with your fonts, your theme, and a working IPC ping.

### Phase 1 — Feature parity with the current localhost app (1–2 weeks)
- Port the catalog tables and Drizzle migrations; move the SQLite file to `app.getPath('userData')`.
- Port the scanner: `find-git-repositories` runs in a worker thread; results streamed back as NDJSON-shaped IPC events.
- Port the tag-detector heuristics 1:1.
- Port hybrid search (FTS5 + LanceDB) behind `window.atr.catalog.search(q)`.
- Port the three-column UI verbatim from Next.js components.
- Port keyboard shortcuts (`/`, `j/k`, `enter`, `esc`, `g s`).
- Migration script: if `~/.alltherepos/` exists, copy & symlink.

**Deliverable:** Visually identical to the Next.js app, no browser involved.

### Phase 2 — Native desktop shell (3–5 days)
- Tray icon + popover window with recent repos + running servers placeholder.
- Global hotkey + Spotlight window with cmdk + uFuzzy over the catalog.
- Native menu with the actions registry.
- macOS Notifications wired (toast on scan complete, etc.).
- `alltherepos://` URL scheme; handle `repo/<id>` deep links.
- Dock badge for running-server count.

**Deliverable:** Feels like a real Mac app. Hotkey works from anywhere.

### Phase 3 — Deep integrations (1–2 weeks)
- ProcessService with lsof polling + cwd-to-repo matching + kill flow.
- LauncherService with editor/terminal detection and URL-scheme dispatch.
- ClaudeService: parse `~/.claude.json`, `.claude/projects/*.jsonl`, per-repo `.claude/` skills + MCPs.
- Claude tab in the detail view; global Claude usage panel.
- Per-repo Git deep view (branches, stashes, recent commits, ahead/behind).

**Deliverable:** The app does things no other tool does — running dev servers per repo, full Claude Code visibility, deep Git read.

### Phase 4 — Intelligence layer (1–2 weeks)
- Dependency parsing for all major lockfiles.
- OSV-Scanner integration with caching.
- Health score calculation + ring UI.
- Smart suggestions cards on home view.
- LLM auto-tagging (Ollama-first, OpenAI fallback) as a background job.
- Activity timeline + heatmap.

**Deliverable:** The app becomes opinionated. It tells you things.

### Phase 5 — Polish & distribution (1 week)
- Multi-theme support (OLED, Slate, Light, High-contrast).
- Density modes, custom keymaps, settings UI.
- Snapshots / export-import.
- Code signing + notarization via GitHub Actions on tag push.
- electron-updater with GitHub Releases feed.
- Onboarding window for first-run: scan path selection, default editor, default terminal, hotkey.
- DMG with branded background image, custom installer layout.

**Deliverable:** A `.dmg` you'd happily put on a public release page.

### Phase 6 (optional later) — Cross-platform & advanced
- Linux build, Windows build, port lsof to `ss`/`Get-NetTCPConnection`.
- Worktree support, submodule UI.
- Plugin/extension API (mini-Raycast-style; future).
- Multi-machine sync (Turso-backed; explicitly out of scope per your brief, but architecture supports it because services are pure).

---

## 10. Risks, Gotchas, Mitigations

| Risk | Mitigation |
|---|---|
| **better-sqlite3 NODE_MODULE_VERSION mismatch** in packaged build | `postinstall: electron-rebuild -f -w better-sqlite3`; `asarUnpack: '**/node_modules/better-sqlite3/**'`; CI builds matrix locks Node version to the one Electron expects. |
| **LanceDB `.node`/`.dylib` not loadable from asar** | Explicit `asarUnpack` entries; verify with `find ./out/AllTheRepos-darwin-arm64/AllTheRepos.app -name "*.node"` after packaging. Daniel Corin's public post-mortem on Delta showed exactly this failure mode — copying `*.node` and `*.dylib` files via a `packageAfterCopy` hook is the proven escape hatch if asarUnpack alone misses something. |
| **App size bloat (200+ MB)** | Use `electron-builder` with `removePackageScripts: true`, `removePackageKeywords: true`. Strip dev dependencies from the bundle (the electron-vite template gets this right by default — only `dependencies` ship). Defer loading Monaco/shiki/Ollama embedding worker until first use. Don't bundle the OpenAI SDK; use `fetch` directly. Target <120 MB final DMG. |
| **Scan performance on 1000+ repos** | `find-git-repositories` runs in a worker; scanner streams results; renderer renders incrementally; embeddings deferred to background queue with battery-aware throttling. |
| **FSEvents exhaustion / high CPU on Mac** | Don't watch inside repos by default; watch parent dirs at depth 1; `awaitWriteFinish`; consult `getWatched()` size during dev. Cap total active watchers at ~2000. The VS Code team has documented FSEvents going haywire on >2 GB folders — your watcher boundaries above neutralize this. |
| **Multi-window state sync** | Main process is the single source of truth. Use `webContents.getAllWebContents().forEach(wc => wc.send(...))` for broadcast; renderers always re-query through TanStack Query on receipt rather than trusting the payload. |
| **lsof permission errors** | lsof works as the user for the user's own processes. Don't request elevated permissions; just hide system processes. Document in onboarding that "we never ask for sudo." |
| **Claude Code JSONL format changes** | The transcript format is not a public contract. Wrap every parse in try/catch; ignore unknown event types; gate features behind feature flags; pin a "tested against Claude Code vX.Y" badge in settings so you know what you've validated. |
| **Spotlight hotkey conflicts with system Spotlight** | First-launch detection: if `globalShortcut.isRegistered('CommandOrControl+Shift+Space')` after registering returns false, prompt to remap. Ship default of `Cmd+Shift+R` if conflicts persist (R = Repos). |
| **Code signing flakiness in CI** | Use App Store Connect API keys, not app-specific passwords (the latter rotate when Apple ID password changes). Cache notarization across builds via stapler. Budget 75 notarizations/day Apple limit. |
| **Updater bricking** | Always ship a "Check for updates" menu item that runs a manual check; never auto-install without user OK on first major version; sign the update channel and verify SHA512 in `latest-mac.yml`. |
| **macOS Tahoe vibrancy API drift** | Tahoe's Liquid Glass changed how some vibrancy values render; check `BrowserWindow.setVibrancy('fullscreen-ui')` is honored on your version; fall back to a solid blurred SVG background if absent. |
| **Prior-art mistakes worth avoiding** | Don't write your own type-safe IPC framework (multiple Electron post-mortems on this — you'll spend weeks for marginal gains). Don't ship Spectron tests (deprecated 2022); use Playwright's `_electron`. Don't enable `nodeIntegration` "just for the prototype" — it always ships. Don't store secrets in `electron-store` without `encryptionKey`. Don't try to be Tower; ship read-deep, write-shallow Git. |
| **Comparable projects to study** | **GitButler** (Tauri, but their UI/UX patterns for branch lists and design tokens are gold), **Lapce** (Rust-based editor with a beautiful command palette), **Coder/code-server** (electron-ish bundling for VS Code), **Replit Desktop** (Electron, good multi-window patterns), **Linear's desktop app** (Electron, ship the polish bar), **`cawa-93/vite-electron-builder`** (boilerplate to read end-to-end). |

---

## 11. Inspirational UX Patterns to Steal

| Source | Steal this |
|---|---|
| **Linear** | The List/Board/Timeline view-toggle; the "Updates" feed; the inline-everywhere keyboard menus; the "C" to create from anywhere muscle memory. |
| **Raycast** | The Cmd-K UX (sub-frame, fixed-height list, footer hotkeys). The "actions" submenu pattern (Cmd-K inside the result). The script-command concept for power users. |
| **Alfred** | The workflow data shape (`{ trigger, actions[], variables }`) as the abstraction for repo-bound launch recipes — even before exposing user scriptability. |
| **Warp** | The "command blocks" output framing — apply this to scan logs and Claude Code transcripts. Warp Drive's "Launch Configurations" — copy as "Repo Recipes." |
| **Notion Calendar / Cron** | Quick-capture from menu bar with smart targeting. Keyboard-only event creation flow. |
| **Arc Browser** | Spaces (apply as "Workspaces" — saved filter sets across repos with their own sidebar color). The "live folders" pattern for smart groups. The peek-on-hover for sub-items. |
| **JetBrains Toolbox** | Multi-version IDE detection and per-project default IDE memory. |
| **Orbstack** | The clean process list with sortable columns and inline action affordances. The status pill design. |
| **GitButler** | The compact branch list with stack visualization; reactive design tokens system based on CSS custom properties — Tailwind 4's `@theme` lets you copy this nearly verbatim. |
| **TablePlus** | The "everything is one click, nothing pops a modal" interaction philosophy for the deps explorer. |
| **macOS System Settings (post-Ventura)** | Settings IA: sidebar of categories + main panel; do NOT invent your own settings layout. |

---

## 12. Appendices

### Appendix A — Comparison table of existing tools

| Tool | Strength to copy | Weakness to fix |
|---|---|---|
| GitKraken | Branch graph visual | Heavy, slow startup, $$$ |
| Sourcetree | Free, status icons | UI is dated, Atlassian-y |
| Fork | Fast native, clean | Single-repo focus |
| Tower | Best write-side Git UX | Single-repo, $$$ |
| GitHub Desktop | Onboarding | Shallow features, no multi-repo |
| Lazygit / Tig | Keyboard-everything | TUI-only |
| Working Copy (iOS) | Mobile multi-repo | iOS-only, not desktop relevant |
| Repo Prompt | Claude-Code-adjacent file selection | Narrow feature scope |
| JetBrains Toolbox | Multi-IDE management | Only IDE-launching, no Git/process |
| VS Code "Recent" | Frictionless | One-dimensional list |
| Cursor project picker | Same | Same |
| Warp Drive | Launch Configurations | Terminal-bound |
| Raycast Project Mgmt extensions | Quick launch | Plugin quality varies; no deep Git |
| Alfred workflows | Trigger-action data shape | Mac-only, scripting required |
| Laravel Herd | Polished local-dev mgr | PHP-only |
| Local by Flywheel | Per-site env mgmt | WordPress-only |
| MAMP | Decades of muscle memory | UI is from 2011 |
| DDEV / Lando | Docker-based isolation | Heavy, container-overhead |
| Orbstack | Beautiful process/container list | No repo concept |
| Docker Desktop | Familiar | Slow, no repo concept |
| Hyper terminal | Plugin model | Just a terminal |
| Mantra | Claude Code session viewer | Standalone, no repo integration |

### Appendix B — Essential Electron resources

- **Electron Security Checklist** — electronjs.org/docs/latest/tutorial/security (run through this every release).
- **Electron Forge / Builder docs** — for whichever you choose (recommendation: Builder).
- **electron-vite** — electron-vite.org (template + config reference).
- **electron-builder** — electron.build (DMG, code-sign, asarUnpack).
- **@electron/notarize** — github.com/electron/notarize (notarization).
- **electron-updater** — github.com/electron-userland/electron-builder/tree/master/packages/electron-updater (auto-updates).
- **Awesome Electron** — github.com/sindresorhus/awesome-electron (curated list).
- **cawa-93/vite-electron-builder** — a battle-tested boilerplate worth reading end-to-end.
- **electron-toolkit/utils** — useful main-process helpers (`is.dev`, `electronApp.setAppUserModelId`, etc.).
- **Strongly Typed: Building Electron + Next.js** — stronglytyped.uk article with a particularly clean preload pattern.
- **danielcorin.com/posts/2024/challenges-building-an-electron-app/** — honest post-mortem of better-sqlite3 + Electron pain.
- **Hyper.media's "The Case Against electron-trpc"** — read before reaching for electron-trpc.
- **omkarcloud/macos-code-signing-example** — working GitHub Actions reference for sign+notarize+S3 publish.

### Appendix C — macOS APIs / capabilities to use

| API | Module | Use case |
|---|---|---|
| `Tray` | electron | Menu bar item |
| `globalShortcut` | electron | Spotlight hotkey |
| `BrowserWindow({ vibrancy, transparent, frame: false })` | electron | Spotlight window blur |
| `app.dock.setBadge` | electron | Running-server count |
| `Notification` | electron | Native toasts |
| `shell.openExternal` / `shell.showItemInFolder` | electron | Finder / browser launching |
| `app.setAsDefaultProtocolClient('alltherepos')` | electron | Deep links |
| `app.on('open-url')` | electron | URL handling |
| `nativeTheme.shouldUseDarkColors` | electron | System theme follow |
| `systemPreferences.getMediaAccessStatus` | electron | Permission checks |
| `powerMonitor.on('suspend' / 'resume')` | electron | Pause watchers/embeddings |
| `screen.getCursorScreenPoint` | electron | Multi-display spotlight positioning |
| `app.setLoginItemSettings` | electron | "Launch at login" toggle |
| `app.requestSingleInstanceLock` | electron | Singleton enforcement |
| `MenuItem({ role: 'appMenu' })` etc. | electron | Native menu structure |
| `dialog.showOpenDialog` | electron | "Add repos from folder" picker |
| `safeStorage.encryptString` | electron | OpenAI API keys at rest |
| `child_process.spawn('lsof', ...)` | node | Port detection |
| `child_process.spawn('osascript', ...)` | node | iTerm2 / Terminal control |
| `clipboard.writeText` | electron | Copy path action |
| FSEvents via chokidar | npm | File watching |
| `NSVisualEffectView` via `vibrancy` | electron | Tahoe Liquid Glass |
| `Hardened Runtime` | electron-builder | Required for notarization |
| `com.apple.security.cs.allow-jit` | entitlements | Required for Electron's V8 |
| `com.apple.security.cs.disable-library-validation` | entitlements | Required when loading unsigned dylibs (LanceDB prebuilds) |

### Appendix D — Critical configuration snippets

**`electron-builder.yml`:**
```yaml
appId: com.alltherepos.desktop
productName: AllTheRepos
directories:
  output: release
  buildResources: resources
files:
  - out/**/*
  - package.json
asar: true
asarUnpack:
  - "**/node_modules/better-sqlite3/**"
  - "**/node_modules/@lancedb/**/*.node"
  - "**/node_modules/@lancedb/**/*.dylib"
  - "**/node_modules/fsevents/**"
npmRebuild: true
mac:
  category: public.app-category.developer-tools
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: resources/entitlements.mac.plist
  entitlementsInherit: resources/entitlements.mac.plist
  notarize: true
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip
      arch: [arm64, x64]
  protocols:
    - name: alltherepos
      schemes: [alltherepos]
publish:
  provider: github
  owner: <your-gh>
  repo: alltherepos
```

**`resources/entitlements.mac.plist`:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><false/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.automation.apple-events</key><true/>
</dict>
</plist>
```

**Auto-update wiring (`main/updater.ts`):**
```ts
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

export function initUpdater() {
  autoUpdater.on('update-available', i => mainWindow.webContents.send('updater:available', i));
  autoUpdater.on('update-downloaded', i => mainWindow.webContents.send('updater:downloaded', i));
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => autoUpdater.checkForUpdates(), 6 * 60 * 60 * 1000);
}
```

**GitHub Actions release workflow (sketch):**
```yaml
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm electron-builder --mac --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
```

**Tray + spotlight wiring sketch (`main/window/tray.ts`, `main/window/spotlight.ts`):**
```ts
// tray.ts
const tray = new Tray(nativeImage.createFromPath(trayIconPath).setTemplateImage(true));
tray.on('click', () => trayPopover.toggle(tray.getBounds()));

// spotlight.ts
spotlight = new BrowserWindow({
  width: 720, height: 480, frame: false, transparent: true,
  vibrancy: 'sidebar', alwaysOnTop: true, skipTaskbar: true, show: false,
  webPreferences: { preload: spotlightPreload, contextIsolation: true, sandbox: true },
});
globalShortcut.register('CommandOrControl+Shift+Space', () => {
  if (spotlight.isVisible()) spotlight.hide();
  else { const p = screen.getCursorScreenPoint(); /* position on that display */; spotlight.show(); }
});
spotlight.on('blur', () => spotlight.hide());
```

---

## 13. Closing Opinions

Three opinions worth internalizing as you start:

1. **The renderer is your web app. The main process is your backend. Stop blurring this.** Every time you're tempted to do file I/O in the renderer for "convenience," resist. The boundary is what keeps the app fast, secure, refactorable — and *testable* (your QE instincts will love that services are pure TS classes with no Electron dependency in their bodies). It's also what lets you rip out React and rewrite the UI in five years without touching the services.

2. **Ship one user (you) extremely well before generalizing.** Every "make it configurable" decision in Phase 0–3 is debt. Hardcode your scan paths, your default editor, your hotkey. Add settings UI only when you find yourself editing constants in code more than once a week. This is what "developer joy over broad market appeal" actually means in practice.

3. **The features that will make this app yours aren't in any single existing tool — they're in the combination.** Nobody else has running-dev-server-per-repo + Claude session history + dependency overlap + Cmd-K palette in one window. The architecture above is engineered specifically so each of those slots in without rearchitecting. Build that combination and you have a tool whose value compounds with every repo you add — which, given your existing catalog, is exactly the use case you're designing for.

Good hunting.