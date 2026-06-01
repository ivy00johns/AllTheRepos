# Build Plan — AllTheRepos

The roadmap and phase definitions, with an honest status for each phase and a closure
log of what has shipped. The full architecture rationale lives in the frozen
[`../NEW-PLAN.md`](../NEW-PLAN.md) (read it, don't edit it). Open work lives in
[`REMAINING-WORK.md`](./REMAINING-WORK.md).

**Goal (current):** a **daily-driver MVP** — the Electron app you open every day:
catalog + launch actions + process detection + Claude tab, all on real data. Packaging
and the intelligence layer come later.

---

## Where we actually are

The migration from Next.js to electron-vite is structurally complete: `src/main` is a real
backend (own DB, services, IPC, native shell), the type-safe IPC bridge is enforced, and
the unit suite is large and green. The 2026-05-31 audit found the Phase-3 "gate GREEN"
claim masked a layer of UI that rendered but did nothing on real data.

**Wave 1 (2026-05-31) closed the worst of that gap** (ATR-001/002/003/004/005/009/012/015):
the Claude registry now returns real data (138 projects, runtime-verified), catalog search
and tag/group edits are wired and persist, `pnpm dev` launches the Electron app, the
typecheck is green, and — for the first time — the Electron E2E suite runs (5/6; the one
failure is a test-navigation issue, ATR-017). Remaining Phase-1/2 polish (fonts, tray icon,
spotlight repo-open, dock badge) and the Phase-4/5 work are tracked in
[`REMAINING-WORK.md`](./REMAINING-WORK.md).

Verified 2026-05-31 — see the [ground-truth audit](./audits/2026-05-31-ground-truth-audit.md).

## Phase status

| Phase                         | Plan deliverable                                                                    | Paper claim                   | **Actual status**                                                                                                                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Scaffold**              | Empty window, IPC ping, security defaults                                           | complete                      | ✅ **Complete & verified.** Type-safe IPC bridge real, contextIsolation/sandbox/CSP enforced in all 3 window factories, single-instance boot ordering correct.                                                                                                                         |
| **1 — Feature parity**        | Catalog, scanner, hybrid search, 3-col UI, shortcuts                                | complete                      | ✅ **Functional (W1).** Catalog search wired to the real FTS+vector backend; tag-edit and group create/rename/delete persist; search input unified. Remaining: design fonts (ATR-008), manual-group filter (ATR-011).                                                                  |
| **2 — Native shell**          | Tray, hotkey, spotlight, menu, notifications, deep-link, dock badge                 | "complete"                    | ⚠️ **Plumbing real; surfaces stubbed.** Hotkey/menu/protocol/CSP/notifications real and deep-link navigation works. But the tray icon is a 1×1 placeholder (invisible), spotlight & tray "open repo" are `console.info` no-ops, dock badge never auto-driven. → ATR-006/007/010        |
| **3 — Deep integrations**     | Process detection, launcher, Claude integration, git deep view                      | **"3b complete, gate GREEN"** | ⚠️ **Claude works now (W1).** Registry returns 138 real projects (runtime-verified). Remaining: embeddings never written so semantic search is dead (ATR-018); per-project usage trend faked (ATR-020); MCP "running"/transcript viewer (ATR-021); claude-flow E2E test fix (ATR-017). |
| **4 — Intelligence**          | Deps, OSV, health score, smart suggestions, LLM tagging, activity                   | not started                   | ⛔ **Absent (correctly out of scope).** → [`FUTURE.md`](./FUTURE.md)                                                                                                                                                                                                                   |
| **5 — Polish & distribution** | Themes, density, snapshots, signing, notarization, CI, auto-update, onboarding, DMG | not started                   | ⛔ **Absent.** `notarize.mjs` is a no-op, no `.github/`, `electron-updater` imported nowhere, build unsigned. → [`FUTURE.md`](./FUTURE.md)                                                                                                                                             |
| **6 — Cross-platform**        | Linux/Windows, worktrees, plugin API, sync                                          | optional/later                | ⛔ Not started (intended). → [`FUTURE.md`](./FUTURE.md)                                                                                                                                                                                                                                |

## Critical path to the daily-driver MVP

Wave 1 (done): ✅ `pnpm dev`→Electron (ATR-002), ✅ Claude parser (ATR-001), ✅ real catalog
search (ATR-003), ✅ tag/group persistence (ATR-004/005), ✅ green typecheck (ATR-009), ✅
de-flaked test (ATR-015), ◐ Electron E2E running 5/6 (ATR-017).

Wave 2 (next), in rough order (full detail + IDs in [`REMAINING-WORK.md`](./REMAINING-WORK.md)):

1. **Fix the claude-flow E2E** (navigate via UI, not `goto`) so the Claude tab is E2E-covered (ATR-017).
2. **Native shell polish** — spotlight/tray repo-open (ATR-006), real tray icon (ATR-007), dock badge (ATR-010).
3. **Ship the design fonts** so the UI matches the mocks (ATR-008).
4. **Manual-group filtering** so selecting a group actually filters the grid (ATR-011).
5. **Semantic search** — wire embedding writes, or honestly relabel the affordance (ATR-018).
6. **Harden** — frame-origin check (ATR-014), command/action context (ATR-022), contract reconciliation (ATR-023).
7. **Retire the legacy Next.js stack** (ATR-013) — also removes the GPG scanner flake.

After Wave 2 the app is genuinely usable day-to-day; Phase 4 (intelligence) and Phase 5
(distribution) follow.

## A note on the QA report

`qa-report.json` is accurate **at the unit/contract layer** (the schemas, IPC wiring, and
frame checks it tests are real and pass). It is misleading as a measure of "done": its
760/0 count predates the current tree, it never tested the Claude parser against a real
file, and its E2E section is stale (E2E now runs on Node 22, 5/6). Treat it as a unit-test
gate, not a ship-readiness signal.

---

## Closure log

What has shipped, newest first. Add a line when a `REMAINING-WORK.md` item closes.

| Date       | What shipped                                                                                                                                                                                                                                                                                                    | Refs                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 2026-05-31 | **Wave 1 MVP** — Claude registry returns real data (138 projects, runtime-verified); catalog search + tag/group persistence wired; `pnpm dev`→Electron; green typecheck; de-flaked test; Electron E2E running 5/6. Closed ATR-001/002/003/004/005/009/012/015; ATR-016/017 partial. Commits unsigned (ATR-025). | commit `9e145de`            |
| 2026-05-31 | Project intake: ground-truth audit, living-plan docs, project agent-config, mission skill manifest. (Housekeeping — no app code changed.)                                                                                                                                                                       | commit `5f97dd3`            |
| 2026-05-13 | Phase 3b — Claude Code integration at the unit/contract layer.                                                                                                                                                                                                                                                  | commit `b57e20f`            |
| 2026-05-13 | Phase 3a — process detection + launcher services + UI.                                                                                                                                                                                                                                                          | branch history              |
| 2026-05-13 | Phase 2 — native desktop shell (tray, hotkey, spotlight, menu, protocol).                                                                                                                                                                                                                                       | branch history              |
| 2026-05-13 | Phase 1 — feature parity shell ported from Next.js to electron-vite renderer.                                                                                                                                                                                                                                   | branch history              |
| 2026-05-13 | Phase 0 — scaffold, type-safe IPC bridge, security baseline.                                                                                                                                                                                                                                                    | branch history              |
| 2026-04-15 | Legacy Next.js MVP (`build/repo-hub-mvp`) — catalog, scanner, hybrid search, 24/24 QA gate.                                                                                                                                                                                                                     | branch `build/repo-hub-mvp` |
