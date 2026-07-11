# Build Plan — AllTheRepos

The roadmap and phase definitions, with an honest status for each phase and a closure
log of what has shipped. The full architecture rationale lives in the frozen
[`../NEW-PLAN.md`](../NEW-PLAN.md). Open work lives in [`REMAINING-WORK.md`](./REMAINING-WORK.md).

**Goal (current):** a **daily-driver MVP** — the Electron app you open every day:
catalog + launch actions + process detection + Claude tab, all on real data.

---

## Where we actually are

After three build waves, the app **builds, boots, and works on real data**, and is close to
a complete daily-driver MVP:

- **Catalog** — real FTS+vector search, tag/group persistence, manual-group filtering, design fonts.
- **Native shell** — spotlight/tray open repos, real template tray icon, dock badge tracks running servers.
- **Claude tab** — 138 real projects, real per-project usage trends, a transcript viewer.
- **Data** — embeddings now written on scan (degrade to FTS-only when Ollama is down); FTS tag-search fixed + self-healing.
- **Quality** — `tsc` clean, unit **858/0/5**, **Electron E2E 7/7**, frame-origin + shell-injection hardened.

What's left falls in two buckets: the original **cleanup** (legacy-stack retirement, the
test-ABI tail, two environment papercuts) and the **2026-07-11 audit intake** — 11 P1
data-safety/catalog-UX items (moved-repo identity, stale-row lifecycle, scanner blind
spots, last-opened accuracy, list-view gaps). All in [`REMAINING-WORK.md`](./REMAINING-WORK.md).

Baseline verified 2026-05-31 — see the [ground-truth audit](./audits/2026-05-31-ground-truth-audit.md).

## Phase status

| Phase                         | Plan deliverable                                                    | **Actual status**                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Scaffold**              | Window, IPC ping, security defaults                                 | ✅ Complete & verified.                                                                                                                                                                                                                                 |
| **1 — Feature parity**        | Catalog, scanner, hybrid search, 3-col UI, shortcuts                | ✅ Functional — real search, tag/group persistence, manual-group filter, fonts.                                                                                                                                                                         |
| **2 — Native shell**          | Tray, hotkey, spotlight, menu, notifications, deep-link, dock badge | ✅ Functional — spotlight/tray open repos, real tray icon, dock badge auto-driven.                                                                                                                                                                      |
| **3 — Deep integrations**     | Process detection, launcher, Claude integration, git deep view      | ✅ **Functional.** Claude tab real (138 projects, real per-project trends, transcript viewer); process/launcher run; embeddings wired (Ollama-gated); E2E 7/7. Deferred: MCP "running" status; semantic search only produces vectors when Ollama is up. |
| **4 — Intelligence**          | Deps, OSV, health score, smart suggestions, LLM tagging, activity   | ⛔ Not started (post-MVP). → [`FUTURE.md`](./FUTURE.md)                                                                                                                                                                                                 |
| **5 — Polish & distribution** | Themes, signing, notarization, CI, auto-update, onboarding, DMG     | ⛔ Not started. Unsigned build, no CI/updater. → [`FUTURE.md`](./FUTURE.md)                                                                                                                                                                             |
| **6 — Cross-platform**        | Linux/Windows, worktrees, plugin API, sync                          | ⛔ Not started (intended). → [`FUTURE.md`](./FUTURE.md)                                                                                                                                                                                                 |

## What's left for the daily-driver MVP

Waves 1–3 (done): electron default, Claude tab + real trends + transcript viewer, real search +
embeddings + FTS fix, tag/group persistence + manual-group filter, native shell (repo-open / tray
icon / dock badge), fonts, command-palette context, frame-origin + shell-injection hardening,
green typecheck, de-flaked test, **Electron E2E 7/7**.

Remaining (full detail in [`REMAINING-WORK.md`](./REMAINING-WORK.md)):

1. **Retire the legacy Next.js stack** (ATR-013) — its own focused pass (touches deps/lockfile/build-config).
2. **Test-ABI automation tail** (ATR-016) — the `install-app-deps` fallback + test-db helper alignment.
3. **Environment papercuts** — nvm dotfile (ATR-024), commit signing for agent sessions (ATR-025).
4. **2026-07-11 audit intake — 11 P1 items** ([audit](./audits/2026-07-11-data-safety-scan-ux-audit.md)):
   - _Data safety:_ moved-repo identity matching (ATR-027), stale-repo lifecycle + delete (ATR-028), last-opened stamped on every open (ATR-030).
   - _Scanner:_ nested/root-is-a-repo discovery (ATR-033), auto-detect new projects via watcher (ATR-037).
   - _Catalog UX:_ first-run flow (ATR-038), sort + last-opened surfacing (ATR-040), description/details on card+detail (ATR-041), lift the 200 cap (ATR-042), group-membership UI (ATR-043), list/table view (ATR-045).
   - The audit's 8 P2 findings + 4 speculative directions were not intaken (P1-only approval) and remain in the audit doc.

After that: Phase 4 (intelligence: deps/health/LLM tagging) and Phase 5 (signed, notarized,
auto-updating DMG) per [`FUTURE.md`](./FUTURE.md).

## A note on the QA report

`qa-report.json` reflects the pre-Wave-1 Phase-3b unit gate and is stale (real numbers: unit
858/0/5, Electron E2E 7/7). Treat the living docs here as the source of truth.

---

## Closure log

| Date       | What shipped                                                                                                                                                                                                                                                                                                                               | Refs                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 2026-07-11 | **Audit intake** — data-safety/scanner/UX harsh review (3 parallel review agents, 2 findings hand-verified) → audit doc + 11 approved P1 ledger entries (ATR-027/028/030/033/037/038/040–043/045). Headline: no purge path exists, but moved repos duplicate + strand metadata; scanner prunes nested repos; last-opened mostly unstamped. | [audit](./audits/2026-07-11-data-safety-scan-ux-audit.md) |
| 2026-06-01 | **Wave 3 MVP** — embedding write-path + FTS-trigger fix/backfill (ATR-018/019); real per-project Claude usage trend + transcript viewer (ATR-020/021); command-palette action context + launch actions (ATR-022). Gate: tsc 0, vitest 858/0/5, E2E 7/7.                                                                                    | commit `4bc9969`                                          |
| 2026-06-01 | **Wave 2 MVP** — native shell repo-open + tray icon + dock badge (ATR-006/007/010); fonts (ATR-008); manual-group filter (ATR-011); frame-origin hardening (ATR-014); shell-injection guard (ATR-026); E2E fixed → 7/7 (ATR-017); contracts (ATR-023); e2e scripts (ATR-016).                                                              | commits `11e377b`, `64651dc`                              |
| 2026-05-31 | **Wave 1 MVP** — Claude tab real data; catalog search + tag/group persistence; `pnpm dev`→Electron; green typecheck; de-flaked test (ATR-001/002/003/004/005/009/012/015). Commits unsigned (ATR-025).                                                                                                                                     | commit `9e145de`                                          |
| 2026-05-31 | Project intake: ground-truth audit, living-plan docs, agent-config, mission skill manifest.                                                                                                                                                                                                                                                | commit `5f97dd3`                                          |
| 2026-05-13 | Phases 0–3b (scaffold → Claude integration) at the unit/contract layer.                                                                                                                                                                                                                                                                    | branch history                                            |
| 2026-04-15 | Legacy Next.js MVP (`build/repo-hub-mvp`).                                                                                                                                                                                                                                                                                                 | branch `build/repo-hub-mvp`                               |
