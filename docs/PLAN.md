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

The app is a **well-architected, well-tested Phase 0–2 shell with a Phase 3 layer that is
wired but largely non-functional against real data.** The migration from Next.js to
electron-vite is structurally complete: `src/main` is a real backend (own DB, services,
IPC, native shell), the type-safe IPC bridge is genuinely enforced, and 746 Electron-side
unit tests pass. But several headline features render UI that doesn't do anything yet, and
the QA gate went green at the unit layer without ever exercising the app end-to-end on a
real machine.

Verified 2026-05-31 — see the [ground-truth audit](./audits/2026-05-31-ground-truth-audit.md).

## Phase status

| Phase                         | Plan deliverable                                                                    | Paper claim                   | **Actual status**                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Scaffold**              | Empty window, IPC ping, security defaults                                           | complete                      | ✅ **Complete & verified.** Type-safe IPC bridge real, contextIsolation/sandbox/CSP enforced in all 3 window factories, single-instance boot ordering correct.                                                                                                                                    |
| **1 — Feature parity**        | Catalog, scanner, hybrid search, 3-col UI, shortcuts                                | complete                      | ⚠️ **Shell complete; core interactions stubbed.** DB + scanner + 3-col UI real. But catalog search is client-side substring (not FTS5+LanceDB), tag-edit & group-create are silent no-ops, fonts missing, top-bar search dead, manual-group filter broken. → ATR-003/004/005/008/011/012          |
| **2 — Native shell**          | Tray, hotkey, spotlight, menu, notifications, deep-link, dock badge                 | "complete"                    | ⚠️ **Plumbing real; surfaces stubbed.** Hotkey/menu/protocol/CSP/notifications real and deep-link navigation works. But the tray icon is a 1×1 placeholder (invisible), spotlight & tray "open repo" are `console.info` no-ops, dock badge never auto-driven. → ATR-006/007/010                   |
| **3 — Deep integrations**     | Process detection, launcher, Claude integration, git deep view                      | **"3b complete, gate GREEN"** | ❌ **Wired, not working on real data.** Claude tab is **empty** on a real `~/.claude.json` (parser shape mismatch); embeddings are never written so semantic search is dead; process/launcher are unit-tested but never run E2E; per-project usage trend is faked. → ATR-001/018/020/021, ATR-017 |
| **4 — Intelligence**          | Deps, OSV, health score, smart suggestions, LLM tagging, activity                   | not started                   | ⛔ **Absent (correctly out of scope).** No dep parsing, OSV, health scoring, LLM tagging, or activity timeline. → [`FUTURE.md`](./FUTURE.md)                                                                                                                                                      |
| **5 — Polish & distribution** | Themes, density, snapshots, signing, notarization, CI, auto-update, onboarding, DMG | not started                   | ⛔ **Absent.** `notarize.mjs` is a no-op, no `.github/`, `electron-updater` imported nowhere, build unsigned. → [`FUTURE.md`](./FUTURE.md)                                                                                                                                                        |
| **6 — Cross-platform**        | Linux/Windows, worktrees, plugin API, sync                                          | optional/later                | ⛔ Not started (intended). → [`FUTURE.md`](./FUTURE.md)                                                                                                                                                                                                                                           |

## Critical path to the daily-driver MVP

In rough order (full detail + IDs in [`REMAINING-WORK.md`](./REMAINING-WORK.md)):

1. **Make `pnpm dev` launch the Electron app**, not the dead Next.js one — ATR-002.
2. **Fix the Claude registry parser** so the Claude tab shows real projects/sessions/usage — ATR-001.
3. **Wire real catalog search** and kill the dead search input — ATR-003.
4. **Persist tag edits and group changes** (stop the data-loss illusion) — ATR-004, ATR-005.
5. **Make spotlight/tray actually open repos**, ship a visible tray icon, add the fonts — ATR-006/007/008.
6. **Green the typecheck**, de-flake the one timing-sensitive test — ATR-009, ATR-015.
7. **Run the Electron E2E suite once for real** and reconcile the QA report — ATR-016/017.

After that the app is genuinely usable day-to-day; Phase 4 (intelligence) and Phase 5
(distribution) follow.

## A note on the QA report

`qa-report.json` is accurate **at the unit/contract layer** (the schemas, IPC wiring, and
frame checks it tests are real and pass). It is misleading as a measure of "done" because:
its 760/0 count predates the current tree (host run is 746/14, the 14 being a native-ABI
artifact); it never tested the Claude parser against a real file; and it rests on **zero
executed Electron E2E** (3 specs blocked). Treat it as a unit-test gate, not a
ship-readiness signal.

---

## Closure log

What has shipped, newest first. Add a line when a `REMAINING-WORK.md` item closes.

| Date       | What shipped                                                                                                                              | Refs                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 2026-05-31 | Project intake: ground-truth audit, living-plan docs, project agent-config, mission skill manifest. (Housekeeping — no app code changed.) | this branch                 |
| 2026-05-13 | Phase 3b — Claude Code integration (ClaudeService, IPC, Claude tab UI, global usage view) at the unit/contract layer.                     | commit b57e20f              |
| 2026-05-13 | Phase 3a — process detection + launcher services + UI.                                                                                    | branch history              |
| 2026-05-13 | Phase 2 — native desktop shell (tray, hotkey, spotlight, menu, protocol).                                                                 | commit (phase-2)            |
| 2026-05-13 | Phase 1 — feature parity shell ported from Next.js to electron-vite renderer.                                                             | branch history              |
| 2026-05-13 | Phase 0 — scaffold, type-safe IPC bridge, security baseline.                                                                              | branch history              |
| 2026-04-15 | Legacy Next.js MVP (`build/repo-hub-mvp`) — catalog, scanner, hybrid search, 24/24 QA gate.                                               | branch `build/repo-hub-mvp` |
