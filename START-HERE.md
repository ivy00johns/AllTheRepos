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
| **5 Distribution**                                       | 🔨 **partly landed (Wave 5)** — ad-hoc signed, GitHub-Releases publish feed, `electron-updater` wired with an "Update to X" affordance, real app icons, `docs/RELEASING.md`. Still open: the Apple Developer membership that notarization needs (ATR-046 — the wiring landed 2026-10-06, the certificate is the only blocker), a first notarized release (ATR-048), branded DMG (ATR-051), onboarding window (ATR-050) |
| 4 Intelligence · 6 Cross-platform                        | ⛔ not started (still post-MVP → [`docs/FUTURE.md`](./docs/FUTURE.md))                                                                                      |

**Goal (widened 2026-08-21): production ready** — a signed, notarized, CI-built,
auto-updating app. The daily-driver MVP is the first half and is nearly done. Sequencing:
[`docs/plans/2026-08-21-production-readiness-plan.md`](./docs/plans/2026-08-21-production-readiness-plan.md).

**Where the tree came from — two waves.** **Wave 0 (2026-08-21)** moved `main` off the work
branch (19 commits behind, no git remote at all) onto a private GitHub remote, retired the
legacy Next.js stack (**ATR-013**) and automated the native-ABI flip (**ATR-016**). **Wave 5
(built 2026-08-24–25, committed 2026-10-06)** is the catalog-v2 + MCP wave: 7 commits on
`feat/alltherepos-mcp` (`bfbe3ab..9c295ce`), uncommitted for six weeks until then, closing
**ATR-037/038/040/045/049** and leaving **ATR-041/048/052** partly done. It is **not merged to
`main`**. Both are written up row by row in [`docs/PLAN.md`](./docs/PLAN.md)'s closure log, with
the item detail in [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md) — this page carries
state, not history.

**Next:** the tail — scanner discovery (**ATR-033**), the silent 200-repo cap (**ATR-042**),
group-membership UI (**ATR-043**), and the distribution items
(**ATR-046/048/050/051/052**; **ATR-047** closed 2026-10-07). New since Wave 5: ATR-056/057/058,
and the 2026-10-07 UI/UX intake (**ATR-059…074**) — its **four P1s and five of its P2s are fixed and
measured in a real window**, and **ATR-055** (cold start) with them. `tests/e2e/accessibility.spec.ts`
carries the accessibility blockers (**ATR-059** unnamed nav below `lg`, **ATR-060** a button role
wrapping buttons, **ATR-066** unnamed table rows, **ATR-069** keyboard-unreachable graph nodes,
**ATR-065** a radiogroup that ignored the arrows), `tests/e2e/viewport-fit.spec.ts` the two
viewport-height clipping bugs, and `tests/e2e/retry-and-loading.spec.ts` the dead-end error screens
(**ATR-063**) and the bare-text loading states (**ATR-064**). **ATR-057** no longer blocks a flip: a
source build is needed only for a module whose publisher ships no binary for the ABI in use, and none of
the three here is that module.

**Build health (verified 2026-10-08, on the pinned Node 22 — see the gotcha below):** `pnpm typecheck` ✅
**0 errors across all three tsconfigs** — it covers `src/main`, `src/preload` and `src/renderer` ·
`pnpm lint` 0 · `pnpm lint:prose` 0 errors · `versions:check`, `platforms:check`, `ci-cost:check`,
`first-launch:check`, `links:check` all green · `vitest` **1725 passed / 0 failed / 0 skipped**
(88 files) · **Electron E2E 22 passed / 0 failed** (~2.0 min; the 5 packaged-update specs skip
without a bundle). Fonts (IBM Plex Sans) load at runtime.

**Cold start (ATR-055, fixed 2026-10-08).** The window is created first and the process scan, the
editor detection and the Claude index boot behind it, so the first paint no longer waits for any of
them. Measured with `scripts/measure-cold-start.mjs` — three launches each, same machine, back to
back — the window went **5381ms → 1345ms** and the shell **6619ms → 3156ms**; the fixed build has the
whole shell on screen before the old one had a window at all.

## Run it

```bash
nvm use            # Node 22 from .nvmrc — REQUIRED (Vite 7 needs crypto.hash; native ABI is built for Electron)
pnpm install
pnpm electron:dev  # the real app. `pnpm dev` aliases this.
```

Tests: `pnpm test` (unit, host ABI) · `pnpm test:electron-e2e` · `pnpm test:full` (both, handles the ABI flip) · `pnpm lint:prose` (the outward prose, on the fast CI job).

## Gotchas (this machine)

- **Source builds are broken (ATR-057), flips are not.** The **2026-09-22** Command Line Tools
  update installed SDK 27.0 (`…/CommandLineTools/SDKs/MacOSX.sdk → MacOSX27.0.sdk`), which clang 21
  rejects (`tapi error: malformed file`), so anything `node-gyp` compiles fails to link. Every test
  script runs `scripts/ensure-native-abi.mjs` first and rebuilds only on a real mismatch; the two
  modules that matter are restored from the binaries their publishers ship for the ABI in use (the
  scanner via `scripts/install-native-prebuilds.mjs`), and a flip that cannot finish puts the tree
  back the way it found it rather than leaving nothing loadable. Reach for `SDKROOT` only if a new
  module has no prebuild for the ABI in use.

- **Run the suites on the pinned Node 22** (`.nvmrc`; `~/.nvm/versions/node/v22.22.3/bin`), not the
  Homebrew `node` (26) that comes first on `PATH` — `better-sqlite3` publishes no prebuild for 26's
  ABI, and this machine cannot compile one. The flip detects that now and says so, then leaves the
  addon it found in place, so the mistake costs one confusing run instead of a hand repair. `pnpm test`
  also needs host-ABI natives, which the same flip arranges (ATR-016) — so the suites run in any order.
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
