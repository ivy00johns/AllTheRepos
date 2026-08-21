# Remaining Work — AllTheRepos

The tactical ledger. Every open item, ID'd, prioritized, and sourced. Status at a glance is in
[`../START-HERE.md`](../START-HERE.md); the roadmap + phase definitions in [`PLAN.md`](./PLAN.md).

## How to read this

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

---

## Open / remaining

| ID      | P   | Area        | Summary                                                                                                                                                                                                                                                                                                                                                                                                                          | Status    |
| ------- | --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| ATR-033 | P1  | scanner     | **Discovery: root-is-a-repo / nested repos** — the native walker prunes a subtree at the first `.git`, so a scan root that is itself a git repo indexes 1 repo and hides everything beneath it. Pre-expand roots / keep queuing subdirs after a repo hit. [SC-1]                                                                                                                                                                 | open      |
| ATR-037 | P1  | scan        | **Auto-detect new projects** — no watcher on `scanPaths` and no scan-on-launch (`scanService.boot()` is a no-op); new repos are invisible until a manual "Scan now". Debounced chokidar watcher (mirror the Claude watcher) → incremental scan. [SC-6]                                                                                                                                                                           | open      |
| ATR-038 | P1  | ux          | **First-run flow** — fresh install shows "No repos match / adjust your filters" with no scan CTA; the only trigger is buried in Settings. Distinguish unconfigured-empty from filtered-empty; folder-picker CTA + first scan. [SC-7/UX-3]                                                                                                                                                                                        | open      |
| ATR-040 | P1  | ui          | **Sort control + last-opened surfacing** — `sort:"lastOpened"` exists in the store, schema, and query layer but no main-window UI exposes it, and `lastOpenedAt` is never rendered outside the tray. Header sort dropdown → `useRepos`; last-opened on card + detail with exact-date hover. Pairs with ATR-030. [UX-1/UX-2]                                                                                                      | open      |
| ATR-041 | P1  | ui          | **Surface description + key details** — the detail view never renders `repo.description`; `lastCommitMsg` and `sizeBytes` are rendered nowhere. Description paragraph in detail; commit-message + size chip on the card. [UX-4/UX-7]                                                                                                                                                                                             | open      |
| ATR-042 | P1  | ui          | **Lift the silent 200-repo cap** — `useRepos({limit:200})` + a non-virtualized grid mounting a live card per repo; repos 201+ are invisible and the count reads "200 of 200". Pagination or virtualization + true counts. [UX-5]                                                                                                                                                                                                 | open      |
| ATR-043 | P1  | ui          | **Group-membership UI** — `useSetGroupMembers` and the `groups.setMembers` preload bridge have zero callers; manual groups can be created/renamed/deleted but never populated. Add-to-group affordance on detail + card context action. [UX-6]                                                                                                                                                                                   | open      |
| ATR-045 | P1  | ui          | **List/table view toggle** — card grid only today; wrong primitive for triaging hundreds of repos. Compact sortable table (name/description/last-opened/size) toggleable with cards. Pairs with ATR-040/042. [UX-8]                                                                                                                                                                                                              | open      |
| ATR-046 | P1  | dist        | **Code signing + notarization** — `electron-builder.yml` ships `identity: null` + `hardenedRuntime: false`, and `scripts/notarize.mjs` is an explicit no-op placeholder. Needs a Developer ID Application cert + App Store Connect API key (see D2 in the plan). Blocked on an Apple Developer Program membership.                                     | open      |
| ATR-047 | P1  | dist        | **CI on GitHub Actions** — no `.github/` exists. Run `typecheck` (all three tsconfigs) + `vitest` + Electron E2E on push/PR. Unblocked by ATR-016: CI can no longer be defeated by the native-ABI flip.                                                                                                                                             | open      |
| ATR-048 | P1  | dist        | **Release workflow** — tag push → signed, notarized DMG published to GitHub Releases. Depends on ATR-046 + ATR-047.                                                                                                                                                                                                                                 | open      |
| ATR-049 | P1  | dist        | **Auto-update** — `electron-updater` is a dependency but imported nowhere in `src/`. Wire the GitHub Releases feed + a user-visible update affordance. Depends on ATR-048.                                                                                                                                                                          | open      |
| ATR-055 | P1  | perf        | **~22s cold start — the window is gated on service boot.** `app.whenReady()` awaits `processService.boot()` → `launcherService.boot()` → `claudeService.boot()` *before* creating the main window, so nothing paints until every service finishes. Measured on 2026-08-21: process **18.4s**, claude **5.6s**, launcher **1.5s** (~26s to first paint). Making the process prime-tick fire-and-forget cut it to ~22s, but the concurrent `lsof` sweep still saturates the main thread while the other services boot. Real fix: register IPC handlers, create the window, THEN boot services in the background with each handler awaiting its service's `ready` promise. Also why Electron E2E is flaky — `firstWindow()` defaults to a 30s timeout. | open      |
| ATR-050 | P2  | dist        | **First-run onboarding window** — scan-path selection, default editor/terminal, hotkey. May be redundant once ATR-038 ships its in-app first-run CTA; decide at the Wave A gate (D3 in the plan).                                                                                                                                                   | open      |
| ATR-051 | P2  | dist        | **Branded DMG** — background image + custom installer layout.                                                                                                                                                                                                                                                                                      | open      |
| ATR-052 | P2  | dist        | **Release discipline** — versioning, changelog, and release docs (`package.json` is still `0.1.0` / `private: true`).                                                                                                                                                                                                                               | open      |
| ATR-053 | P2  | test        | **Hybrid-search coverage gap** — retiring the legacy stack (ATR-013) deleted `tests/search/hybrid.test.ts`, which was the only coverage of hybrid FTS+vector search. It was wired to `lib/db` / `lib/embed` / `lib/search`, so porting is a rewrite against `src/main/services/search.ts`, not a move. `services/tag.ts` coverage WAS ported.        | open      |
| ATR-054 | P2  | build       | **No lint at all** — `lint` was `next lint` and went with the Next stack; there is no `eslint.config.*` in the repo and never was. Add a flat ESLint config covering `src/`, `tests/`, `scripts/`, and wire it into ATR-047's CI.                                                                                                                    | open      |
| ATR-024 | P2  | build       | nvm shell wrapper recurses on bare `node`/`npx`/`npm` (broken dotfile `_load_nvm`). Workaround: absolute binary. Fix in the user's `~/.zshrc`/profile (outside the repo — needs the user, or explicit OK to edit dotfiles).                                                                                                                                                                                                      | open      |
| ATR-025 | P2  | build       | Commit signing fails non-interactively (1Password SSH agent) → this session's commits used `--no-gpg-sign`. Re-sign on a real terminal (approve the 1Password prompt) or relax signing for agent sessions.                                                                                                                                                                                                                       | open      |
| —       | P2  | claude      | MCP server **"running"** status (PID-matching) — explicitly **deferred** out of ATR-021 (not faked; `mergeMcpServers` emits `configured`/`unavailable` only). Promote to a numbered item if/when it's wanted.                                                                                                                                                                                                                    | deferred  |

