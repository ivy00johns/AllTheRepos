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

The migration from Next.js to electron-vite is structurally complete and, after two build
waves, the app **builds, boots, and works on real data**: the Claude tab shows 138 real
projects, catalog search + tag/group edits persist, spotlight/tray open repos, the dock
badge tracks running servers, the design fonts render, and the **full Electron E2E suite is
7/7** (it had never run before this work). Typecheck is green and the unit suite is 816/0/5.

What's left for "fully usable + opinionated" is the intelligence layer (semantic search
embeddings, dependency/health features), a couple of Claude-tab refinements, command-palette
context, retiring the legacy Next.js stack, and two local environment papercuts (nvm wrapper,
commit signing). All tracked in [`REMAINING-WORK.md`](./REMAINING-WORK.md).

Baseline verified 2026-05-31 — see the [ground-truth audit](./audits/2026-05-31-ground-truth-audit.md).

## Phase status

| Phase                         | Plan deliverable                                                    | **Actual status**                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Scaffold**              | Window, IPC ping, security defaults                                 | ✅ Complete & verified.                                                                                                                                                                                                                       |
| **1 — Feature parity**        | Catalog, scanner, hybrid search, 3-col UI, shortcuts                | ✅ **Functional.** Real search, tag/group persistence, manual-group filtering, design fonts.                                                                                                                                                  |
| **2 — Native shell**          | Tray, hotkey, spotlight, menu, notifications, deep-link, dock badge | ✅ **Functional (W2).** Tray icon real + template; spotlight/tray open repos in the main window; dock badge auto-driven from running servers; hotkey/menu/protocol/CSP already real.                                                          |
| **3 — Deep integrations**     | Process detection, launcher, Claude integration, git deep view      | ⚠️ **Mostly working.** Claude tab shows real data; process/launcher run; **full E2E 7/7**. Remaining: semantic-search embeddings never written (ATR-018); per-project usage trend faked (ATR-020); MCP "running"/transcript viewer (ATR-021). |
| **4 — Intelligence**          | Deps, OSV, health score, smart suggestions, LLM tagging, activity   | ⛔ Not started (post-MVP). → [`FUTURE.md`](./FUTURE.md)                                                                                                                                                                                       |
| **5 — Polish & distribution** | Themes, signing, notarization, CI, auto-update, onboarding, DMG     | ⛔ Not started. `notarize.mjs` no-op, no `.github/`, unsigned build. → [`FUTURE.md`](./FUTURE.md)                                                                                                                                             |
| **6 — Cross-platform**        | Linux/Windows, worktrees, plugin API, sync                          | ⛔ Not started (intended). → [`FUTURE.md`](./FUTURE.md)                                                                                                                                                                                       |

## Critical path to the daily-driver MVP

Waves 1 + 2 (done): ✅ electron default, Claude tab, real search, tag/group persistence,
typecheck, de-flaked test, native shell (repo-open/tray icon/dock badge), fonts,
manual-group filter, frame-origin + shell-injection hardening, contracts, **Electron E2E 7/7**.

Wave 3 (next), in rough order (full detail + IDs in [`REMAINING-WORK.md`](./REMAINING-WORK.md)):

1. **Semantic search** — wire embedding writes into scan/rescan (Ollama-first), or honestly relabel the affordance (ATR-018); fix the FTS insert trigger (ATR-019).
2. **Claude-tab honesty** — real per-project usage trend (ATR-020); MCP "running" + transcript viewer (ATR-021).
3. **Command palette** — populate action context so Cmd-K "Copy Path"/open-in-editor work (ATR-022).
4. **Retire the legacy Next.js stack** (ATR-013) — archive `app/`+`components/`+`lib/`, drop `next` deps + `.next/`, remove the GPG scanner flake.
5. **Environment papercuts** — fix the nvm dotfile (ATR-024) and commit signing for agent sessions (ATR-025); finish the test-ABI automation tail (ATR-016).

After Wave 3 the app is a fully usable, opinionated daily driver; then Phase 4 (intelligence)
and Phase 5 (distribution / signed DMG).

## A note on the QA report

`qa-report.json` reflects the pre-Wave-1 Phase-3b unit gate and is now stale on counts and
E2E status (real numbers: unit 816/0/5, Electron E2E 7/7). Treat the living docs here as the
source of truth; `qa-report.json` is historical.

---

## Closure log

What has shipped, newest first.

| Date       | What shipped                                                                                                                                                                                                                                                                                                                                                                                                                             | Refs                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 2026-06-01 | **Wave 2 MVP** — native shell repo-open + real tray icon + dock badge (ATR-006/007/010); vendored fonts (ATR-008); manual-group filter (ATR-011); frame-origin hardening + dedup (ATR-014); shell-injection guard on resumeSessionId (ATR-026); claude-flow E2E fixed → full Electron E2E 7/7 (ATR-017); contract reconciliation (ATR-023); test:electron-e2e/test:full scripts (ATR-016 partial). Gate: tsc 0, vitest 816/0/5, E2E 7/7. | commits `11e377b`, `64651dc` |
| 2026-05-31 | **Wave 1 MVP** — Claude tab real data (138 projects); catalog search + tag/group persistence; `pnpm dev`→Electron; green typecheck; de-flaked test; Electron E2E running 5/6. Closed ATR-001/002/003/004/005/009/012/015. Commits unsigned (ATR-025).                                                                                                                                                                                    | commit `9e145de`             |
| 2026-05-31 | Project intake: ground-truth audit, living-plan docs, project agent-config, mission skill manifest.                                                                                                                                                                                                                                                                                                                                      | commit `5f97dd3`             |
| 2026-05-13 | Phases 0–3b (scaffold → Claude integration) at the unit/contract layer.                                                                                                                                                                                                                                                                                                                                                                  | branch history               |
| 2026-04-15 | Legacy Next.js MVP (`build/repo-hub-mvp`) — catalog, scanner, hybrid search, 24/24 QA gate.                                                                                                                                                                                                                                                                                                                                              | branch `build/repo-hub-mvp`  |
