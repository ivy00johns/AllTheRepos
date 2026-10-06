# START HERE — AllTheRepos

A local-first macOS **Electron** desktop hub for the dozens-to-thousands of git repos on
your machine. The Electron app under `src/` is the whole product — the legacy Next.js app
was **retired on 2026-08-21** (ATR-013), so `app/`, `components/` and `lib/` no longer
exist. Recover them from git history or the `build/repo-hub-mvp` branch if ever needed.

> New session? Read this, then [`docs/PLAN.md`](./docs/PLAN.md) (where we are) and
> [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md) (what's next). ~3 pages, replaces
> crawling the source tree.

## Status at a glance (2026-10-06, after Wave 5 — the catalog-v2 + MCP wave)

| Phase                                                    | State                                                                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Scaffold · 1 Feature parity · 2 Native shell           | ✅ functional — search, tag/group persistence, manual-group filter, fonts, spotlight/tray repo-open, real tray icon, dock badge                             |
| 3 Deep integrations (process, launcher, **Claude**, git) | ✅ functional — 138 real Claude projects, real per-project usage trends, transcript viewer; embeddings wired (Ollama-gated). Deferred: MCP "running" status |
| **3b Catalog v2 + MCP** (Wave 5)                         | ✅ functional — curated relationship graph + MCP server, live file watching, folders, repo moves, per-repo tasks, covers, favorites, catalog toolbar + table view |
| **5 Distribution**                                       | 🔨 **partly landed (Wave 5)** — ad-hoc signed, GitHub-Releases publish feed, `electron-updater` wired with an "Update to X" affordance, real app icons, `docs/RELEASING.md`. Still open: notarization (ATR-046), the first CI run (ATR-047), a notarized release (ATR-048), branded DMG (ATR-051), onboarding window (ATR-050), the first real version bump (ATR-052) |
| 4 Intelligence · 6 Cross-platform                        | ⛔ not started (still post-MVP → [`docs/FUTURE.md`](./docs/FUTURE.md))                                                                                      |

**Goal (widened 2026-08-21): production ready** — a signed, notarized, CI-built,
auto-updating app. The daily-driver MVP is the first half and is nearly done. Sequencing:
[`docs/plans/2026-08-21-production-readiness-plan.md`](./docs/plans/2026-08-21-production-readiness-plan.md).

**Wave 0 (2026-08-21)** closed the foundation: `main` was **19 commits behind** the work
branch and the repo had **no git remote at all** — both fixed, and it now lives on a private
GitHub remote. The legacy stack is gone (ATR-013) and the native-ABI flip is automated
(ATR-016), so the test scripts now guard themselves. (A flip is broken again on this machine for an
unrelated reason — see **ATR-057** in Gotchas.)

**Wave 5 — catalog v2 + MCP (2026-08-24–25)** is the big one, and it sat **uncommitted for six
weeks** until 2026-10-06, when it became 7 coherent commits on `feat/alltherepos-mcp`
(`bfbe3ab..9c295ce`) and was pushed. It closed **ATR-037/038/040/045/049**, partly closed
**ATR-041/048/052**, and shipped a great deal the ledger never had an ID for: the **MCP server**
(`mcp/`, 6 tools over a new `repo_links` table), the **curated relationship graph** + `/graph`
route, **live file watching** (`fs.watch`, debounced, with a reconcile pass), **scan-root
management**, **folders**, **repo moves** + a relocation journal, **per-repo tasks**, **repo
covers**, **favorites**, and the **catalog toolbar + table view**. It is **not merged to `main`**.

**Next:** the tail — scanner discovery (**ATR-033**), the silent 200-repo cap (**ATR-042**),
group-membership UI (**ATR-043**), cold start (**ATR-055**), and the distribution items
(**ATR-046/047/048/050/051/052**). Before any of that, unblock the build: **ATR-057** breaks
native ABI flips on this machine. New since Wave 5: ATR-056/057/058.

**Build health (verified 2026-10-06, after the related-repos follow-up):** `pnpm typecheck` ✅ **0 errors
across all three tsconfigs** — it covers `src/main`, `src/preload` and `src/renderer`.
`vitest` **1004 passed / 0 failed / 0 skipped** (45 files) · **Electron E2E 7/7** (1.4 min).
Fonts (IBM Plex Sans) load at runtime. Note `pnpm test` only works when the tree already sits
in the host ABI — flipping it is broken (ATR-057).

> ⚠️ **Cold start is ~22s** (ATR-055): the main window is created only after every service
> finishes booting. Known, measured, and filed — expect a slow first paint until it lands.

## Run it

```bash
nvm use            # Node 22 from .nvmrc — REQUIRED (Vite 7 needs crypto.hash; native ABI is built for Electron)
pnpm install
pnpm electron:dev  # the real app. `pnpm dev` aliases this.
```

Tests: `pnpm test` (unit, host ABI) · `pnpm test:electron-e2e` · `pnpm test:full` (both, handles the ABI flip).

## Gotchas (this machine)

- **Native rebuilds are broken (ATR-057).** The **2026-09-22** Command Line Tools update
  installed SDK 27.0 (`…/CommandLineTools/SDKs/MacOSX.sdk → MacOSX27.0.sdk`), which clang 21
  rejects (`tapi error: malformed file`). Any `node-gyp` rebuild fails, so an **ABI flip dies**
  and `pnpm test` / `test:full` fail unless the tree already matches. Workaround:
  `export SDKROOT=$(xcrun --sdk macosx --show-sdk-path)`.

- ~~**`pnpm test` needs host-ABI natives.**~~ **Fixed (ATR-016).** Every test script now
  runs `scripts/ensure-native-abi.mjs` first and rebuilds only on a real mismatch, so the
  suites can be run in any order. Only `better-sqlite3` actually flips —
  `find-git-repositories` ships per-ABI builds and works under both runtimes.
- **Bare `node`/`npx`/`npm` recurse** (broken nvm wrapper in the dotfiles). Use `~/.nvm/versions/node/v22.22.3/bin/node`, or fix the dotfile (ATR-024).
- **Commits don't sign non-interactively** — 1Password SSH-agent signing fails headless; this session's commits used `--no-gpg-sign` (ATR-025).

## Ownership map — which doc is what

| Doc                                                                  | Role                                                    | Edit?               |
| -------------------------------------------------------------------- | ------------------------------------------------------- | ------------------- |
| **`START-HERE.md`** (this)                                           | Front door: status + map                                | ✅ keep current     |
| [`docs/PLAN.md`](./docs/PLAN.md)                                     | **Strategic** — roadmap, phase status, closure log      | ✅ canonical        |
| [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md)                 | **Tactical ledger** — open items, ID'd (`ATR-###`)      | ✅ canonical        |
| [`docs/FUTURE.md`](./docs/FUTURE.md)                                 | **Frontier** — Phase 4/5/6, parked decisions            | ✅ canonical        |
| [`NEW-PLAN.md`](./NEW-PLAN.md)                                       | 850-line architecture & feature design report           | 🔒 frozen reference |
| [`docs/plans/`](./docs/plans/)                                       | Sequenced build plans (orchestrator-ready)              | ✅ current plan     |
| [`docs/audits/`](./docs/audits/)                                     | Point-in-time audit reports (ledger sources)            | 🔒 frozen reference |
| [`contracts/`](./contracts/)                                         | IPC / data-layer / schema contracts (v1 → v3b)          | 🔒 reference        |
| [`README.md`](./README.md)                                           | Setup + architecture for humans                         | ✅ keep current     |
| `docs/archive/`                                                      | Superseded planning docs                                | 🗄️ history          |
| [`qa-report.json`](./qa-report.json)                                 | Pre-Wave-1 unit gate — **historical/stale** (see PLAN)  | 🔒 reference        |
| [`docs/agents/`](./docs/agents/)                                     | Project agent-config (context, contracts, work tracker) | ✅ canonical        |
| [`coordination/MISSION_SKILLS.md`](./coordination/MISSION_SKILLS.md) | Orchestrator mission skill manifest                     | ✅ per-build        |

## How work flows in

Living-plan convention: any finished report (audit, deep-dive, QA) goes through the
**`plan-intake`** skill → proposed entries in [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md)
→ approval. Reports become tracked `ATR-###` items or are dismissed. Work items are local
markdown (no external tracker) — see [`docs/agents/work-item-tracker.md`](./docs/agents/work-item-tracker.md).
