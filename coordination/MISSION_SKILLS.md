# Mission skill manifest — AllTheRepos

Source: user `/orchestrator` request — "set up the project, intake the plans, rearrange the
docs, get the checklist in order so we can see where we ACTUALLY are." · Scanned: 2026-05-31

Every box ends either ✅ (invoked, with artifact path) or with a one-line reason for
deferral. This turn's mission was **intake + reorganization**, not a build — so build/UI
skills are intentionally deferred to the next session and seeded here for that build.

## Phase A — Intake & ground-truth assessment (this turn)

- ✅ `wiki-research` — N/A: no Obsidian wiki exists. Living-plan docs are the equivalent (now created).
- ✅ ground-truth audit — 8-agent parallel subsystem audit via Workflow tool → [`../docs/audits/2026-05-31-ground-truth-audit.md`](../docs/audits/2026-05-31-ground-truth-audit.md). Findings verified against live `tsc`/`vitest` runs and the real `~/.claude.json`.
- ◐ `plan-intake` — convention adopted and documented; the audit findings were intaked into the ledger as `ATR-001..023` in this turn. Future reports run through the skill formally.

## Phase B — Doc reorganization & project setup (this turn)

- ✅ `living-plan` — front door + strategic + tactical + frontier created: [`../START-HERE.md`](../START-HERE.md), [`../docs/PLAN.md`](../docs/PLAN.md), [`../docs/REMAINING-WORK.md`](../docs/REMAINING-WORK.md), [`../docs/FUTURE.md`](../docs/FUTURE.md). Stale docs moved to `docs/archive/`.
- ✅ project agent-config — [`../docs/agents/domain-docs.md`](../docs/agents/domain-docs.md), [`contract-format.md`](../docs/agents/contract-format.md), [`work-item-tracker.md`](../docs/agents/work-item-tracker.md). (`/setup-project-skills` is not an available skill in this environment; config authored directly per the user's choices: single-context, markdown contracts, local-markdown tracking.)

## Phase C — Daily-driver MVP build (deferred to next session)

The orchestrator would invoke these during the upcoming MVP build (tracked in
[`../docs/REMAINING-WORK.md`](../docs/REMAINING-WORK.md)). All deferred this turn — **build
not started; this turn was scoped to intake + reorg per the user.**

- [ ] `frontend-design` + `ui-ux-pro-max` — deferred; invoke during the UI-wiring work (ATR-003/004/005/008/011/012) for the catalog/groups/search surfaces and the design-system typefaces.
- [ ] `nano-banana` — deferred; the app needs a real tray icon (ATR-007) and could use seed imagery; generate when the native-shell polish work runs.
- [ ] `render-sanity` + `ux-review` — deferred; these are the post-build outcome gates. Run once the MVP features are wired and the Electron app boots (requires resolving the native-ABI E2E blocker, ATR-016/017). The audit already surfaced render-sanity-class issues (empty Claude tab, no-op tag/group affordances, dead search) — fixing those is the build work.
- [ ] `deployment-checklist` — deferred to Phase 5 (distribution); not on the MVP path.
- [ ] `qe-agent` / testing — deferred; the QE gate for new work attaches to the build, not this intake. Existing suite state is recorded in `docs/PLAN.md` and `qa-report.json`.
- [ ] `mermaid-charts` — optional; consider an architecture diagram for the README during MVP cleanup.