---

## Done / closed

**Wave 0 (2026-08-21)** — production-readiness foundation:

- **Backup + branch topology** — `main` was **19 commits behind** `feat/move-safety`
  (every build wave lived on one unmerged branch), and the repo had **no git remote at
  all**. Fast-forwarded `main`, created a private GitHub remote, and pushed all 8 branches.
  Neither risk was tracked by any ATR item.
- **ATR-013 — legacy Next.js stack retired.** Removed `app/`, `components/`, `lib/`,
  `e2e/`, `playwright.config.ts`, `next.config.ts`, `next-env.d.ts`, and the six legacy
  test dirs. Dropped `next`, both `@octokit/*` (only `lib/github/` used them),
  `eslint-config-next`, `jsdom`, and `tsx`; resynced the lockfile. Kept what turned out to
  be shared, not legacy: `drizzle/` (the live app runs its migrations from there),
  `postcss.config.mjs` (Tailwind 4 for the renderer), and `@leeoniya/ufuzzy` (loaded via a
  **dynamic** import in `spotlight-app.tsx`, which a naive grep misses). Repointed
  `drizzle.config.ts` at `src/main/db/schema.ts` and `components.json` at the renderer.
  Ported `tests/tag/heuristic.test.ts` → `tests/unit/main/services/tag.spec.ts` (7 tests)
  so the live tagger kept its coverage; the hybrid-search suite could not be ported and is
  now ATR-053.
