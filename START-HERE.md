# START HERE — AllTheRepos

A local-first macOS **Electron** desktop hub for the dozens-to-thousands of git repos on
your machine. Mid-migration from a legacy Next.js web app; the Electron app (`src/`) is the
real product and the Next.js app (`app/`, `components/`, `lib/`) is a superseded safety net
awaiting archival (ATR-013).

> New session? Read this, then [`docs/PLAN.md`](./docs/PLAN.md) (where we are) and
> [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md) (what's next). ~3 pages, replaces
> crawling the source tree.

## Status at a glance (2026-06-01, after Wave 3)

| Phase                                                    | State                                                                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Scaffold · 1 Feature parity · 2 Native shell           | ✅ functional — search, tag/group persistence, manual-group filter, fonts, spotlight/tray repo-open, real tray icon, dock badge                             |
| 3 Deep integrations (process, launcher, **Claude**, git) | ✅ functional — 138 real Claude projects, real per-project usage trends, transcript viewer; embeddings wired (Ollama-gated). Deferred: MCP "running" status |
| 4 Intelligence · 5 Distribution · 6 Cross-platform       | ⛔ not started (post-MVP)                                                                                                                                   |

**Goal:** a daily-driver MVP. **22 of 26 ledger items closed across Waves 1–3.** Left over
from the waves: legacy-stack retirement (ATR-013), test-ABI automation tail (ATR-016), and two
env papercuts (ATR-024/025). A **2026-07-11 data-safety/scan/UX audit** then added **11 P1
items (ATR-027…045)** — moved-repo identity, stale-row lifecycle, scanner blind spots,
last-opened accuracy, catalog list UX. See [`docs/PLAN.md`](./docs/PLAN.md).

**Build health:** `tsc --noEmit` ✅ · `vitest` **858 passed / 5 skipped / 0 failed** ·
**Electron E2E 7/7**. Fonts (IBM Plex Sans) load at runtime.

## Run it

```bash
nvm use            # Node 22 from .nvmrc — REQUIRED (Vite 7 needs crypto.hash; native ABI is built for Electron)
pnpm install
pnpm electron:dev  # the real app. `pnpm dev` aliases this.
```

Tests: `pnpm test` (unit, host ABI) · `pnpm test:electron-e2e` · `pnpm test:full` (both, handles the ABI flip).

## Gotchas (this machine)

- **`pnpm test` needs host-ABI natives.** Just launched the app? `pnpm rebuild better-sqlite3 find-git-repositories` first (ATR-016), or use `pnpm test:full`.
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
