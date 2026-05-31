# AllTheRepos

A local-first hub for the dozens-to-thousands of git repositories on a developer's machine. Two stacks live in this repo while we migrate: the legacy **Next.js** web app at `localhost:3939`, and the **Electron desktop app** (`pnpm electron:dev`) — see [`NEW-PLAN.md`](./NEW-PLAN.md) for the full architecture.

> **👉 Start at [`START-HERE.md`](./START-HERE.md)** for current status and the doc map, then
> [`docs/PLAN.md`](./docs/PLAN.md) (where we are) and [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md) (what's next).

Current state (2026-05-31): Phases 0–2 are structurally complete and Phase 3 (deep integrations) is wired, but several Phase 1–3 surfaces are still stubbed — see [`docs/PLAN.md`](./docs/PLAN.md) for the honest, verified phase-by-phase status. The desktop app boots, the type-safe IPC layer works end-to-end, and the catalog renders against the migrated SQLite + LanceDB from `~/.alltherepos/`.

---

## Prerequisites

- **Node 22+**. Vite 7 calls `crypto.hash()`, which doesn't exist in Node 21.0–21.6 and crashes with `TypeError: crypto.hash is not a function`. An `.nvmrc` is checked in — run `nvm use` (and `nvm install` first time) from the repo root to pick up Node 22 automatically. `engines.node` enforces this at `pnpm install` time.
- **pnpm 9+** (pinned via `packageManager` field).
- **macOS** for `pnpm electron:dist` (DMG output). Other Electron commands work cross-platform.
- **Optional**: Ollama running at `http://localhost:11434` for embedding-based hybrid search. Without it, search degrades to FTS5 only.

> If you ever see `TypeError: crypto.hash is not a function`, your shell is on Node ≤21.6. Run `nvm use` and retry.

---

## Quick start

```bash
nvm use                            # picks up Node 22 from .nvmrc
pnpm install                       # installs both stacks' deps
pnpm electron:dev                  # boots the Electron desktop app
```

The Electron build chains `electron:rebuild` first to compile native modules (`better-sqlite3`, `find-git-repositories`) against Electron's Node ABI. First boot takes ~30s on a clean tree; subsequent boots are fast.

---

## Desktop app (Electron, current focus)

```bash
pnpm electron:dev                  # dev — rebuilds natives, then launches
pnpm electron:build                # produces out/{main,preload,renderer}
pnpm electron:pack                 # DMG output (unsigned, local dev)
pnpm electron:dist                 # DMG output (release config)
pnpm electron:rebuild              # force-rebuild natives for Electron's ABI
```

### Architecture (one-paragraph version)

Three TypeScript codebases share `src/shared/` (types + Zod schemas + IPC channel constants):

- **`src/main/`** — main process. Node services for catalog (Drizzle + better-sqlite3 + FTS5), scan (`find-git-repositories` worker thread), search (FTS + LanceDB hybrid with RRF), git (`simple-git`), settings (atomic-rename JSON store), and groups. Singleton instances; renderer never touches Node APIs.
- **`src/preload/`** — `contextBridge.exposeInMainWorld('atr', ...)`. The renderer talks to the main process through `window.atr.<namespace>.<method>()` only.
- **`src/renderer/`** — Vite + React 19 + Tailwind 4 + shadcn + TanStack Router + TanStack Query + Zustand. Pure web app. 16 components ported verbatim from the Next.js side.

41 IPC channels across 10 namespaces are wired, every one with Zod-validated input AND output and a frame-origin check (see the caveat at ATR-014). See [`contracts/ipc.v3b.md`](./contracts/ipc.v3b.md) (current) and [`contracts/data-layer.v1.md`](./contracts/data-layer.v1.md).

### Routes (TanStack Router, memory history)

| Route          | What it shows                                                           |
| -------------- | ----------------------------------------------------------------------- |
| `/`            | Three-column catalog (sidebar + repo grid + detail panel)               |
| `/repos/$slug` | Standalone repo detail page                                             |
| `/claude`      | Claude Code tab — projects/sessions/usage (empty on real data, ATR-001) |
| `/processes`   | Running dev-server / port detection view                                |
| `/settings`    | Scan paths + ignore globs + provider config                             |
| `/debug`       | Phase 0 ping/pong card — useful when nothing else works                 |

### Data location

- SQLite + LanceDB + settings.json live at `~/Library/Application Support/AllTheRepos/` (i.e., `app.getPath('userData')`).
- On first boot, if `~/.alltherepos/` exists, the legacy DB / Lance dir / notes are **copied** (not moved) and a `MIGRATED` sentinel is written. The source is preserved for muscle-memory CLI access.

---

## Web app (Next.js, legacy)

```bash
pnpm dev                           # http://localhost:3939
pnpm build
pnpm start
```

The Next.js app remains fully functional during the migration. Phase 1 was implemented **additively** — nothing under `app/`, `components/`, or `lib/` was removed.

---

## Testing

```bash
pnpm test                          # vitest (host Node ABI required for native modules)
pnpm test:e2e                      # Playwright against the Next.js dev server
pnpm exec playwright test \
  --config playwright.electron.config.ts   # Playwright against the Electron build
```

Current status (verified 2026-05-31): **746 Electron-side unit tests pass**; the **14 "failures"** you may see are `tests/db|search|git|actions` loading native modules under host-Node while they're built for Electron's ABI (the dual-rebuild dance below) — not regressions. **Zero Electron E2E have actually run** (3 specs blocked on the native-ABI/E2E automation gap, ATR-016/017). `qa-report.json` is a unit-layer gate, not a ship signal — see the caveat in [`docs/PLAN.md`](./docs/PLAN.md).

---

## Known Issues

### The dual-rebuild dance (Phase 1 / Phase 2 work item)

`better-sqlite3` and `find-git-repositories` ship a single set of `.node` binaries. Tests run under host Node (module version 137 on Node 24); Electron runs under its bundled Node (module version 135 for Electron 36). Switching between them requires a rebuild:

```bash
# Before pnpm test, if you just ran electron:dev/build:
pnpm rebuild better-sqlite3 find-git-repositories

# Before pnpm electron:dev, if you just ran pnpm test:
pnpm electron:rebuild              # invokes electron-rebuild -f
```

`pnpm electron:dev`, `electron:pack`, and `electron:dist` chain `electron:rebuild` automatically; no need to run it manually before those. `pnpm install` does **not** rebuild — by design, so default state is test-ready.

Resolving this properly (dual prebuilt binaries, ABI auto-targeting) is a Phase 2 task.

### Phase 1 UX cleanup items (`qa-report.json` LOW issues)

- **Double SearchBar on `/`** — both the top-bar and the catalog-shell mount one. Top-bar binds to Zustand `activeFilter.q`; shell binds to URL search params. Phase 2 will unify the sources.
- **Settings link duplicated** in top-bar + group-sidebar. Cosmetic.
- **`src/renderer/fonts/` ships empty** — Plex/JetBrains Mono `.woff2` files are placeholders (see `src/renderer/fonts/README.md`). Renderer falls back to system fonts. Drop the 6 files in to fix.
- **`repo-detail-content.tsx`'s "Open in VS Code" button** still uses `vscode://file/...` directly instead of routing through `git:openInEditor` allowlist. Phase 2 task.
- **`catalog:smartFilter` is a Phase 1 stub** returning `[]` — real LLM tagging lands in Phase 4.

### Other

- **Scanner test flake on hosts with 1Password GPG signing.** `tests/git/scanner.test.ts` uses `simple-git` to commit in temp repos. If your global `commit.gpgsign = true` runs through 1Password's agent, the commits fail. Workaround: `git config --global commit.gpgsign false` or pass `--no-gpg-sign` in the test (legacy maintenance, not a Phase 1 regression).
- **Carried-over WIP** in `lib/github/client.ts` — early GitHub API integration commit from the prior branch. Untouched by the Electron migration.

---

## Project structure

```
.
├── NEW-PLAN.md                   # 850-line Electron architecture brief
├── README.md                     # you are here
├── package.json                  # both stacks, main field points to out/main/index.js
├── electron.vite.config.ts       # main + preload + renderer build config
├── electron-builder.yml          # DMG packaging
├── tsconfig.json                 # Next.js side
├── tsconfig.node.json            # main + preload + shared + contracts
├── tsconfig.web.json             # renderer + shared + contracts
├── playwright.config.ts          # Next.js E2E
├── playwright.electron.config.ts # Electron E2E
├── vitest.config.ts              # both stacks
├── drizzle/                      # SQLite migrations
├── contracts/                    # IPC v1 + data layer v1 + types + schema
├── app/, components/, lib/       # legacy Next.js code (preserved)
├── src/
│   ├── shared/                   # types + schemas + IPC constants (both processes)
│   ├── main/                     # Node main process
│   │   ├── index.ts              # app boot, single-instance lock
│   │   ├── window/               # BrowserWindow factory
│   │   ├── security/             # CSP + shell.openExternal allowlist
│   │   ├── ipc/                  # 6 namespaces of ipcMain.handle
│   │   ├── services/             # catalog, scan, search, git, settings, etc.
│   │   ├── workers/              # scanner.worker.ts
│   │   └── db/                   # client + schema + queries + migrate + migration
│   ├── preload/                  # contextBridge typed API
│   └── renderer/                 # Vite + React + TanStack
│       ├── routes/               # __root, index, repos.$slug, settings, debug
│       ├── components/           # ui primitives + catalog + groups + search + layout
│       ├── hooks/                # useRepos, useRepo, useSearch, useGroups, etc.
│       ├── stores/               # Zustand: ui, scan
│       ├── lib/                  # cn, atr, query-client
│       └── styles/               # globals.css with Tailwind 4 @theme
├── tests/                        # vitest unit + Playwright e2e
├── scripts/
│   ├── rebuild-natives.mjs       # electron-rebuild -f wrapper
│   ├── notarize.mjs              # placeholder for Phase 5
│   └── run-electron-e2e.mjs      # build + test in one command
└── resources/
    └── entitlements.mac.plist    # JIT + hardened runtime
```

---

## Documentation map

| Doc                                                                                                                | Purpose                                                       |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [`START-HERE.md`](./START-HERE.md)                                                                                 | **Front door** — status, doc ownership map, how work flows in |
| [`docs/PLAN.md`](./docs/PLAN.md)                                                                                   | **Strategic** roadmap, honest phase status, closure log       |
| [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md)                                                               | **Tactical ledger** — every open item, ID'd (`ATR-###`)       |
| [`docs/FUTURE.md`](./docs/FUTURE.md)                                                                               | **Frontier** — Phase 4/5/6 and parked decisions               |
| [`NEW-PLAN.md`](./NEW-PLAN.md)                                                                                     | Frozen 850-line Electron architecture & feature design        |
| [`docs/audits/`](./docs/audits/)                                                                                   | Point-in-time ground-truth audit reports                      |
| [`contracts/ipc.v3b.md`](./contracts/ipc.v3b.md)                                                                   | Current IPC channel contract (Phase 3b; older: v1, v3)        |
| [`contracts/data-layer.v1.md`](./contracts/data-layer.v1.md)                                                       | SQLite + LanceDB + settings file locations and migration      |
| [`contracts/api.md`](./contracts/api.md), [`schema.md`](./contracts/schema.md), [`types.ts`](./contracts/types.ts) | Legacy Next.js contracts (superseded — ATR-023)               |
| [`qa-report.json`](./qa-report.json)                                                                               | Phase-3b QA gate — unit layer only (see PLAN caveat)          |
| [`docs/agents/`](./docs/agents/)                                                                                   | Project agent-config (context, contracts, work tracker)       |
| `docs/archive/`                                                                                                    | Superseded planning docs (old MVP plan, research)             |
