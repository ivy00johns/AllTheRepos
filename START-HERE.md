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
group-membership UI (**ATR-043**), cold start (**ATR-055**), and the distribution items
(**ATR-046/048/050/051/052**; **ATR-047** closed 2026-10-07). The build is no longer gated on
a person: **ATR-057**'s bad Command Line Tools SDK is resolved rather than exported, by
`pnpm install` and by every script that flips the ABI. New since Wave 5: ATR-056/057/058,
and the 2026-10-07 UI/UX intake — **fully applied 2026-10-08**: **ATR-059…069** (four P1s, seven
P2s) closed first, **ATR-075** found and closed with them, then the last five P3s
(**ATR-070…074**) proved on the running app by `tests/e2e/workstream-c.spec.ts`.

**Build health (verified 2026-10-08, on the UI/UX pass):** `pnpm typecheck` ✅ **0 errors
across all three tsconfigs** — it covers `src/main`, `src/preload` and `src/renderer`.
`pnpm lint` ✅ 0 · `vitest` **1708 passed / 0 failed** (87 files) · **Electron E2E 27 passed /
5 skipped / 0 failed** (14 specs; the skips are the packaged-update ones, which need a
packaged bundle). The suite also launches the app once with `ATR_FORCE_PACKAGED=1`
(`src/main/build-info.ts`), so the branch a release takes — no dev-only affordance anywhere,
no dev-only action in the palette — is tested rather than assumed. Fonts (IBM Plex Sans) load
at runtime. Added later the same day:
`tests/unit/renderer/jsx-text.spec.ts` (2 tests), `tests/unit/renderer/type-scale.spec.ts`
(3, the guard that fails the build on a raw sub-12px size), `tests/unit/shared/build-info.spec.ts`
(7, the packaged flag main states and the preload reads), and on the running app
`workstream-b.spec.ts` (8 tests) and `workstream-c.spec.ts` (6), the last two reading the
built renderer rather than the source.

**Also verified 2026-10-08, by looking at the app rather than at the tests:** the catalog,
`/graph`, `/claude`, `/processes`, `/settings` and `/debug` were each screenshotted and
read back from the DOM, in three builds — this branch's bundle, `electron-vite dev`, and
the `main` checkout's own build — and every one of them paints the top bar and nothing
else: no comment prose, no stray text node in the shell, no text injected by the graph's
palette probe. The A/B behind that claim (the bare block comment restored on purpose, then
removed again) is written up in **ATR-075**'s row in
[`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md).

> ⚠️ **Cold start is ~22s** (ATR-055): the main window is created only after every service
> finishes booting. Filed as ATR-055; expect a slow first paint until it lands.

## Run it

```bash
nvm use            # Node 22 from .nvmrc — REQUIRED (Vite 7 needs crypto.hash; native ABI is built for Electron)
pnpm install
pnpm electron:dev  # the real app. `pnpm dev` aliases this.
```

Tests: `pnpm test` (unit, host ABI) · `pnpm test:electron-e2e` · `pnpm test:full` (both, handles the ABI flip) · `pnpm lint:prose` (the outward prose, on the fast CI job).

## Gotchas (this machine)

- **Native rebuilds needed a hand-set SDK (ATR-057) — now arranged by the tree.** The
  **2026-09-22** Command Line Tools update installed SDK 27.0
  (`…/CommandLineTools/SDKs/MacOSX.sdk → MacOSX27.0.sdk`), which clang 21 rejects
  (`tapi error: malformed file`). The SDK on this machine is still that one, but nothing needs
  exporting: `pnpm install` runs `scripts/point-sdkroot.mjs`, which links a candidate before
  accepting it and writes the one that works into gyp's `~/.gyp/include.gypi` — the file gyp
  includes into every `.gyp` it reads, so it reaches a bare `pnpm rebuild <native module>`,
  whose build belongs to the dependency. `scripts/ensure-native-abi.mjs` resolves the same SDK
  and passes it to the rebuilds `pnpm test` / `test:full` start. Delete
  `~/.gyp/include.gypi` to go back to exporting `SDKROOT` by hand. The exception is the first
  install on a machine that has never built these natives: pnpm compiles a dependency before
  the root `preinstall` runs, so that one attempt still wants the export.

- ~~**`pnpm test` needs host-ABI natives.**~~ **Automated (ATR-016)** — and no longer gated
  on the tree already matching, since ATR-057's SDK is resolved by the scripts rather than by
  a person. Every test script runs `scripts/ensure-native-abi.mjs` first and rebuilds only on
  a real mismatch. Only `better-sqlite3` actually flips — `find-git-repositories` ships per-ABI
  builds and works under both runtimes.
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
