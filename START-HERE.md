# START HERE — AllTheRepos

A local-first macOS **Electron** desktop hub for the dozens-to-thousands of git repos on
your machine. Mid-migration from a legacy Next.js web app; the Electron app (`src/`) is now
the real product and the Next.js app (`app/`, `components/`, `lib/`) is a superseded
safety net awaiting archival.

> New session? Read this file, then [`docs/PLAN.md`](./docs/PLAN.md) (where we are) and
> [`docs/REMAINING-WORK.md`](./docs/REMAINING-WORK.md) (what's next). That's ~3 pages and
> replaces crawling the source tree.

## Status at a glance (2026-05-31)

| Phase                                                    | State                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0 Scaffold · 1 Parity · 2 Native shell                   | ✅ / ⚠️ — structurally done; several Phase 1–2 surfaces are stubbed (see below)            |
| 3 Deep integrations (process, launcher, **Claude**, git) | ❌ wired but **not working on real data** — Claude tab is empty on a real `~/.claude.json` |
| 4 Intelligence · 5 Distribution · 6 Cross-platform       | ⛔ not started (post-MVP)                                                                  |

**Goal:** a daily-driver MVP — the app you open every day, on real data. **Next 7 steps**
are in [`docs/PLAN.md` → Critical path](./docs/PLAN.md#critical-path-to-the-daily-driver-mvp).

**Build health:** `tsc` is red (7 small errors, ATR-009); unit tests are 746✅/14 (the 14
are a native-ABI artifact, not regressions — see ATR-016); **0 Electron E2E have ever run**.
Don't trust `qa-report.json` as a ship signal — it's a unit-layer gate only.

## Run it

```bash
nvm use            # Node 22 from .nvmrc — REQUIRED (Vite 7 needs crypto.hash; native ABI is built for Electron)
pnpm install
pnpm electron:dev  # the real app (rebuilds natives for Electron's ABI, then launches)
```

⚠️ `pnpm dev` currently launches the **dead legacy Next.js app** at :3939, not the Electron
app — that's a known footgun (ATR-002).

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