- **`typecheck` actually checks the app now.** The root `tsconfig.json` *excluded*
  `src/main`, `src/preload`, and `src/renderer`, so `tsc --noEmit` had never covered the
  Electron code — the "tsc clean" signal was weaker than it looked. `typecheck` now runs
  all three configs.
- **Cold-start bug found (ATR-055).** Chasing the Electron E2E failures surfaced a
  ~26-second cold start: the main window is created only after every service finishes
  booting. Measured per service and filed with the diagnosis; the `lsof` prime tick is now
  fire-and-forget (~26s → ~22s), but the architectural fix is deliberately NOT in this wave.
  That single change was enough to take **Electron E2E from 0/7 to 7/7** and cut the suite
  from 4.0m to 1.6m — the specs had been dying on `firstWindow()`'s 30s default.
- **E2E no longer steals focus.** The suite launches one Electron app per spec (7 per
  run) and `main-window.ts` called `show()`, which *activates* the app on macOS — so a run
  repeatedly yanked keyboard focus away from whatever was being typed. Under `ATR_E2E=1`
  (set once in `playwright.electron.config.ts`, propagated by each spec's
  `...process.env` spread) the app now hides its dock icon and uses `showInactive()`.
  Playwright drives the window over the debugger protocol and never needs it focused.
- **ATR-016 — native-ABI flip automated.** New `scripts/ensure-native-abi.mjs` probes the
  ABI and rebuilds only on a genuine mismatch; every test script now guards itself, so
  `pnpm test` and `pnpm test:electron-e2e` can be run in any order. Two real traps found
  while building it: a bare `require("better-sqlite3")` succeeds against a foreign ABI
  because `bindings()` is deferred until the first `new Database(...)` (so the probe must
  *exercise* the addon), and `find-git-repositories` ships **per-ABI** builds side by side
  so it loads under both runtimes and can never indicate the tree's ABI — only
  `better-sqlite3` is authoritative. Also aligned `tests/helpers/test-db.ts` CONTRACT_SQL
  to the live post-ATR-019 FTS triggers (it still carried the *buggy* `tags_text = ''`
  insert trigger).

**Wave 4 (2026-07-13)** — ATR-027/028/030 (the audit's data-safety core):
moved-repo identity rebind (`upsertRepo` matches `remote_url`, else name +
`last_commit_hash`, only when the old path is gone — tags/groups/last-opened
survive folder moves); stale-repo lifecycle (`missing` computed at read time,
ghost badge + banner, `catalog:delete` IPC clearing FTS/memberships/vector,
guarded remove flow — disk never touched); `last_opened_at` stamped by every
launcher open verb. 19 new tests. Commit `4124c39`.

**Wave 1 (2026-05-31)** — ATR-001/002/003/004/005/009/012/015: Claude tab real data (138 projects), catalog search + tag/group persistence, `pnpm dev`→Electron, green typecheck, de-flaked test.

**Wave 2 (2026-06-01)** — ATR-006/007/008/010/011/014/017/023/026: native-shell repo-open + real tray icon + dock badge, vendored fonts, manual-group filter, frame-origin hardening, shell-injection guard, contract reconciliation, full Electron E2E 7/7.

**Wave 3 (2026-06-01)** — ATR-018/019/020/021/022:

- **ATR-018** — embedding write-path wired into scan/rescan (content-hash gated, fails-soft when Ollama is down).
- **ATR-019** — FTS insert trigger indexes `tags_text`; DROP+CREATE triggers each boot so existing DBs self-heal + one-time backfill (real-DB tested).
- **ATR-020** — per-project usage "Trend" now uses each project's **real** weekly token series (was the global series scaled by share).
- **ATR-021** — transcript viewer UI built on the existing `useClaudeTranscript` hook. (MCP "running" deferred — see above.)
- **ATR-022** — action context populated at dispatch sites + launch actions registered, so Cmd-K "Copy Path"/open-in-editor fire.

See the [`PLAN.md`](./PLAN.md) closure log for commit refs.
