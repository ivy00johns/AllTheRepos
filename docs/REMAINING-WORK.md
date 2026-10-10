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

---

## Open / remaining

| ID      | P   | Area        | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status    |
| ------- | --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| ATR-033 | P1  | scanner     | **Discovery: root-is-a-repo / nested repos** — the native walker prunes a subtree at the first `.git`, so a scan root that is itself a git repo indexes 1 repo and hides everything beneath it. Pre-expand roots / keep queuing subdirs after a repo hit. [SC-1]                                                                                                                                                                                                                                                                                           | open      |
| ATR-041 | P1  | ui          | **Surface description + key details** — ◐ partly done in Wave 5: the **detail** view now renders `description` (via `cleanDescription`) and `relativeTime(lastCommitDate)`; `sizeBytes` shows in the table view. Remaining: `lastCommitMsg` on the card, a size chip on the card, and `lastOpenedAt` as its own field.                                                                                                                                                                                                                                     | ◐ partial |
| ATR-042 | P1  | ui          | **Lift the silent 200-repo cap** — `useRepos({limit:200})` + a non-virtualized grid mounting a live card per repo; repos 201+ are invisible and the count reads "200 of 200". Pagination or virtualization + true counts. [UX-5]                                                                                                                                                                                                                                                                                                                           | open      |
| ATR-043 | P1  | ui          | **Group-membership UI** — `useSetGroupMembers` and the `groups.setMembers` preload bridge have zero callers; manual groups can be created/renamed/deleted but never populated. Add-to-group affordance on detail + card context action. [UX-6]                                                                                                                                                                                                                                                                                                             | open      |
| ATR-046 | P1  | dist        | **Code signing + notarization** — **wired end to end as of 2026-10-06, blocked only on the certificate.** `electron-builder.yml` runs `hardenedRuntime: true` and `afterSign: scripts/notarize.mjs` (no longer a no-op: it notarises with `@electron/notarize`, staples, and independently validates the ticket); `scripts/signing-identity.mjs` resolves the identity, refusing `Apple Development` certificates that cannot be notarised; CI imports `CSC_LINK` into a throwaway keychain, **fails** rather than downgrading when the secret is broken, demands notarisation on the path that claims to be signed, and verifies the authority + staple on the runner. What remains is the thing no code can supply: an Apple Developer Program membership (D2) to be issued a Developer ID Application certificate. Until then the build is ad-hoc signed by design and the release warns that it is.                                                                                                                                                                                                        | open      |
| ATR-047 | P1  | dist        | **CI on GitHub Actions** — ◐ `.github/workflows/ci.yml` landed **2026-10-06**: a `check` job (`typecheck` + `vitest`) and a separate `e2e` job (the Electron suite — separate because it flips the native ABI), both `macos-14` / Node 22, on every push and PR. The same sequence is green locally, and all 8 specs also pass against a fresh `CFFIXED_USER_HOME` (empty catalog), which is what a runner looks like. **2026-10-06 — verified green on a runner** via PR #1: `typecheck` + **49 files / 1055 tests, 0 failed**, and the Electron suite **8 passed / 2 skipped** on `macos-14` (`Running 10 tests`, including the seeded-profile spec, so the GUI session a runner offers is enough). One subtlety learned the hard way: a **branch** push evaluates the workflow at the pushed ref, but a **tag** push does not — `v0.1.0` produced *no run at all* while `main` lacked `.github/` (`actions/workflows` → 0), so the release workflow can only fire once this reaches `main`. **2026-10-07 — a third job**, `refusal`, runs the packaged update check against a committed mock that answers every GitHub read with a 403, on every push, so the rate-limit skip path is covered by a real run rather than by a local harness; it fails unless the tests that read the feed stopped for that reason. `pnpm lint` (**ATR-054**) is a step on the fast job, and a **`drill`** job — dispatched with `gh workflow run ci.yml` — runs the refusal check against a mock that has been made to stop refusing, to prove the check can still fail. The `refusal` job now builds both bundles (`electron:pack` and `electron:pack-older`), so every test that reads the feed is covered. **2026-10-07 — the fast job moved to `ubuntu-latest`**, with `e2e`, `refusal` and `drill` staying on macOS because they launch the packaged app; nothing in the fast job launches or packages anything, and all three native modules its suite loads have a Linux answer. The split is pinned by `tests/unit/workflows/ci.spec.ts`. Three specs had to become host-agnostic first — `menu.spec.ts` pins `process.platform` rather than inheriting it, the `next-release` fixture carries its own git identity rather than borrowing the developer's, and the two socket tests in `process.spec.ts` stop with a reason where `lsof` is missing — and the job installs `lsof`, which the runner image does not carry. **Verified on Linux in a `node:22-bookworm` container** over this tree, and re-verified after merging main's SQLite vector store: `first-launch:check`, `versions:check`, `platforms:check`, `typecheck`, `lint`, `lint:prose` and the unit suite (through `pnpm badges`) all green, the suite at **83 files / 1668 tests, 0 failed** — against **3 files / 4 tests failing** before those three fixes, plus a fourth that had only ever passed on a Mac: `vector-store-unavailable.spec.ts` built its expected reason around a literal `vec0.dylib`, and now names the library file this platform ships. The `lsof` guard was re-proved on the way through, on a host that has none: `process.spec.ts` at 68 tests with 2 skipped, exit 0,  and the reason printed. **2026-10-08 — the macOS bill is guarded**: `pnpm ci-cost:check` holds every job that runs on a Mac to a budget declared in the script, and fails a pull request that adds one or widens one (see the guard entry in the closed list below).                                                                                                                                                                                                                                                                                                                                                    | ✅ done    |
| ATR-048 | P1  | dist        | **Release workflow** — ◐ `pnpm release` builds and publishes an ad-hoc-signed DMG + ZIP + `latest-mac.yml` to GitHub Releases (`docs/RELEASING.md`), and as of **2026-10-06** a pushed `v*` tag does the same in CI: `.github/workflows/release.yml` guards the tag against `package.json` + the changelog, runs `typecheck`/unit, uploads as a draft, then attaches the notes and publishes it. Artifacts go to the **public** `alltherepos-releases` repo (the app reads that feed anonymously, so update checks work for any install; the source stays private). A `release:verify` step reads the upload back **before** it is published and again afterwards, so a missing DMG / ZIP / manifest fails the job while the release is still invisible. Still open: a **notarized** artifact (ATR-046) — until then the published app needs the **Open Anyway** step in System Settings → Privacy & Security on first launch (the right-click → Open shortcut macOS 15 removed is gone, so the DMG now carries the steps in `READ-ME-FIRST.txt` and the app explains it once on first run) and cannot install its own updates.                                                                                                                                                                                                                                                                                              | ◐ partial |
| ATR-055 | P1  | perf        | **~22s cold start — the window is gated on service boot.** `app.whenReady()` awaits `processService.boot()` → `launcherService.boot()` → `claudeService.boot()` *before* creating the main window. **Still present 2026-10-06:** `src/main/index.ts` boots every service at `:226`–`:255` and only calls `createMainWindow()` at `:289`. Real fix: register IPC handlers, create the window, THEN boot services in the background with each handler awaiting its service's `ready` promise. Also why Electron E2E is slower than it should be.             | open      |
| ATR-057 | P1  | build       | **The SDK this machine names is one its own clang rejects** — the Command Line Tools update on **2026-09-22** installed SDK 27.0 (`…/CommandLineTools/SDKs/MacOSX.sdk → MacOSX27.0.sdk`), which clang 21 rejects (`unknown architecture … arm64e.x1-macos`, `tapi error: malformed file`). Nothing asks a person for `SDKROOT` any more. **◐ 2026-10-09 — resolved by the tree instead of exported by hand.** `scripts/native-toolchain.mjs` resolves a candidate SDK by *linking* it (`linkProbe` compiles a three-line translation unit, which is the only way to know: a `-isysroot` pointing at a stub SDK looks identical to a working one from any path comparison) and `scripts/ensure-native-abi.mjs` passes the winner to the rebuilds `pnpm test` / `test:full` start. That still left the two commands a person actually types: a bare `pnpm rebuild <native module>` runs the **dependency's** node-gyp hook — a child this repository never starts — so `pnpm install` now runs `scripts/point-sdkroot.mjs`, which asks the linker whether a build links as the machine stands and, when it does not, writes the SDK that does into gyp's own forced include, `~/.gyp/include.gypi`. gyp includes that file into every `.gyp` it reads, so it reaches those builds. The file carries a marker line and is only ever refreshed, never deleted or clobbered: a `~/.gyp/include.gypi` without the marker is somebody's own, and it is reported with the one edit that would fix it. `--dry-run` says what it would do, the script exits 0 whatever it finds (a `preinstall` that fails an install which worked is worse than no convenience), and `rm ~/.gyp/include.gypi` is the opt-out, which puts the by-hand export back. **Where it lands in an install, measured 2026-10-09:** pnpm builds a dependency that has to compile *before* it runs the root package's `preinstall` — forced `pnpm install --force --config.side-effects-cache=false` in a fresh copy with the include removed died in `find-git-repositories`' node-gyp step with `tapi error: malformed file` and no `[sdkroot]` line in the log. That is a position problem, not a mechanism problem, and pnpm has the position: `pnpm:devPreinstall` is run at the top of `_install()`, before resolution, so the file exists before the first dependency build starts. `package.json` carries both hooks — the early one so a machine that has never built these natives installs cleanly, and `preinstall` so every install checks the file again afterwards — and `tests/unit/scripts/point-sdkroot.spec.ts` pins both, because the wiring is the part no unit test of the script itself can see. **Verified on a tree that had never installed:** fresh copy, no `node_modules`, include deleted, `--config.side-effects-cache=false` so pnpm cannot hand back a build it made earlier, `SDKROOT` unset — install exits 0 and `find-git-repositories` compiles during it. What is left to a person is `pnpm install --ignore-scripts`, which skips both hooks, and a `node-gyp` build started outside this tree (another checkout, another project), which the include still reaches but nothing here arranges. **Consequence observed 2026-10-08, still true of a build with no include:** a failed `node-gyp` attempt does not merely leave the old build in place — it deletes `node_modules/find-git-repositories/build/Release/findGitRepos.node` first, and the package's `main` points at it. Every scan then dies with `Cannot find module '…/build/Release/findGitRepos.node'`, which the app prints verbatim in the scan bar at the top of the window. The tree is repairable without a compiler: the ABI-tagged prebuild the same install keeps at `bin/darwin-<arch>-<abi>/find-git-repositories.node` is the identical artifact, so `cp` it back to `build/Release/findGitRepos.node`, and `ensure-native-abi.mjs` does exactly that when it finds the entry point gone. What remains open is the machine rather than the tree: the SDK clang 21 rejects is still the installed one, so a `pnpm rebuild` in some other checkout, or a `node-gyp` build nothing here starts, still needs the export. Fix the SDK (or the Command Line Tools install) and the resolver finds a good one on its own and writes nothing. | ◐ partial |
| ATR-050 | P2  | dist        | **First-run onboarding window** — scan-path selection, default editor/terminal, hotkey. May be redundant once ATR-038 ships its in-app first-run CTA; decide at the Wave A gate (D3 in the plan).                                                                                                                                                                                                                                                                                                                                                          | open      |
| ATR-051 | P2  | dist        | **Branded DMG** — background image + custom installer layout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | open      |
| ATR-052 | P2  | dist        | **Release discipline** — ◐ the procedure landed in `docs/RELEASING.md`, and **2026-10-06** added the enforcement: `CHANGELOG.md` (Keep a Changelog), and `scripts/release-notes.mjs`, which fails a release whose tag disagrees with `package.json` or whose version has no non-empty changelog section — wired into `pnpm release` as `release:check` and into CI as the first release step. The same day also made the bump **derived instead of typed**: `scripts/next-release.mjs` (`release:next`) reads the commits since the last `v*` tag, picks the level by conventional-commit rules, writes the version and changelog section, and commits + tags only with `--write --tag`, after the plan is read. Still open: `package.json` is still `0.1.0` / `private: true` and nothing has ever been tagged, so the first real bump has not been exercised — and `release:next` deliberately refuses to invent one while there is no baseline.                                                                                                                                                                                                                                                                                                                                                   | ◐ partial |
| ATR-053 | P2  | test        | **Hybrid-search coverage gap** — retiring the legacy stack (ATR-013) deleted `tests/search/hybrid.test.ts`, which was the only coverage of hybrid FTS+vector search. It was wired to `lib/db` / `lib/embed` / `lib/search`, so porting is a rewrite against `src/main/services/search.ts`, not a move. `services/tag.ts` coverage WAS ported.                                                                                                                                                                                                              | open      |
| ATR-054 | P2  | build       | **No lint at all** — `lint` was `next lint` and went with the Next stack; there is no `eslint.config.*` in the repo and never was. Add a flat ESLint config covering `src/`, `tests/`, `scripts/`, and wire it into ATR-047's CI.                                                                                                                                                                                                                                                                                                                          | ✅ done   |
| ATR-024 | P2  | build       | nvm shell wrapper recurses on bare `node`/`npx`/`npm` (broken dotfile `_load_nvm`). Workaround: absolute binary. Fix in the user's `~/.zshrc`/profile (outside the repo — needs the user, or explicit OK to edit dotfiles).                                                                                                                                                                                                                                                                                                                                | open      |
| ATR-025 | P2  | build       | Commit signing fails non-interactively (1Password SSH agent) → this session's commits used `--no-gpg-sign`. Re-sign on a real terminal (approve the 1Password prompt) or relax signing for agent sessions.                                                                                                                                                                                                                                                                                                                                                 | open      |
| ATR-056 | P2  | build       | **Literal NUL bytes committed as binary** — `src/main/services/graph.ts` (2 NULs inside `pairKey`) and `tests/unit/shared/folder-name.spec.ts` are stored by git as **binary**, so their diffs never render and `grep` silently skips them without `-a`. `scripts/fix-nul-bytes.mjs` swaps them for `\u0000` escapes. Previously blocked because the file had no recovery path — **now safe, both files are committed**.                                                                                                                                   | open      |
| ATR-058 | P2  | docs        | **Unsound probe in the MCP plan** — Task 7 Step 4 of `docs/superpowers/plans/2026-08-24-alltherepos-mcp.md` verifies a round trip by piping a single `printf` of four requests into `node dist/index.js` — initialize + `link` (id 2) + `list_links` (id 3) piped into stdin **all at once**. The SDK dispatches them concurrently, so the ordering-dependent pair can interleave: on 2026-08-24 an `unlink` ran before its `link` and returned `removed:false`, leaving a junk `repo_links` row in the live catalog. Rewrite it as a sequential request/response driver. | open      |
| —       | P2  | claude      | MCP server **"running"** status (PID-matching) — explicitly **deferred** out of ATR-021 (not faked; `mergeMcpServers` emits `configured`/`unavailable` only). Promote to a numbered item if/when it's wanted.                                                                                                                                                                                                                                                                                                                                              | deferred  |
| ATR-059 | P1  | ui          | **Top-bar navigation is unnamed below 1024px** — `top-bar.tsx:214` renders each destination's label as `hidden lg:inline`, so under the `lg` breakpoint `display:none` removes it from the accessible name while the icon is `aria-hidden` and the `Link` carries no `aria-label`/`title`. The minimum window width is 800 (`main-window.ts:22`), so all five destinations can become icon-only links with no name at all. Keep the collapsed text as an `sr-only` sibling (the pattern the update chip already uses at `:156,174,197`) or add `aria-label={label}`. [2026-10-07 UI/UX review, S2] **Fixed 2026-10-08** — the label is now `sr-only text-xs lg:not-sr-only lg:inline`, so the name survives the collapse. Proved on the running app at the window's 800px minimum: all five destinations resolve by accessible name, the label span is no longer `display: none`, and `claude-flow`'s name assertion still passes. Gated by `tests/e2e/nav-card-a11y.spec.ts`, which fails on the old class with "Running is an icon-only link with no accessible name at 800px". | ✅ done |
| ATR-060 | P1  | ui          | **Repo card is a `role="button"` wrapping real buttons** — `repo-card.tsx:131` puts `role="button"` on the `<article>`, which contains `PortChipsForRepo` (`:176`), `FavoriteStar` (`:180`) and `LauncherButtons` (`:249`), each rendering real `<button>`s. Interactive descendants inside a button role are invalid: AT flattens or skips them and the nested controls become unreachable or ambiguous. Drop the role and let the card be a container (selection stays on `onClick` + `tabIndex`), or make the title itself the button. [S3] **Fixed 2026-10-08** — `role`, `aria-pressed`, `tabIndex` and the `onKeyDown` came off the `<article>` and the repo name became a real `<button>` inside its `<h3>`, carrying the descriptive label and forwarding the same click modifiers before `stopPropagation`, so mouse behaviour and the selection ring are unchanged. Proved on the running app with a live port chip: the card has no role and no `tabindex`, no focusable element on the catalog contains another control, and the keyboard walk reaches the port chip, the favourite star and **all five** launcher buttons as separate stops in order, never landing on the card. Gated by `tests/e2e/nav-card-a11y.spec.ts`, which fails on the old markup with "the card is a control again". Note the review said "four launcher buttons"; `launcher-buttons.tsx` renders five (editor, terminal, Finder, remote, copy path). | ✅ done |
| ATR-061 | P1  | ui          | **The catalog shell is 48px taller than its viewport** — `catalog-shell.tsx:573` roots the catalog at `h-[100dvh]` inside `main.flex-1` under a 48px top bar. **Measured at 1280×800:** the shell runs `top 48 / height 800 / bottom 848` against `innerHeight` 800 (`document.documentElement.scrollHeight` 848), and because the shell is `overflow-hidden` the tail of the grid is clipped rather than reachable by scrolling. Use `h-full` / `min-h-0 flex-1` and let `main` own the height. [S1] **Fixed 2026-10-08** — `__root.tsx` now roots the app at `h-screen overflow-hidden` with `main.flex-1 min-h-0`, `SimpleShell` scrolls internally, and the shell asks for `h-full`. Re-measured on the running app at 1280×800: `/` went **848 → 800**, and the last of 36 seeded grid rows reaches the viewport by scrolling the shell's own region. Gated by `tests/e2e/layout-overflow.spec.ts`. | ✅ done |
| ATR-062 | P1  | ui          | **`/graph` is 64px taller than the window** — `graph.tsx:178` sizes the page `h-[calc(100dvh-3rem)]`, but only `/` gets the full shell (`__root.tsx:31`), so `/graph` renders inside `SimpleShell`'s `px-6 py-8`. **Measured:** `document.documentElement.scrollHeight` 864 against `innerHeight` 800, which scrolls the page and pushes the bottom-anchored legend and control bar below the fold on first paint. Fix the route to fit its parent; let the shell decide page height. [G2] **Fixed 2026-10-08** — `/graph` joined `/` in the full-height shell set and the route now asks for `h-full` instead of `calc(100dvh - 3rem)`. Re-measured on the running app at 1280×800: `/graph` went **864 → 800**, with the legend and the `Graph view` control bar in the viewport on first paint and the signal-filter row unclipped. Gated by `tests/e2e/layout-overflow.spec.ts`. **2026-10-08:** that spec measured three of seven routes and the fix was described as route-agnostic — reasoning, not measurement. `/claude`, `/processes`, `/debug` and `/repos/$slug` are now held to the same number in the same single comparison, from the profile that already carries 36 repos for the purpose. | ✅ done |
| ATR-063 | P2  | ui          | **Three routes show an error with no way to recover** — `repos.$slug.tsx:36-45`, `settings.tsx:49-58` and `process-list.tsx:75-81` render a headline plus the raw `error.message` and stop. `/graph` gained a `Try again` action in the 2026-10-07 rework (`graph.tsx:279-288`); these three did not, so a transient IPC failure leaves a dead screen. Add a retry calling the query's `refetch()`. [S4] **Fixed 2026-10-08** — the three render one shared `ErrorState` (`components/ui/error-state.tsx`) whose `Try again` action calls the query's `refetch()`. Proved on the running app by failing the read at its source: `contextBridge` freezes the renderer's copy of the bridge (object, namespaces and methods all non-writable, global non-configurable), so the spec takes the real `ipcMain` handler for the channel out of the registry, holds it, and registers a throwing replacement — the app's own query, error and retry paths all run unchanged. Exercised on `/repos/$slug`, `/settings` and `/processes`, each recovering on retry once the real handler is restored. Gated by `tests/e2e/workstream-b.spec.ts`, which fails on all three tests against the old markup. | ✅ done |
| ATR-064 | P2  | ui          | **Loading states are bare text where siblings use skeletons** — `repos.$slug.tsx:28`, `settings.tsx:45` and `process-list.tsx:54` render a sentence while `detail-panel.tsx:51-55` and `repo-grid.tsx:172` already `animate-pulse` for the same class of wait; with a ~22s cold start (ATR-055) the first paint is exactly where it shows. Reuse the existing skeleton shape. [S5] **Fixed 2026-10-08** — one `Skeleton`/`SkeletonRegion` pair (`components/ui/skeleton.tsx`) now backs all five waits, including the two the finding named as the shape to copy (`detail-panel.tsx`, `repo-grid.tsx`), so the treatment cannot drift apart again; each state keeps an `sr-only` sentence for assistive tech behind the placeholder blocks. Proved on the running app by holding the read open for 4 s: the pulse blocks are on screen while the read is in flight and the real content replaces them when it lands, on all three routes. Gated by `tests/e2e/workstream-b.spec.ts`. | ✅ done |
| ATR-065 | P2  | ui          | **Claude range selector is a non-conforming radiogroup** — `claude.tsx:117,127` declare `role="radiogroup"`/`role="radio"` with `aria-checked` but implement neither roving `tabIndex` nor ArrowLeft/ArrowRight, so all four are tab stops and the keys radios are expected to answer do nothing. Either implement the pattern or drop the radio roles for the toolbar's `role="group"` + `aria-pressed` segmented shape. [S6] **Fixed 2026-10-08** — the pattern was implemented rather than the roles dropped: roving `tabIndex` (one tab stop, not four), ArrowLeft/Right and Up/Down with wrap-around, Home/End, and selection following focus. Proved on the running app — exactly one radio carries `tabindex=0` and it is the checked one, ArrowRight moves both focus and `aria-checked`, the previous radio drops to `-1`, End and Home reach the ends, and both arrows wrap. Gated by `tests/e2e/workstream-b.spec.ts`. | ✅ done |
| ATR-066 | P2  | ui          | **Table rows are unnamed click targets** — `repo-table.tsx:182-198` puts `tabIndex={0}`, `onClick` and an Enter-only `onKeyDown` on a `<tr>`: announced as a row, no role, no name, Space does nothing. Make the repo name a real button/link in the first cell, or add a role and handle Space. [S7] **Fixed 2026-10-08** — the repo name is a real `<button>` in the first cell, and the `<tr>` lost `tabIndex` and its Enter-only `onKeyDown`. The row keeps its click handler so the mouse target is unchanged, and both callers go through one `activate()` helper so the cmd/shift modifiers cannot drift apart. Proved on the running app in table mode: the row has no `tabindex` and no `role`, no `tbody tr` is in the tab order, the name button carries the repo name, **Space** selects the row (it did nothing before), and Tab off the name lands on a real control rather than the row. Gated by `tests/e2e/workstream-b.spec.ts`. | ✅ done |
| ATR-067 | P2  | ui          | **Kill confirmations use `window.confirm`** — `process-list.tsx:37` and `port-chip.tsx:57` diverge from the Radix `Dialog` confirmations used everywhere else (`group-sidebar.tsx:463`, `move-dialog.tsx`, `scan-root-dialog.tsx:142`); the native dialog is blocking, unstyled and announced differently. Move it onto the shared dialog, as `repo-detail-content.tsx` does for repo removal. [S8] **Fixed 2026-10-08** — one shared `ConfirmDialog` (`components/ui/confirm-dialog.tsx`: Radix `Dialog` with `role="alertdialog"`, destructive confirm button, focus defaulting to Cancel) backs both sites, and it states what the kill does (`SIGINT` → SIGTERM → SIGKILL) and that nothing on disk is touched. Proved on the running app with a real listener spawned inside a seeded repo, so both the table row and the card's port chip exist: each opens the dialog, Escape and the explicit Cancel both close it, and the process is still alive afterwards (`exitCode` null and its row still in the table after a fresh sweep). `process-flow.spec.ts` step 5 was updated because there is no longer a `window.confirm` to auto-accept — it now answers the dialog, and the assertion that the kill really kills the process is unchanged. Gated by `tests/e2e/workstream-b.spec.ts` plus `process-flow.spec.ts`. | ✅ done |
| ATR-068 | P2  | ui          | **`.atr-segment` active state has no accent cue, and the control is 28px tall** — **measured:** active `rgb(35,46,59)` against a `rgb(26,34,45)` container, roughly a 5% luminance step, and toggles measure 28px. The plan's Part B item 7 was deliberately skipped because the class is shared with `catalog-toolbar.tsx` and that step forbade touching other routes, so this needs one deliberate change for both surfaces rather than a graph-local patch. [A5 residue + Part B omission] **Fixed 2026-10-08** — one deliberate change to the shared class: the active segment takes the accent treatment the detail tabs and the range selector already use (`bg-accent/15 font-medium text-accent`), and the control moved 28px → 32px, with the toolbar's two selects and its Move button following so the row reads at one height. Measured on the running app on **both** surfaces (catalog view modes, map signal filters): the active label computes to `rgb(34,197,94)` — the accent, not a 5% luminance step — its background differs from its neighbours', and the control measures 32px. Gated by `tests/e2e/workstream-b.spec.ts`, which parks the pointer and freezes transitions first, because Chromium reports the interpolated colour mid-transition and two states would otherwise measure alike. | ✅ done |
| ATR-069 | P2  | ui          | **Graph nodes are keyboard-unreachable** — `graph-canvas.tsx:745-746` added a `role="img"` counted summary (Part B), but cytoscape paints into untitled `<canvas>` elements: no node is focusable, there is no roving tabindex, and the inspector can only describe the node that is already selected, never select one. [A3 residue] **Fixed 2026-10-08** — the inspector gained a `role="listbox"` over the nodes currently drawn: one tab stop with a roving `tabIndex` that follows the map's own selection, arrows/Home/End moving and selecting, and a degree beside each name so the list is worth having on its own. Cytoscape's canvas still cannot take focus, so the map's counted `role="img"` summary stays. Proved on the running app: three nodes listed, exactly one `tabindex="0"`, ArrowDown selects and focuses the next node **and the inspector describes it**, and End/Home reach the ends. Gated by `tests/e2e/workstream-b.spec.ts`. | ✅ done |
| ATR-075 | P2  | ui          | **Comment syntax left in JSX child position** — `__root.tsx` carried a bare `/* … */` block between two JSX children instead of `{/* … */}`. The failure that shape is famous for is a block of code-looking prose rendered above the page on every route, and it is not only cosmetic: a text child of the shell's flex column is an anonymous flex item with `min-height: auto`, so it cannot shrink and it takes its own height out of `main`. Either way it is invisible to typecheck, lint and the whole unit suite, which is the point — nothing in that set looks at what is on screen. Introduced 2026-10-08 in `6f97f12`. **Fixed 2026-10-08** — every such note now sits *above* its `return`, so no comment-shaped text is left where JSX renders children, and the rule is pinned twice: `tests/unit/renderer/jsx-text.spec.ts` fails on the forms that do reach the DOM (a `//` line in child position, which esbuild emits as a string child, and a `/* … */` in the gap between two children) and carries a positive control, so it cannot pass with a dead detector; `layout-overflow.spec.ts`'s `expectShellHoldsOnlyElements` asserts the shell holds only elements before it measures a height. **Correction, same day, from an A/B run:** the *bare block* form is emitted as a comment by this toolchain. Restored on purpose at the top of the returned tree, the built bundle still carries it as `/* … */` trivia (`jsxRuntimeExports.jsxs("div", …)` follows it, not a string child) and the DOM on `/`, `/graph` and `/settings` holds no such text — so the "React rendered it" claim in the first pass does not reproduce, and neither did the failure string it recorded. The form that genuinely reaches the screen is `//`, which is what the unit guard is built around. | ✅ done |
| ATR-070 | P3  | ui          | **`/graph` and `/` start their heading hierarchy at `h2`** — `graph.tsx:319,380` are the only headings on the map page (its title is a `<span>` at `:190`), and the catalog opens with `repo-grid.tsx:153` plus `repo-card.tsx:173`; neither route has an `h1`, so a screen-reader user gets section names with nothing above them. [G1] **Fixed 2026-10-08** — the map's own name stopped being a `<span>` and became its `h1` (the signal-filter row stays where it is; the four `<h2>`s beneath it keep their level), and the catalog got the level it was missing too: a visually hidden `<h1>` naming the route and the active scope, inside `main` and above the toolbar, because that screen's visible type is deliberately dense mono captions and a heading nobody sees should not move the grid to make room. It sits above `repo-grid.tsx`'s section `<h2>`, so the hierarchy now reads h1 → h2 → the card `<h3>`. Proved on the running app in `tests/e2e/workstream-c.spec.ts`: on both routes the first heading in the document is level 1 and there are still `h2`s under it — the fix added a level above the sections rather than promoting them. | ✅ done |
| ATR-071 | P3  | ui          | **No skip-to-content link** — `__root.tsx` puts the top bar and the whole notice stack before `main` with no skip affordance; the only `sr-only` element in the shell is the process badge at `top-bar.tsx:224`. [S9] **Fixed 2026-10-08** — the shell's first focusable element is now a `sr-only` "Skip to content" link that the focus variant unclips (a skip link nobody can see while focused is the same as none), and `main` carries `id="main-content"` with `tabIndex={-1}`, so activating it moves focus into the region itself rather than onto its first control. The stack it skips is not a fixed size either — up to three update affordances and three notices can be in front of `main`, so how far a keyboard had to travel depended on what the app was doing. Proved on the running app: the first Tab after a neutral click stops on the link at a real height, Enter lands focus on `#main-content`, and the shell's height contract is unchanged. Gated by `tests/e2e/workstream-c.spec.ts`. | ✅ done |
| ATR-072 | P3  | ui          | **Sub-12px type is used for labels and headings, not only metadata** — 127 `text-[10px]`/`text-[11px]` usages across 20+ files, including `claude.tsx:130` (uppercase tracking-widest control label), `graph.tsx:380` (section heading) and the detail-panel tabs (`repo-detail-content.tsx:328,342`). Decide the label tier once — raise it, or record the sub-12px label as intentional so it stops being re-litigated. [S10/G3] **Fixed 2026-10-08** — the tier was decided rather than sanctioned: `globals.css` names two of them beside the existing metadata tier (`.atr-label` 12px for every label, caption, section heading, tab and column header; `.atr-micro` 10px for a number, unit or badge word read as data; `.atr-meta` 11px mono muted for timestamps, paths and counts inside running text), and **135** raw sub-12px sizes in **35** renderer files were swept onto them — the catalogue was slightly larger than the review's 127, which counted files and usages differently. The question cannot be re-litigated per screen, because a raw pixel size below 12px now fails a test: `tests/unit/renderer/type-scale.spec.ts` walks `src/renderer` (globals.css exempt — it is where the tiers are defined), reports `file:line` for each one, pins the two tiers' sizes, and carries a positive control so it cannot pass on a dead detector. The rule's edge is stated in it, not left implicit: the four `text-[13px]` runs in this renderer are above the floor and out of scope, because folding them in would move real type on three surfaces to settle a finding about sub-12px labels. Proved on the running app in `tests/e2e/workstream-c.spec.ts`: no rendered element carries a raw pixel font size, `.atr-label` computes to 12px and `.atr-micro` to 10px, and no heading, tab or column header is below the floor. Recorded where the next person will look for it — `design-system/alltherepos/MASTER.md` carries the type-scale table and the rule. **Follow-up, same day — the exemption is closed.** The carve-out above did not survive its own reasoning: a floor has an edge, and the same escape hatch written one pixel higher would have been invisible, which is exactly what the four `13px` runs were. They name a step now: `--text-body` (13px) in `@theme`, used as `text-body` by the table view's repo name, the map's two legend glyphs and `.atr-rail-row` — a theme token rather than a component class because the rail row *is* one of the four sites and Tailwind 4 cannot `@apply` a `@layer components` class, so the size has to be a real utility before both can name it. `tests/unit/renderer/type-scale.spec.ts` reports **any** raw size at any value, in `px`, `rem` or `em`, reports a numeric font size too, and pins the token to 13px so it cannot be deleted or re-sized quietly; the on-screen half became a sweep of **every** screen — `tests/e2e/type-scale.spec.ts`, which takes the routes from `src/renderer/routes/` and the view modes from the running toolbar, and fails if a route the router composes is missing from its visit plan — because the old check read `/` alone, and that is exactly how a raw size survived on the table view nobody opened. Proved by reverting one site: the walk names `repo-table.tsx:242` and the sweep fails with `"/ — Table view: a raw font size on class … text-[13px] …"`. The map's canvas labels, which cytoscape sizes by number rather than by class, are named the same way (`CANVAS_TYPE`, node 10 / edge 9 / focus 12 plus each label's drop-below size), so the renderer holds no font size without a name. Nothing moved on screen: the token sets `font-size` and nothing else, so it stands exactly where `text-[13px]` stood, and the canvas steps kept their values. | ✅ done |
| ATR-073 | P3  | ui          | **The accent hue doubles as the "running" status colour** — `--accent` (`globals.css:75`) is both the brand/primary-action colour and the live dev-server indicator (`port-chip.tsx:84` pulses `bg-accent`), against the palette's own stated rule of keeping status hues out of the recency ramp. Give the status a token of its own. [S11] **Fixed 2026-10-08** — `--color-status-live` (`#4ade80`) is that token, deliberately brighter and cooler than the accent so a live dot and a primary button are never the same colour on one screen. It is painted by both places the finding names: the port chip on a repo card (its dot, halo, border, tint and label) and the port column in the process table. Proved on the running app with a real listener spawned inside a seeded repo, so both marks exist at once: each computes to the status token, neither carries an accent class, and the chip's own colour is a different value from `--color-accent` resolved in the same document. Gated by `tests/e2e/workstream-c.spec.ts`, which fails against the old `bg-accent` markup. The distinction is recorded in `design-system/alltherepos/MASTER.md` with the rest of the palette. | ✅ done |
| ATR-074 | P3  | ui          | **`/debug` ships in the primary navigation** — `top-bar.tsx:57` lists it beside Running/Map/Claude/Settings while the page's own copy (`debug.tsx:10`) says it exists so the Phase 0 Playwright spec keeps passing. Reach it from a dev-only affordance (the command palette already has a dev-tools action) and drop it from `NAV_ITEMS`. [S12] **Fixed 2026-10-08** — `/debug` left `NAV_ITEMS`, which is now the four destinations the app is actually for. A packaged release has no Debug affordance anywhere in its chrome; a development build (`import.meta.env.DEV`, read through `isDevBuild` exported once from the action registry so the two answers cannot drift) draws a separated one after the nav, with its own accessible name rather than the bare "Debug" the nav button carried. The door that works in every build is the palette's `app.open-debug` action, marked `devOnly` — the convention `app.toggle-devtools` already follows, where the native menu drops it in a production build and the renderer's own palette keeps it. Proved on the running app in exactly the render that ships (`pnpm electron:build`, which is what the suite launches): the primary navigation holds four links, no link named Debug exists in the chrome, and Cmd+K → "Open Debug Page" still opens the page. The two specs that used to click the nav link now reach the page through the palette (`electron-launch.spec.ts`, `layout-overflow.spec.ts` — its `/debug` row is still held to the height contract), and `nav-card-a11y.spec.ts` asserts both halves of the absence. Gated by `tests/e2e/workstream-c.spec.ts`. **Revised the same day, when the question was asked properly:** that affordance was gated on `import.meta.env.DEV`, which is a *build mode* and the wrong question — it hid the door in `electron-vite preview` and in the E2E suite's built-but-unpackaged bundle, and it left the palette offering `devOnly` actions in a shipped release while the native menu, built from the same registry, dropped them. Both now read one runtime signal: main states `app.isPackaged` per window through `webPreferences.additionalArguments`, the preload reads it off `process.argv` and exposes it as `window.atr.build.packaged` (no IPC round trip, so it is there at first paint — which matters, because it decides whether an action is offered at all), and `isPackagedBuild()` is the renderer's single reader. The dev-only rule moved into the registry as `isActionAvailable(action, packaged)`, so the menu and the palette cannot disagree again, and `serializeActionsForIpc()` now defaults to what the run actually is rather than to the build mode. Proved on the running app twice: an ordinary launch draws the door beside the nav (its accessible name says "development build") and offers Open Debug Page, while a launch forced to look packaged with `ATR_FORCE_PACKAGED=1` — main's documented override, which exists so the branch a release takes is exercised by the suite rather than first seen by whoever installs the DMG — draws no Debug affordance anywhere in the chrome and lists neither Open Debug Page nor Toggle DevTools, with ordinary actions still working. | ✅ done |

---

## Done / closed

**Wave 5 — catalog v2 + MCP (built 2026-08-24–25, committed 2026-10-06 as `bfbe3ab..9c295ce`
on `feat/alltherepos-mcp`, pushed):** the largest wave so far, built in a single session and
left uncommitted for six weeks. It **closed five P1s** and left three **◐ partly done** — the closures, individually:

- **ATR-037** — auto-detect new projects: a debounced `fs.watch` watcher on `scanPaths` with a reconcile
  pass and a shared `indexer.ts`. Mechanism differs from the row: `fs.watch`, not chokidar (v5 dropped its
  fsevents backend). `scanService.boot()` is still a no-op.
- **ATR-038** — first-run flow: configured scan roots always render in the rail, so "empty" is
  distinguishable from "not configured", with an "Add folder to scan" affordance + `ScanRootDialog`,
  first-run auto-expansion, and empty states that separate search / folder-scope / archived.
- **ATR-040** — sort control + last-opened surfacing: the toolbar's sort control; last-opened is folded
  into the `SortKey` "Last touched" (`lib/activity.ts`). No literal `sort:"lastOpened"` option, though
  that enum still exists in the schema.
- **ATR-045** — list/table view: `repo-table.tsx` plus the `catalog-view` store's view modes.
- **ATR-049** — auto-update: `electron-updater` imported and wired to the GitHub-Releases feed, with an
  "Update to X" affordance; installing is deliberately manual (see `docs/RELEASING.md`).

It also shipped a great deal the ledger had no ID for:

- **MCP server** (`mcp/`, its own dependency tree): 6 tools — `find_repos`, `get_repo`,
  `get_map`, `link`, `unlink`, `list_links` — over a new `repo_links` table. Its entire write
  surface is `repo_links`; `docs/COMMAND-DISCLOSURE.md` documents the guarantee and
  `docs/superpowers/` holds the plan + spec.
- **Curated relationship graph** — `repo_links` merges into the derived graph as a sixth
  signal weighted above the rest, with a `/graph` route and canvas.
- **Live filesystem watching** — `fs.watch` (not chokidar: v5 dropped its fsevents backend),
  debounced, with a reconcile pass and a shared `indexer.ts` so the scanner and watcher agree
  on what "index this repo" means.
- **Scan-root management** — add/remove watched roots from the rail; `add`/`remove` verbs,
  optional "forget the rows underneath" on removal, never touching disk.
- **Folders, repo moves + a relocation journal, and git-sync** — repos grouped on disk, and a
  move that survives so tags and identity are not stranded.
- **Project tasks** (per-repo runner), **repo covers**, **favorites/marks**.
- **Catalog toolbar + table view + directory rail** — sort/group/view modes, bulk actions.
- **Distribution** — ad-hoc signing, real app icons (`pnpm icons`), the GitHub-Releases
  publish feed, `electron-updater` wired with a user-visible affordance, `docs/RELEASING.md`.

Gate, re-verified 2026-10-06 on the committed tree: `typecheck` **0 errors** across all three
tsconfigs · `vitest` **44 files / 991 tests, 0 failed** · Electron E2E **7/7**. Not merged to
`main`.

**Release pipeline (2026-10-06)** — a build now reaches someone by pushing a tag,
not by running a documented command on one machine:

- **`.github/workflows/release.yml`** — on `v*`: guard the tag, run `typecheck` + unit,
  build the DMG + ZIP with electron-builder, upload them to a **draft** release, attach the
  notes, then publish with `gh release edit`. Two phases on purpose — `releases/latest`
  ignores drafts, so a job that dies mid-publish leaves something invisible rather than an
  empty release the updater offers.
- **`CHANGELOG.md`** (Keep a Changelog) — the release's notes come from it, and
  `scripts/release-notes.mjs` refuses to let out a release whose tag disagrees with
  `package.json` or whose version has no non-empty section. 8 unit tests in
  `tests/unit/scripts/release-notes.spec.ts` pin those refusals.
- Corrections found on the way: `publish.releaseType: release` means electron-builder
  publishes **immediately** (`EP_DRAFT=true` is what produces a draft — `RELEASING.md` had
  the draft flow backwards), and electron-builder silently declines to upload to a release
  published more than **two hours** ago unless `EP_GH_IGNORE_TIME=true`.
- **`scripts/next-release.mjs`** (`release:next`) — the bump, derived rather than typed:
  commits since the last `v*` tag → level (breaking / `feat` / anything else) → version +
  changelog section (Added / Changed / Fixed), merging hand-written `[Unreleased]` bullets
  instead of replacing them. Writes only with `--write`; commits and tags only with `--tag`;
  pushes only with `--push`. 22 unit tests, most of them driving the CLI against real scratch
  repositories — which is how two silent failures were caught: the entry-point guard no-op'd
  under a symlinked temp path, and the changelog link references lost their `https://` prefix.
- **`scripts/verify-release.mjs`** (`release:verify`) — reads a published release back and
  fails loudly on: a draft, a tag that disagrees with `package.json`, a missing DMG / ZIP /
  `latest-mac.yml`, a manifest naming another version or an unattached file, or a manifest size
  that disagrees with the asset actually uploaded. CI runs it on the draft and again after
  publishing. 15 tests.
- The feed is **public** (`alltherepos-releases`): the app checks anonymously, so updates
  work for anyone who installs it, and the workflow publishes there with a `RELEASES_TOKEN`
  secret. One address, three mentions — `electron-builder.yml`, `FEED_OWNER`/`FEED_REPO`,
  and `RELEASES_REPO` — pinned by `tests/unit/main/services/updater-feed.spec.ts`.
- Still open: **notarization** (ATR-046) — the pipeline is built and the app installs
  updates on a signed build; the certificate is what is missing, and nothing in this repository
  can substitute for it.
- **True of the world as of 2026-10-06:** `alltherepos-releases` exists, `v0.1.0` is published
  with the DMG, the ZIP and `latest-mac.yml`, `release:verify` passes against it, and the
  packaged app's anonymous check was verified from the real bundle — it reports *You're on the
  latest release*, and against an older build it offers the update
  (`tests/e2e/packaged-update-check.spec.ts`).
- **CI now runs on a runner** (PR #1, both jobs green): `typecheck` + 49 files /
  1055 tests, and the Electron suite 8 passed / 2 skipped on `macos-14`. **The release workflow
  is still unverified**, and not merely for lack of a tag: a tag push does not evaluate the
  workflow at the tagged commit, so `.github/workflows/` has to be on the default branch before
  a `v*` tag can start it. Until then, releases are cut from one machine with `pnpm release`,
  which verifies itself.
- **The Electron suite now runs on Intel too** (2026-10-07, CI run `37678967992`): the `e2e` job is
  a two-leg matrix — `macos-14` (arm64) and `macos-15-intel` (x86_64) — and the first Intel run
  was **green**. The label is the part that took looking up: `macos-13` was the machine asked
  for by name and it no longer exists (GitHub retired the macOS 13 images on 2025-12-04, so a
  job asking for one waits for a runner that never arrives); `macos-15-intel` is the x86_64
  image that replaced it. The leg's first step asserts its own premise rather than trusting the
  label, and the runner said `uname -m` = `x86_64`, `node` = `x64`, and the binary it was about
  to launch was `Mach-O 64-bit executable x86_64`. **What it found is nothing**, which is the
  real result: the same 13 tests, the same **8 passed / 5 skipped** (the five are
  `packaged-update-check`, which skips without a packaged bundle — by design, on both legs),
  with `find-git-repositories` compiling from source and `better-sqlite3` loading on Intel. The
  leg is not free: 188s of runner against the arm64 leg's 61s, because the Intel image is three
  cores and `pnpm install` builds both natives from source there (71s against 6s).
  **Nothing in the suite called into the vector path** on that first run, so that green said
  the app builds, boots, renders, navigates, spawns and kills processes on x86_64 — not that
  semantic search works there, which it cannot: `@lancedb/lancedb` publishes no darwin-x64
  binary, so an Intel Mac runs FTS-only and `services/lance.ts` fails soft rather than saying
  so. **That half is a measurement now**, in `tests/e2e/vector-store.spec.ts`: the app's own
  runtime is asked whether the binding loads (on x86_64 it does not — the premise the leg
  rests on, asserted instead of assumed), and then a real search is driven over IPC with a
  mock embedding provider on the runner, so the vector path is entered and `lance.ts`'s own
  `catch` is what gets exercised. It is the innermost of three, so nothing else in this
  repository would notice its removal; built with the catch deleted and the app reporting
  `x86_64`, that spec goes red on `[backend] vector path error`. **The decision it was built
  upstream of is made**: Intel stays unbuilt, with the reasoning and the four options priced in
  [`docs/FUTURE.md`](./FUTURE.md) — `@lancedb/lancedb` dropped darwin-x64 for good (last stable
  2025-11-07), so an Intel build means no semantic search or an engine eleven months behind.
  **Green on both legs**
  (CI run `37683034472`): 15 tests, 10 passed / 5 skipped, 27.3s of suite on `macos-14` and
  1.3m on `macos-15-intel` — the binding probe 425ms there against 2.3s on Intel, where it is
  answering no. Neither leg skips it: the expectations are architecture-dependent, which is
  the difference between a leg that checks Intel and a leg that runs on it. **Superseded later
  the same day** — the "it cannot work there" half of that record stopped being true when the
  vector store moved to `sqlite-vec`, which publishes a `darwin-x64` binary; see the vector-store
  entry above, and the Intel leg now asserts stored vectors and ranking on x86_64 rather than the
  absence of a binding.
  **Retired 2026-10-08**: `e2e` is one leg on `macos-14` again. The leg was a second macOS runner
  on every push, for a build nobody can download, on an image that compiles both natives from
  source — 188s against the arm64 leg's 61s — and the question it was built to answer is answered
  in the paragraph above. Reopening Intel starts at `pnpm platforms:check`, which still asserts the
  binary matrix from package metadata, and at the four options priced in
  [`docs/FUTURE.md`](./FUTURE.md).
- **The macOS bill has a guard** (2026-10-08): `scripts/check-ci-cost.mjs` (`pnpm ci-cost:check`, a
  step on the fast job) makes where a job runs a thing this repository **declares** rather than
  accumulates. `MACOS_BUDGET` lists every job allowed on a Mac — runner, how often it starts, how
  many of them one run can start, and why it has to be one — and the check reads
  `.github/workflows/` and fails when the two stop agreeing: an undeclared macOS job, a declared one
  that grew a second leg (a matrix entry is that job's bill again on every run), a runner label this
  repository has retired (with the reason, the Intel leg's included), a job that lost the `if:`
  keeping it off every push, a budget entry whose job no longer exists, or a third job on every push
  above `PER_PUSH_LIMIT`. It reads triggers and runners and not durations, so it knows the shape of
  the spend and not its size — a job that merely gets slower is invisible to it, and the file says so
  rather than leaving it to be discovered. Proved able to fail four ways against a copy of these
  workflows, with the control run green; pinned by `tests/unit/scripts/check-ci-cost.spec.ts`
  (23 tests) and by `ci.spec.ts`, which asserts the step runs on the fast job, because a budget
  nobody reads is not a guard.
- **Semantic search has an end-to-end test** (2026-10-07):
  [`tests/e2e/semantic-search.spec.ts`](../tests/e2e/semantic-search.spec.ts) runs a real scan with
  a mock embedding provider on the runner and asserts that search comes back *ranked with the
  vectors that scan stored* — every seeded repo `hybrid`, and a query naming one repo ranking it
  first. It exists because the two halves had never met in a test: the unit specs either mock the
  vector store or stub `indexRepoEmbedding`, so nothing had ever written a real vector and read it
  back through a real search. **The write path was already wired** — ATR-018, in `scan.ts`'s
  `discovered` handler and in `catalog:rescan`, with `FUTURE.md` already saying so; the audit of
  2026-05-31 that reads "embeddings are never written" describes a commit that no longer exists.
  What was missing was proof, and it is now three mutations deep: remove the scan's
  `indexRepoEmbedding` call, aim the app at a provider that is not there, or drop the vector side
  in `hybridSearch`'s merge — each turns the spec red, and the last of those is a failure no unit
  test can reach. The profile is what makes it mean something: a launch copies the seeded SQLite
  file and settings, and the seeder writes rows only, so a vector hit has to be one this run's
  scan stored rather than something the fixture brought along.
- **The vector store is SQLite now** (2026-10-07) — semantic search stopped being gated on one
  architecture's binary matrix. `@lancedb/lancedb` publishes prebuilt bindings per platform and
  there is **no `darwin-x64` among them** (last stable `0.22.3`, 2025-11-07, against this
  repository's `0.27.2`), so an Intel Mac would have run without semantic search — silently, since
  the wrapper in `services/lance.ts` failed soft by design. The replacement is `sqlite-vec@0.1.9`,
  which publishes a binary for **every** platform the app could ship (`darwin-x64`,
  `darwin-arm64`, `linux-x64`, `linux-arm64`, `windows-x64`), and the embeddings now live in a
  `vec0` table inside `alltherepos.db` — the same file FTS5 was already in — loaded through
  better-sqlite3's `loadExtension`. `services/lance.ts` is deleted and `@lancedb/lancedb` is out of
  `package.json`, so the coupling to a third party's release matrix is gone rather than paid for.
  `pnpm platforms:check` now reports **`darwin-x64` would build today**; the Intel question is a
  packaging decision, not a vector-engine one (see [`FUTURE.md`](./FUTURE.md)).
  Two things the switch is not allowed to hide: a search that cannot reach the vector store
  **says so** — `catalog:search` returns `{ hits, semantic }`, and the catalog renders a
  "keyword matches only" notice instead of returning a smaller-ranked result set that looks
  exactly like a complete one — and `sqlite-vec` is stricter than the store it replaced, rejecting
  a wrong-width vector (`Dimension mismatch`) where the old one would have written it. Known
  consequence of the move, worth stating: existing installs have vectors in the old `lance/`
  directory that nothing reads any more, and the next scan or rescan re-embeds into SQLite
  (the content-hash gate finds no row, so it re-embeds rather than skipping). The stale directory
  is left on disk rather than deleted.

**Related repos (2026-10-06, on top of Wave 5)** — the MCP's curated links became a
first-class part of the app, and then the app was handed the pen as well:

- **Curated relations in the catalog** — the repo detail panel lists the links touching a repo in
  both directions, each row a hop to the other end (`graph:links`), off one indexed query per
  selection rather than a full graph rebuild.
- **Writing from the app** — `graph:link` / `graph:unlink` let the UI assert and remove links,
  stamped `source: "ui"`, keeping the MCP's rules intact: both ends must resolve, a repo cannot
  link to itself, and a human has to supply the reason. The catalog panel and the `/graph` map's
  inspector share one widget (`components/catalog/related-repos.tsx`).
- **Coverage** — `tests/unit/main/ipc/graph.spec.ts` (11) and +2 in `db/links.spec.ts`; and the
  first E2E spec that seeds its own isolated profile (`tests/e2e/curate-link-flow.spec.ts`), so it
  asserts a populated catalog even where the real library is empty.
- **29 curated links** asserted in the live catalog through the MCP, each citing README/config
  evidence (16 structural + 13 duplicate-upstream pairs).

Gate: `typecheck` 0 errors · `vitest` 45 files / 1004 tests / 0 failed · Electron E2E **8/8**, and
**8/8 again against a fresh, empty home**.

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
