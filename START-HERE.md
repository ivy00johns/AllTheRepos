# START HERE — AllTheRepos

A local-first macOS **Electron** desktop hub for the dozens-to-thousands of git repos on
your machine. The Electron app under `src/` is the whole product — the legacy Next.js app
was **retired on 2026-08-21** (ATR-013), so `app/`, `components/` and `lib/` no longer
exist. Recover them from git history or the `build/repo-hub-mvp` branch if ever needed.

> New session? Read this, then [`docs/PLAN.md`](./docs/PLAN.md) (where we are) and
> [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md) (what's next). ~3 pages, replaces
> crawling the source tree.

## Status at a glance (2026-08-21, after Wave 0 of the production-readiness push)

| Phase                                                    | State                                                                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Scaffold · 1 Feature parity · 2 Native shell           | ✅ functional — search, tag/group persistence, manual-group filter, fonts, spotlight/tray repo-open, real tray icon, dock badge                             |
| 3 Deep integrations (process, launcher, **Claude**, git) | ✅ functional — 138 real Claude projects, real per-project usage trends, transcript viewer; embeddings wired (Ollama-gated). Deferred: MCP "running" status |
| **5 Distribution**                                       | 🔨 **in scope** — unsigned, no CI, updater unwired; promoted out of `FUTURE.md` into ATR-046…052                                                            |
| 4 Intelligence · 6 Cross-platform                        | ⛔ not started (still post-MVP → [`docs/FUTURE.md`](./docs/FUTURE.md))                                                                                      |

**Goal (widened 2026-08-21): production ready** — a signed, notarized, CI-built,
auto-updating app. The daily-driver MVP is the first half and is nearly done. Sequencing:
[`docs/plans/2026-08-21-production-readiness-plan.md`](./docs/plans/2026-08-21-production-readiness-plan.md).

**Wave 0 (2026-08-21)** closed the foundation: `main` was **19 commits behind** the work
branch and the repo had **no git remote at all** — both fixed, and it now lives on a private
GitHub remote. The legacy stack is gone (ATR-013) and the native-ABI flip is automated
(ATR-016), so `pnpm test` and `pnpm test:electron-e2e` no longer need a manual rebuild
between them.

**Next: Wave A** — the 8 open P1s (scanner blind spots ATR-033/037, catalog list UX
ATR-038/040/041/042/043/045). Then **Wave B** — distribution, now tracked as ATR-046…052.

**Build health (verified 2026-08-21):** `pnpm typecheck` ✅ **0 errors across all three
tsconfigs** — it now covers `src/main`, `src/preload` and `src/renderer`, which the root
config used to exclude. `vitest` **862 passed / 0 failed / 0 skipped** · **Electron E2E
7/7**. Fonts (IBM Plex Sans) load at runtime.

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
