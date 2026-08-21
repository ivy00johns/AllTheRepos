# AllTheRepos — Production Readiness — Architecture Reasoning

> Companion to [`../PLAN.md`](../PLAN.md) (strategic roadmap) and
> [`../REMAINING-WORK.md`](../REMAINING-WORK.md) (tactical ledger). This plan sequences the
> path from "works great on John's machine" to "a signed .dmg you'd put on a release page."
> Build spec for the orchestrator is Section 2.

## What This Is

AllTheRepos is a local-first macOS Electron hub for the hundreds of git repos on one
machine. Four build waves took it through Phases 0–3: it builds, boots, and runs on real
data (real FTS+vector search, native shell integration, a Claude tab reading 138 real
projects, and Wave 4's data-safety core). This plan closes the last 8 P1 items that stand
between it and a credible daily driver, then does the thing nobody has started — makes it
**distributable**: signed, notarized, CI-built, and self-updating.

The distinction matters because it is the central finding of this plan: **the existing
ledger does not contain "production ready."** Every open `ATR-###` item targets the
_daily-driver MVP_ — an app that is good on the machine it was written on. Everything that
makes it a product someone else could install is Phase 5, parked in
[`../FUTURE.md`](../FUTURE.md) and never promoted into the ledger. Wave B below promotes it.

## Source Material Analysis

Read this session: `START-HERE.md`, `CLAUDE.md`, `docs/PLAN.md`, `docs/REMAINING-WORK.md`,
`docs/FUTURE.md`, plus direct source inspection of the scanner, catalog renderer, shared
schemas, and build config.

**Build health, verified live (2026-08-21) — not read off the docs:**

| Gate           | Result                                            |
| -------------- | ------------------------------------------------- |
| `tsc --noEmit` | **0 errors**                                      |
| `vitest run`   | **879 passed / 5 skipped / 0 failed** (884 total) |

The first `pnpm test` run reported 30 failures across 9 files. That is the documented
native-ABI footgun (ATR-016), not a regression: `better-sqlite3` was compiled against
Electron's `NODE_MODULE_VERSION 135` and host Node wants `127`. After
`pnpm rebuild better-sqlite3 find-git-repositories` the suite is fully green — including
the legacy GPG scanner test that flaked during Wave 4.

### Ledger corrections found by reading the code

Two ledger rows are imprecise in ways that change how the work should be scoped. These
should be corrected during intake, not silently worked around:

1. **ATR-042 is a contract change, not just a UI change.** The row reads as "the UI passes
   `limit:200`." But `ListReposInputSchema` (`src/shared/schemas.ts:189`) declares
   `limit: z.number().int().min(1).max(200)` — **200 is a hard schema ceiling**, so no
   caller can ask for more. Lifting the cap means amending the IPC contract and its Zod
   schema, or building pagination on the `offset` field that already exists. This makes it
   the one Wave A item that needs a contract authored before agents spawn.

2. **ATR-041 is half-done already.** The row says "the detail view never renders
   `repo.description`." The detail view indeed doesn't — but `repo-card.tsx:111` _already_
   renders `repo.description` with a "No description" italic fallback. So the real gap is
   narrower than written: description on the **detail** view, plus `lastCommitMsg` /
   `sizeBytes` / `lastOpenedAt`, which are rendered nowhere in the catalog at all.

A third, smaller one: ATR-016 describes the `install-app-deps` fallback as "still dead
code." It is _implemented_ in `scripts/rebuild-natives.mjs` (the `else` branch) but never
executes, because `@electron/rebuild` resolves — so the branch is unreachable in practice
rather than unwritten. The real ATR-016 work is the ABI flip automation that CI needs.

### Confirmed root causes

- **ATR-033** — `scanner.worker.ts` calls `findGitRepos(root)` from the
  `find-git-repositories` native module, which prunes a subtree at the first `.git` it
  finds. If a scan root _is_ a repo, the scan discovers exactly one repo and everything
  beneath it is invisible. The fix cannot be inside the native walker — roots must be
  pre-expanded before it is called.
- **ATR-037** — `ScanService.boot()` is literally `// intentional no-op`
  (`src/main/services/scan.ts`). No watcher, no scan-on-launch. `chokidar` is already a
  dependency and the Claude watcher is an existing pattern to mirror.
- **ATR-040** — `sort: "lastOpened"` already exists in `schemas.ts:187` and `types.ts:118`
  and is honoured by the query layer. This is a pure UI gap.
- **ATR-043** — `useSetGroupMembers` exists (`use-groups.ts:157`), the preload bridge
  exists (`api.ts:217`), the IPC handler exists (`ipc/groups.ts`). Zero component callers.
  Manual groups can be created and deleted but never populated.

## Key Decisions

1. **Merge to `main` before anything else, and treat it as non-negotiable.** `main` is
   **19 commits behind** `feat/move-safety`. All four build waves — every feature this
   project has — exist only on one unmerged branch, on one disk, with **no git remote
   configured at all**. This is the single largest risk to the project and it is not
   tracked by any ATR item. The merge is local, reversible, and costs minutes.

2. **A git remote is a user decision, not an agent action.** Creating a remote publishes
   the repository somewhere. It is also a hard prerequisite for most of Wave B — GitHub
   Actions CI and an auto-update feed cannot exist without a hosted origin. The plan
   presents the choice; it does not make it. See _Blocking Decisions_.

3. **Retire the legacy Next.js stack (ATR-013) FIRST, before the parallel UX wave — not
   after.** The ledger correctly notes it needs a solo pass because it touches
   `package.json` / lockfile / tsconfig. But there is a second, stronger reason to
   front-load it: the tree currently contains **two** `catalog-shell.tsx` files — the live
   one at `src/renderer/components/catalog/` and the superseded legacy one at
   `components/catalog/`, from which the live one was ported. Four parallel UX agents
   loose in a tree with two near-identical catalog shells is an obvious way to get work
   done in the wrong file. Deleting the decoy before the wave costs one pass and removes
   the whole failure mode.

4. **Group the catalog UX items by file ownership, not by ledger ID.** ATR-040/042/045
   (sort control, cap lift, table view) are one coherent piece of work — a sortable
   paginated table _is_ the intersection of all three — and they all live in
   `catalog-shell.tsx` / `repo-grid.tsx` / `routes/index.tsx`. Splitting them across
   agents guarantees conflicts. Meanwhile ATR-041/043 both live in the card and detail
   components. So the wave splits 3-ways by file, not 6-ways by ID.

5. **First-run (ATR-038) ships as a component with a seam, not as a route edit.** It needs
   `routes/index.tsx`, which the catalog-list agent owns. Rather than sharing a file, the
   first-run agent delivers a self-contained `<FirstRunEmptyState />` and the catalog-list
   agent mounts it. One import, one contract, zero overlap.

6. **ATR-016 (test-ABI automation) is promoted from P2 to a Wave 0 blocker.** Not because
   it got more important on its own, but because **CI cannot hand-flip native ABIs**. A
   GitHub Actions run that does `pnpm test` on a tree built for Electron will fail exactly
   the way this session's first run did. Every Wave B CI item depends on this.

7. **Signing is gated on an Apple Developer Program membership the project does not have.**
   Notarization requires a paid membership (~$99/yr), a Developer ID Application
   certificate, and an App Store Connect API key. No agent can obtain these. This is
   surfaced as a blocking decision with a documented fallback rather than being discovered
   halfway through Wave B.

8. **Keep the ledger as the source of truth.** New Phase 5 items get real `ATR-###` IDs
   (046–052) appended to `docs/REMAINING-WORK.md` via the project's normal `plan-intake`
   convention, and Phase 5 gets struck from `FUTURE.md` as it promotes. This plan is a
   sequencing document; the ledger stays canonical.

## Blocking Decisions (need the user, before Wave B)

| #      | Decision                                                                        | Why it blocks                                                                                             | Options                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | **Where does the git remote live?**                                             | ATR-047/048/049 (CI, releases, update feed) are impossible without a hosted origin. Also the only backup. | GitHub private repo (unlocks all of Wave B) · GitHub public · a non-GitHub remote (CI/updater must be re-planned) · local-only clone to an external disk (backup only, Wave B stays blocked) |
| **D2** | **Do you have / will you buy an Apple Developer membership?**                   | Real signing + notarization (ATR-046) is impossible without it.                                           | Yes → full signed + notarized DMG · No → ship an unsigned or ad-hoc-signed DMG with documented right-click-open, defer 046/048 · Undecided → Wave B proceeds on CI + updater plumbing only   |
| **D3** | **Is a separate onboarding window (ATR-050) still wanted after ATR-038 ships?** | ATR-038's in-app first-run CTA may make it redundant. Cheaper to decide after seeing 038.                 | Decide at the Wave A gate — deliberately deferred, not forgotten                                                                                                                             |

## Assumptions and Risks

- **Assumed:** the app remains macOS-arm64-only. `electron-builder.yml` targets
  `dmg / arm64` and Phase 6 (cross-platform) stays out of scope. An Intel or universal
  build is a separate decision.
- **Assumed:** `limit`'s 200 ceiling is lifted via **pagination/virtualization on the
  existing `offset` field**, keeping the schema's max intact, rather than by raising the
  cap to an arbitrary larger number. Raising the number just moves the silent cliff. If
  you'd rather raise the cap, say so before the contract is authored.
- **Risk:** ATR-037's watcher on `scanPaths` could be expensive if a scan path is a large
  tree — chokidar on a home directory is a known foot-gun. Requires depth-limiting and
  debouncing, and should be benchmarked against the real scan paths, not a fixture.
- **Risk:** ATR-033's fix (pre-expanding roots) changes discovery semantics for **existing
  catalogs**. A user whose scan root is a repo will suddenly discover many new repos on the
  next scan. That is the intended fix, but it interacts with Wave 4's rebind logic
  (ATR-027) and deserves an explicit test that a nested-repo discovery does not rebind onto
  its parent.
- **Risk:** Wave A's four agents all run against the same test suite; the ABI flip
  (ATR-016) must land before they start or their local gates will report phantom failures.
- **Unverified:** Electron E2E was documented at 7/7 but was **not re-run this session**
  (it requires flipping natives back to the Electron ABI). Treat 7/7 as last-known-good,
  and re-run it as the Wave 0 gate.
- **Out of scope:** Phase 4 (intelligence: deps, OSV scanning, health score, LLM tagging)
  and Phase 6 (cross-platform, plugin API, sync) stay in `FUTURE.md`.

---

# AllTheRepos — Production Readiness — Build Plan

> **For orchestrated builds:** use the orchestrator skill to execute Wave A with parallel
> agents. Wave 0 and Wave B-solo items are sequential and should not be parallelized.

## Goal

Ship AllTheRepos as a **signed, notarized, auto-updating macOS .dmg**, built by CI from a
backed-up repository, whose catalog credibly handles hundreds of repos — sortable, listable,
paginated, with description / last-opened / commit / size surfaced, groups populatable, new
repos auto-detected, and nested repos actually discovered.

**Done means:** a fresh macOS machine can download a DMG, open it without a Gatekeeper
fight, complete a first-run scan, browse 500+ repos, and receive an update automatically.

## Tech Stack

- **Runtime:** Node 22 (`.nvmrc`), pnpm 9 (pinned)
- **Shell:** Electron + electron-vite; `src/main` (backend: DB, services, IPC, native shell),
  `src/renderer` (Vite + React 19, talks only through `window.atr.*`), `src/shared`
  (types / Zod / IPC constants)
- **Data:** better-sqlite3 + Drizzle, FTS5, LanceDB vectors (Ollama-gated)
- **Renderer:** TanStack Router + TanStack Query, Radix UI, Tailwind, cmdk
- **Watching:** chokidar 5 (already a dependency; Claude watcher is the reference pattern)
- **Packaging:** electron-builder → `dmg / arm64`; `electron-updater` (dependency, unwired)
- **Tests:** vitest (unit/contract), Playwright (`tests/e2e`, Electron)
- **CI target:** GitHub Actions (gated on D1)

## Components

### `scanner` — discovery correctness and freshness

- **Responsibility:** find every repo under the configured roots, and notice new ones without being asked
- **Owns:** `src/main/workers/scanner.worker.ts`, `src/main/services/scan.ts`
- **Depends on:** none
- **Key features:** root pre-expansion so a root-that-is-a-repo doesn't mask its children (ATR-033); nested-repo continuation past a `.git` hit; a debounced chokidar watcher on `scanPaths` plus a real `boot()` that runs an incremental scan on launch (ATR-037)

### `catalog-list` — the list surface at scale

- **Responsibility:** make the catalog usable at 500+ repos
- **Owns:** `src/renderer/routes/index.tsx`, `src/renderer/components/catalog/catalog-shell.tsx`, `repo-grid.tsx`, new `repo-table.tsx`
- **Depends on:** `contract:list-pagination` (below); mounts `<FirstRunEmptyState />` from `first-run`
- **Key features:** header sort dropdown wired to the existing `sort` param including `lastOpened` (ATR-040); pagination or virtualization replacing the silent 200 cap, with counts that report the true total instead of "200 of 200" (ATR-042); a compact sortable table view toggleable with the card grid (ATR-045)

### `repo-surface` — the card and detail surfaces

- **Responsibility:** show the details that make the catalog feel professional
- **Owns:** `src/renderer/components/catalog/repo-card.tsx`, `repo-detail-content.tsx`, `detail-panel.tsx`
- **Depends on:** none
- **Key features:** description paragraph on the **detail** view (the card already has one — see corrections); `lastCommitMsg` + `sizeBytes` chips on the card; `lastOpenedAt` on card and detail with exact-date hover (ATR-041); add-to-group affordance on detail plus a card context action, wiring the orphaned `useSetGroupMembers` (ATR-043)

### `first-run` — the empty state that isn't a dead end

- **Responsibility:** turn "No repos match / adjust your filters" into a scan
- **Owns:** new `src/renderer/components/catalog/first-run-empty-state.tsx`
- **Depends on:** none. **Exports** `<FirstRunEmptyState />` for `catalog-list` to mount
- **Key features:** distinguish unconfigured-empty (no `scanPaths`) from filtered-empty (ATR-038); native folder-picker CTA; kick the first scan and show its progress

### `distribution` — Wave B, the part that makes it a product

- **Responsibility:** signed, CI-built, self-updating releases
- **Owns:** `electron-builder.yml`, `scripts/notarize.mjs`, new `.github/workflows/`, updater wiring in `src/main`
- **Depends on:** D1 (remote), D2 (Apple membership), ATR-013, ATR-016
- **Key features:** real signing + notarization; CI on push/PR; tag-triggered release; `electron-updater` actually imported and fed

## Shared Data Models

Only one contract changes, and it must be authored **before** Wave A agents spawn:

**`contract:list-pagination`** — `src/shared/schemas.ts` + `src/shared/types.ts` +
`contracts/ipc.*.md`

```
ListReposInput.limit   // currently z.number().int().min(1).max(200)  ← the hard ceiling
ListReposInput.offset  // already exists, z.number().int().nonnegative().optional()
ListReposResult.total  // already exists — must report the TRUE total, not the page size
```

The decision to encode (per Assumptions): keep the per-page `max(200)` and paginate via
`offset`, with `total` reporting the real row count. Every consumer of `ListReposResult`
must treat `items.length` as a page, never as the count. `catalog-list` is the only agent
permitted to change these files.

## Dependency Graph

```
Wave 0 (sequential, solo)
  merge feat/move-safety → main
    └─ D1: remote decision ──────────────────┐
  ATR-013 legacy retirement (removes decoy)  │   (blocks most of Wave B)
    └─ ATR-016 ABI automation ───────────────┤
                                             │
Wave A (parallel, 4 agents) ←── contract:list-pagination authored first
  scanner        (ATR-033, ATR-037)          │
  catalog-list   (ATR-040, ATR-042, ATR-045) │
  repo-surface   (ATR-041, ATR-043)          │
  first-run      (ATR-038) ──exports──▶ catalog-list mounts
                                             │
Wave B (mostly sequential) ◀─────────────────┘
  ATR-046 signing+notarization  ← D2
  ATR-047 CI (typecheck/unit/e2e)  ← ATR-016, D1
  ATR-048 release workflow → DMG  ← 046, 047
  ATR-049 auto-update wiring      ← 048
  ATR-050 onboarding window       ← D3 (decide at Wave A gate)
  ATR-051 branded DMG + installer layout
  ATR-052 release docs + version/changelog discipline
```

## Key Features

Ordered by dependency; independent items first.

**Wave 0 — safety and foundation (solo, sequential)**

1. Merge `feat/move-safety` → `main` (19 commits) — _no component; git hygiene_
2. Resolve **D1** and configure a remote + first push — _user decision, then git_
3. ATR-013 — retire the legacy Next.js stack: archive `app/`/`components/`/`lib/`, drop `next` + `eslint-config-next` + the `@next` tsconfig plugin, remove legacy `playwright.config.ts` and `e2e/`, resync the lockfile — _solo pass, touches deps_
4. ATR-016 — automate the native-ABI flip so tests and CI never need a manual `pnpm rebuild` — _prerequisite for all CI_

**Wave A — daily-driver MVP (4 parallel agents)** 5. ATR-033 — root-is-a-repo / nested-repo discovery — _scanner_ 6. ATR-037 — watcher on `scanPaths` + real `boot()` incremental scan — _scanner_ 7. ATR-040 — header sort control incl. last-opened — _catalog-list_ 8. ATR-042 — lift the silent 200 cap; true counts — _catalog-list_ 9. ATR-045 — list/table view toggle — _catalog-list_ 10. ATR-041 — description on detail; commit-msg / size / last-opened surfacing — _repo-surface_ 11. ATR-043 — group-membership UI wiring `useSetGroupMembers` — _repo-surface_ 12. ATR-038 — first-run empty state + folder picker + first scan — _first-run_

**Wave B — distribution (new ledger IDs, mostly sequential)** 13. ATR-046 — code signing + notarization: real `identity`, `hardenedRuntime: true`, implement `scripts/notarize.mjs` — _distribution, gated on D2_ 14. ATR-047 — GitHub Actions CI: typecheck + unit + Electron E2E on push/PR — _distribution, gated on D1 + ATR-016_ 15. ATR-048 — tag-triggered release workflow producing a signed DMG to GitHub Releases — _distribution_ 16. ATR-049 — auto-update: import `electron-updater`, configure the feed, add a user-visible update affordance — _distribution_ 17. ATR-050 — first-run onboarding window (scan paths, default editor/terminal, hotkey) — _distribution, gated on D3_ 18. ATR-051 — branded DMG background + installer layout — _distribution_ 19. ATR-052 — release docs, versioning, and changelog discipline — _distribution_

## Validation Criteria

**Wave 0 gate**

- [ ] `git log main..feat/move-safety` is empty — the branch is merged
- [ ] `git remote -v` shows an origin and `main` has been pushed (or D1 chose local-only, recorded in the ledger)
- [ ] No `next` in `package.json` dependencies; `app/`, `components/`, `lib/`, `e2e/`, legacy `playwright.config.ts` are gone or archived
- [ ] Exactly **one** `catalog-shell.tsx` remains in the tree
- [ ] `pnpm test` passes **without** a manual `pnpm rebuild` beforehand
- [ ] `tsc --noEmit` 0 errors; `pnpm test:electron-e2e` re-run and green (re-establish the 7/7 baseline)

**Wave A gate**

- [ ] A scan root that is itself a git repo discovers the root **and** every nested repo beneath it (regression test with a fixture)
- [ ] A nested repo discovered under a parent repo does **not** rebind onto its parent (ATR-027 interaction test)
- [ ] Creating a new repo inside a scan path makes it appear in the catalog without a manual scan
- [ ] `boot()` runs an incremental scan on launch
- [ ] A catalog of **500+** repos is fully reachable; the count reads the true total, never "N of N" where N is the page size
- [ ] Sort by name / last commit / last scanned / **last opened** works from the main window
- [ ] Table view and card view both render and toggle; sort applies to both
- [ ] Detail view renders `description`; card renders `lastCommitMsg`, `sizeBytes`, `lastOpenedAt` with exact-date hover
- [ ] A repo can be added to a manual group from the UI, and the group filter then finds it
- [ ] With no `scanPaths` configured, the app shows a scan CTA — not "adjust your filters"
- [ ] `tsc` 0 · `vitest` green (with new tests) · Electron E2E green
- [ ] `docs/REMAINING-WORK.md` and `docs/PLAN.md` updated; closure log entries written

**Wave B gate**

- [ ] `spctl -a -vvv` and `codesign -dv --verbose=4` pass on the built `.app` (or D2 chose unsigned, recorded with the documented open workaround)
- [ ] `xcrun stapler validate` passes on the DMG
- [ ] CI runs typecheck + unit + Electron E2E on every push and blocks on failure
- [ ] Pushing a version tag produces a downloadable DMG artifact without manual steps
- [ ] A running older build detects, downloads, and applies an update
- [ ] A DMG installed on a **second** machine completes first-run and scans successfully
- [ ] Phase 5 struck from `FUTURE.md`; ATR-046…052 closed in the ledger

## Agent Hints

- **Suggested team size: 4 for Wave A.** Wave 0 and Wave B are sequential by nature —
  Wave 0 touches the lockfile and git topology, Wave B is a dependency chain
  (sign → CI → release → update). Parallelizing either buys nothing and costs conflicts.
- **Natural splits:** the Wave A four are file-disjoint by construction. `scanner` is
  entirely `src/main`; the other three are entirely `src/renderer` and own separate files.
- **Coordination risks:**
  - `catalog-list` and `repo-surface` both render repo data. **`repo-card.tsx` belongs to
    `repo-surface` alone** — `catalog-list` must not edit it, even while building the table
    view. If the table needs a cell primitive, it builds its own in `repo-table.tsx`.
  - `routes/index.tsx` belongs to `catalog-list` alone. `first-run` delivers a component
    and never touches the route.
  - `contract:list-pagination` must be authored and frozen **before** spawning, per
    orchestrator Phase 4. `catalog-list` is its only permitted editor.
  - ATR-033 (scanner) interacts with ATR-027 (Wave 4 rebind logic). The scanner agent must
    read `upsertRepo`'s matching rules before changing discovery, and add the
    nested-vs-parent rebind test named in the Wave A gate.
- **Environment, non-negotiable for every agent:** Node 22 via `.nvmrc`. Bare
  `node`/`npx`/`npm` recurse on this machine (broken nvm dotfile, ATR-024) — use
  `~/.nvm/versions/node/v22.22.3/bin/node` or put it on PATH. Commits need
  `--no-gpg-sign` in non-interactive sessions (ATR-025).
- **Special handling:** run `pnpm test:full` rather than `pnpm test` when natives may be in
  the Electron ABI, or agents will chase 30 phantom failures. This stops mattering once
  ATR-016 lands, which is exactly why it is a Wave 0 blocker.
- **Ledger corrections to apply during intake:** ATR-042 is a contract change (schema
  `max(200)`); ATR-041 is partly done (card already renders description); ATR-016's
  fallback is unreachable rather than unwritten. See Source Material Analysis.
