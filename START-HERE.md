# START HERE — AllTheRepos

A local-first macOS **Electron** desktop hub for the dozens-to-thousands of git repos on
your machine. Mid-migration from a legacy Next.js web app; the Electron app (`src/`) is now
the real product and the Next.js app (`app/`, `components/`, `lib/`) is a superseded
safety net awaiting archival.

> New session? Read this file, then [`docs/PLAN.md`](./docs/PLAN.md) (where we are) and
> [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md) (what's next). That's ~3 pages and
> replaces crawling the source tree.

## Status at a glance (2026-05-31, after Wave 1)

| Phase                                                    | State                                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0 Scaffold                                               | ✅ complete & verified                                                                                                           |
| 1 Feature parity                                         | ✅ **functional (W1)** — catalog search + tag/group persistence wired; remaining: fonts (ATR-008), manual-group filter (ATR-011) |
| 2 Native shell                                           | ⚠️ plumbing real, surfaces stubbed — tray icon/spotlight repo-open/dock badge (ATR-006/007/010)                                  |
| 3 Deep integrations (process, launcher, **Claude**, git) | ⚠️ **Claude works now (W1)** — registry returns 138 real projects; remaining: semantic search (ATR-018), usage trend (ATR-020)   |
| 4 Intelligence · 5 Distribution · 6 Cross-platform       | ⛔ not started (post-MVP)                                                                                                        |

**Goal:** a daily-driver MVP — the app you open every day, on real data. **Wave 2** is in
[`docs/PLAN.md` → Critical path](./docs/PLAN.md#critical-path-to-the-daily-driver-mvp).

**Build health (after Wave 1):** `tsc --noEmit` ✅ green; `vitest` **775✅ / 5 skipped** (2
failing are the pre-existing legacy GPG scanner timeout, ATR-013); Electron **E2E 5/6** (the
claude-flow spec fails on a test-nav issue, ATR-017). Claude registry runtime-verified at
138 projects.

## Run it

```bash
nvm use            # Node 22 from .nvmrc — REQUIRED (Vite 7 needs crypto.hash; native ABI is built for Electron)
pnpm install
pnpm electron:dev  # the real app (rebuilds natives for Electron's ABI, then launches). `pnpm dev` now aliases this.
```

## Gotchas (this machine)

- **`pnpm test` needs host-ABI natives.** If you just launched the app, run `pnpm rebuild better-sqlite3 find-git-repositories` before `pnpm test` (the dual-rebuild dance, ATR-016).
- **Bare `node`/`npx`/`npm` recurse** in this shell (a broken nvm wrapper in the dotfiles). Use the absolute binary `~/.nvm/versions/node/v22.22.3/bin/node`, or fix the dotfile (ATR-024).
- **Commits don't sign non-interactively** — 1Password SSH-agent signing fails in headless sessions; Wave-1 commits used `--no-gpg-sign`. Re-sign on a real terminal or relax signing for agent sessions (ATR-025).

## Ownership map — which doc is what

| Doc                                                                  | Role                                                                 | Edit?                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------- |
| **`START-HERE.md`** (this)                                           | Front door: status + map                                             | ✅ keep current                  |
| [`docs/PLAN.md`](./docs/PLAN.md)                                     | **Strategic** — roadmap, phase status, closure log                   | ✅ canonical                     |
| [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md)                 | **Tactical ledger** — every open item, ID'd (`ATR-###`)              | ✅ canonical                     |
| [`docs/FUTURE.md`](./docs/FUTURE.md)                                 | **Frontier** — Phase 4/5/6, parked decisions                         | ✅ canonical                     |
| [`NEW-PLAN.md`](./NEW-PLAN.md)                                       | 850-line architecture & feature design report                        | 🔒 frozen reference              |
| [`docs/audits/`](./docs/audits/)                                     | Point-in-time audit reports (sources for ledger entries)             | 🔒 frozen reference              |
| [`contracts/`](./contracts/)                                         | IPC / data-layer / schema contracts (versioned: v1 → v3b)            | 🔒 reference (drifted — ATR-023) |
| [`README.md`](./README.md)                                           | Setup + architecture for humans                                      | ✅ keep current                  |
| `docs/archive/`                                                      | Superseded: old MVP `plan-mvp.md`, `research.md`, `initial-plan.md`  | 🗄️ history                       |
| [`qa-report.json`](./qa-report.json)                                 | Phase-3b QA gate — **unit layer only, partly stale**                 | 🔒 reference, see PLAN caveat    |
| [`docs/agents/`](./docs/agents/)                                     | Project agent-config (context layout, contract format, work tracker) | ✅ canonical                     |
| [`coordination/MISSION_SKILLS.md`](./coordination/MISSION_SKILLS.md) | Orchestrator mission skill manifest                                  | ✅ per-build                     |

## How work flows in

This project follows the **living-plan** convention. Any finished report — audit,
deep-dive, QA findings — goes through the **`plan-intake`** skill, which proposes entries
into [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md) for approval. Reports don't rot;
they become tracked `ATR-###` items or are explicitly dismissed. Work items are tracked as
local markdown here (no external tracker) — see [`docs/agents/work-item-tracker.md`](./docs/agents/work-item-tracker.md).
