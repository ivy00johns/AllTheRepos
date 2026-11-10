---
title: How to read this
tags: [how-to-read-this]
paths: [correctness/security/test, FUTURE.md, audits/2026-05-31-ground-truth-audit.md, data-safety/scan/UX, audits/2026-07-11-data-safety-scan-ux-audit.md, PLAN.md, "858/0/5**", "7/7**", ATR-027/028/030, plans/2026-08-21-production-readiness-plan.md, Next.js, ATR-053/054, feat/alltherepos-mcp, ATR-037/038/040/045/049**, ATR-041/048/052, ATR-056/057/058**, ATR-033/042/043/046/047/050/051/053/054/055, UI/UX, audits/2026-10-07-ui-ux-review.md, P2/P3]
updated: 2026-11-10
---

Imported from `docs/REMAINING-WORK.md:6` by Andon (import docs/REMAINING-WORK.md:6 ac19b0f60e377f47); the original stays there.

- **ID** — `ATR-###`. Stable, never reused.

- **P** — priority vs the goal (**a daily-driver MVP**): `P0` blocker · `P1` credible-daily-driver · `P2` correctness/security/test · `P3` future ([`FUTURE.md`](./FUTURE.md)).

- **Source** — ATR-001…026 mostly trace to the [2026-05-31 ground-truth audit](./audits/2026-05-31-ground-truth-audit.md); ATR-027+ trace to the [2026-07-11 data-safety/scan/UX audit](./audits/2026-07-11-data-safety-scan-ux-audit.md) (finding IDs `DS-*`/`SC-*`/`UX-*` cited per row).

- **Status** — `open` · `in-progress` · `◐ partial` · `✅ done` · `deferred`. Done items also get a [`PLAN.md`](./PLAN.md) closure-log line.

> Intake rule: reports (audits, deep-dives, QA) go through the `plan-intake` skill → proposed entries → approval.

> **Status (after Wave 3, 2026-06-01):** 22 of 26 items closed across Waves 1–3. The app
> builds, boots, and works on real data; `tsc` clean, **vitest 858/0/5**, **Electron E2E 7/7**.
> Open: legacy-stack retirement, the test-ABI automation tail, and two environment papercuts.
>
> **Intake (2026-07-11):** the data-safety/scan/UX audit added **11 P1 items (ATR-027…045)**
> — moved-repo identity, stale-row lifecycle, scanner blind spots, last-opened accuracy, and
> catalog list UX. Its 8 P2 findings and 4 speculative directions were **not** intaken
> (approver chose P1-only); they remain in the audit doc for a later pass.
>
> **Wave 4 (2026-07-13):** ATR-027/028/030 shipped — 8 of the 11 remain open.
>
> **Wave 0 (2026-08-21):** the goal widened from *daily-driver MVP* to **production
> ready** — see [`plans/2026-08-21-production-readiness-plan.md`](./plans/2026-08-21-production-readiness-plan.md).
> Foundation work landed: `main` fast-forwarded past 19 unmerged commits and pushed to a
> GitHub remote (the project previously existed on one disk with no backup), the legacy
> Next.js stack retired (ATR-013), and the native-ABI flip automated (ATR-016). Phase 5
> distribution was promoted out of `FUTURE.md` into **ATR-046…052**; ATR-053/054 record
> fallout from the retirement. The 8 Wave-A P1s are unchanged and next.
>
> **Wave 5 — catalog v2 + MCP (2026-08-24–25; committed 2026-10-06):** a large wave was
> built in one session and left uncommitted for six weeks. It is now 7 commits on
> `feat/alltherepos-mcp` (`bfbe3ab..9c295ce`), pushed to origin but **not merged to `main`**.
> It **closed ATR-037/038/040/045/049**, left **ATR-041/048/052 partly done**, and added
> **ATR-056/057/058**. `ATR-033/042/043/046/047/050/051/053/054/055` are unchanged.
>
> **Intake (2026-10-07):** the [UI/UX review](./audits/2026-10-07-ui-ux-review.md) added
> **16 items (ATR-059…074)** — four P1 (two accessibility blockers, two viewport-height
> clipping bugs) and the rest P2/P3 — after the `/graph` button rework closed plan findings
> A1, A2, A4 and A6 and left A3 (node keyboard access) and A5 (`.atr-segment` sizing) partly
> open. Nothing was fixed in that pass; the sweep files rather than touches.
>
> **Workstream A (2026-10-08):** the four P1s — **ATR-059…062** — closed on PR #4's branch,
> each proved on the running app and each gated by a spec that fails on the old markup
> (`nav-card-a11y.spec.ts`, `layout-overflow.spec.ts`).
>
> **Workstream B (2026-10-08):** the seven P2s from the same review — **ATR-063…069** — are
> closed, plus **ATR-075**, a stray JSX comment that rendered as text on every route and was
> found only by looking at the app rather than at the tests. The two states a first paint
> never reaches (the failed read, the read in flight) are forced from the main process in
> `tests/e2e/workstream-b.spec.ts`, and all four routes the height contract had never measured
> are now held to it in `layout-overflow.spec.ts`.
>
> **Workstream C (2026-10-08):** the last five from that review — **ATR-070…074**, the P3s —
> are closed, each proved on the running app by `tests/e2e/workstream-c.spec.ts`: an `h1` on the
> two routes that opened at `h2`, a skip link that lands in `main` itself, one decided type
> scale with a guard that fails the build on a raw sub-12px size, a live-status token of its
> own instead of the accent, and `/debug` out of the primary navigation. That empties the
> 2026-10-07 UI/UX intake — ATR-059…075 are all closed. What remains open is the pre-existing
> tail above, which has nothing to do with the design review.
