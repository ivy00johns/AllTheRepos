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

---

## Open / remaining

| ID      | P   | Area        | Summary                                                                                                                                                                                                                                                                                                                                                                                                                          | Status    |
| ------- | --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| ATR-013 | P1  | migration   | **Retire the legacy Next.js stack** (`app/`, `components/`, `lib/` superseded; zero `src/ → lib/` imports). Its own focused pass: archive the trees, drop `next`/`eslint-config-next`/`.next/` + the `@next` tsconfig plugin, remove the legacy `playwright.config.ts` + `e2e/` and the GPG scanner flake, then `pnpm install` to resync the lockfile. Touches package.json/lockfile/tsconfig so it can't share a parallel wave. | open      |
| ATR-033 | P1  | scanner     | **Discovery: root-is-a-repo / nested repos** — the native walker prunes a subtree at the first `.git`, so a scan root that is itself a git repo indexes 1 repo and hides everything beneath it. Pre-expand roots / keep queuing subdirs after a repo hit. [SC-1]                                                                                                                                                                 | open      |
| ATR-037 | P1  | scan        | **Auto-detect new projects** — no watcher on `scanPaths` and no scan-on-launch (`scanService.boot()` is a no-op); new repos are invisible until a manual "Scan now". Debounced chokidar watcher (mirror the Claude watcher) → incremental scan. [SC-6]                                                                                                                                                                           | open      |
| ATR-038 | P1  | ux          | **First-run flow** — fresh install shows "No repos match / adjust your filters" with no scan CTA; the only trigger is buried in Settings. Distinguish unconfigured-empty from filtered-empty; folder-picker CTA + first scan. [SC-7/UX-3]                                                                                                                                                                                        | open      |
| ATR-040 | P1  | ui          | **Sort control + last-opened surfacing** — `sort:"lastOpened"` exists in the store, schema, and query layer but no main-window UI exposes it, and `lastOpenedAt` is never rendered outside the tray. Header sort dropdown → `useRepos`; last-opened on card + detail with exact-date hover. Pairs with ATR-030. [UX-1/UX-2]                                                                                                      | open      |
| ATR-041 | P1  | ui          | **Surface description + key details** — the detail view never renders `repo.description`; `lastCommitMsg` and `sizeBytes` are rendered nowhere. Description paragraph in detail; commit-message + size chip on the card. [UX-4/UX-7]                                                                                                                                                                                             | open      |
| ATR-042 | P1  | ui          | **Lift the silent 200-repo cap** — `useRepos({limit:200})` + a non-virtualized grid mounting a live card per repo; repos 201+ are invisible and the count reads "200 of 200". Pagination or virtualization + true counts. [UX-5]                                                                                                                                                                                                 | open      |
| ATR-043 | P1  | ui          | **Group-membership UI** — `useSetGroupMembers` and the `groups.setMembers` preload bridge have zero callers; manual groups can be created/renamed/deleted but never populated. Add-to-group affordance on detail + card context action. [UX-6]                                                                                                                                                                                   | open      |
| ATR-045 | P1  | ui          | **List/table view toggle** — card grid only today; wrong primitive for triaging hundreds of repos. Compact sortable table (name/description/last-opened/size) toggleable with cards. Pairs with ATR-040/042. [UX-8]                                                                                                                                                                                                              | open      |
| ATR-016 | P2  | build/tests | `test:electron-e2e` + `test:full` scripts shipped (W2). Tail remaining: implement the `rebuild-natives.mjs` → `electron-builder install-app-deps` fallback (still dead code); align `tests/helpers/test-db.ts` CONTRACT_SQL to the fixed FTS triggers (harmless drift flagged in W3).                                                                                                                                            | ◐ partial |
| ATR-024 | P2  | build       | nvm shell wrapper recurses on bare `node`/`npx`/`npm` (broken dotfile `_load_nvm`). Workaround: absolute binary. Fix in the user's `~/.zshrc`/profile (outside the repo — needs the user, or explicit OK to edit dotfiles).                                                                                                                                                                                                      | open      |
| ATR-025 | P2  | build       | Commit signing fails non-interactively (1Password SSH agent) → this session's commits used `--no-gpg-sign`. Re-sign on a real terminal (approve the 1Password prompt) or relax signing for agent sessions.                                                                                                                                                                                                                       | open      |
| —       | P2  | claude      | MCP server **"running"** status (PID-matching) — explicitly **deferred** out of ATR-021 (not faked; `mergeMcpServers` emits `configured`/`unavailable` only). Promote to a numbered item if/when it's wanted.                                                                                                                                                                                                                    | deferred  |

---

## Done / closed

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
