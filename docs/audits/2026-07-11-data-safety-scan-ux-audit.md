# Data-Safety, Scanner-Completeness & Catalog-UX Audit — 2026-07-11

**Scope:** the Electron app (`src/`) only. **Method:** three parallel read-only review
agents (data-safety, scanner completeness, UX) over the real mounted code paths, with the
two most severe claims re-verified by hand against `find-git-repositories`'s native C++
walker and `catalog.rescan`. **Trigger:** user request — "full review with harsh eyes to
make sure it won't accidentally purge something, or miss something when moving projects,"
plus "professional, easy to use: lists with description, details, last opened."

## Verdict

- **Nothing ever deletes files or catalog rows.** There is no destructive filesystem
  operation and no `DELETE FROM repos` anywhere. The literal "accidental purge" fear is
  unfounded — but the inverse problem is real: the catalog **can only grow lies**.
- **Moving a project on disk silently duplicates it** and strands tags/groups/open-history
  on an un-removable ghost row; a rescan of the ghost then **overwrites its metadata with
  nulls** while reporting success.
- **The discovery walker has structural blind spots** (stops at the first `.git`,
  ignores `.git` files/worktrees, never follows symlinks) and **every miss is silent** —
  a scan that dropped 30 repos renders identically to a clean one.
- **The UI doesn't surface what the user asked for**: `lastOpenedAt` is never rendered in
  the main window (and is only stamped by one of ~6 open paths, so it's mostly null),
  the detail view omits `description`, the grid silently caps at 200, and manual groups
  can be created but never populated.

Highest-leverage fixes, in order: identity-based repo matching on scan (DS-1), a
stale-row reconcile + delete surface (DS-2), pre-expanding scan roots / wrapping the
native walker (SC-1), stamping `last_opened_at` in the launcher (DS-4), and wiring the
already-existing sort/`lastOpened` machinery into the catalog header (UX-1/2).

---

## Part A — Data safety (DS)

### DS-1 · CRITICAL · Moving a repo silently duplicates it and strands all user metadata

`src/main/services/metadata.ts:350-363`, `src/main/workers/scanner.worker.ts:157`, `src/main/db/queries.ts:368-478`
Slug = `kebab(name)-sha1(fullPath)[:6]`, and `upsertRepo` matches **only** on `full_path`.
Move `~/Projects/foo` → `~/Archive/foo`, rescan: new path → no match → INSERT with a new
slug. Result: two rows — a dead ghost (old path) holding the user tags, group memberships
(`repo_groups` FK), and `last_opened_at`; and a blank new row in no groups. No identity
matching by `remote_url` or commit hash exists.
_Note:_ the feared `UNIQUE(slug)` collision does **not** happen (path-hash suffix), and two
different projects with the same folder name catalog cleanly — verified non-issues.
**Fix direction:** match discovered repos to existing rows by stable identity
(`remote_url`, else root-commit hash) before falling back to `full_path`; on match, update
`full_path` in place, preserving slug/tags/groups/history.

### DS-2 · CRITICAL · No prune, no stale detection, no repo-delete — ghosts are permanent

`src/shared/ipc.ts` (`CATALOG.*` has no delete), `src/main/db/queries.ts` (no repo DELETE),
`src/main/services/lance.ts:81` (`deleteEmbedding` has zero callers)
A repo deleted or moved away on disk stays in the list, FTS search, vector search, and the
tray recent menu forever, with **no UI or IPC path to remove it**. Acting on a ghost drives
the launcher into a dead cwd (`launcher.ts:64-70,465,541`) and Apple-Terminal `cd` failures
(`launcher.ts:792`).
**Fix direction:** reconcile pass flagging rows whose `full_path` no longer exists +
`catalog:delete` IPC that also calls `deleteEmbedding` (the existing FTS DELETE trigger
then fires).

### DS-3 · HIGH · Group-membership rewrite is delete-then-insert with no transaction

`src/main/db/queries.ts:651-673` (`setGroupMembersBySlugs`), `:480-487` (`setRepoGroups`)
Each statement auto-commits; a crash or insert-throw between the DELETE and the INSERT
leaves the group with zero members. No `.transaction()` exists anywhere in `src/main`.
**Fix direction:** wrap in one better-sqlite3 transaction.

### DS-4 · HIGH · `last_opened_at` stamped by only one open path — "recently opened" is fiction

Stamped only via `git:openInEditor` (`src/main/ipc/git.ts:68`), reachable only from the
detail footer button and only for vscode/cursor. `launcherService`
(`openInEditor/openInTerminal/openInFinder`, `launcher.ts:464-626`) — used by the repo-card
buttons, Cmd-K, and the native menu — **never** stamps it. Tray "recent" degrades to
recently-committed (`tray.ts:94`); `sort:"lastOpened"` orders mostly-null values.
**Fix direction:** stamp on success inside the launcher service (all open verbs).

### DS-5 · HIGH · `catalog:rescan` on a moved/deleted repo clobbers good data with nulls

`src/main/services/catalog.ts:90-126`, `src/main/services/metadata.ts:76-82,240-327`
No existence check; `readRepoMetadata` swallows every error into nulls; the upsert matches
the ghost by path and UPDATEs it: `last_commit_* = null`, `is_dirty = false`,
`size_bytes = 0`, empty languages — reported as success. **Hand-verified.**
**Fix direction:** `existsSync` gate in scan/rescan; treat a missing dir as stale, never
write a nulled row.

### DS-6 · MEDIUM · Per-repo upsert failures flash for one frame, then the repo silently vanishes

`src/main/services/scan.ts:299-302`, `src/renderer/stores/scan.ts:65-98`
Error events share the progress channel; the next progress/done event overwrites
`phase:"error"`. Any mid-scan upsert failure drops that repo with no persistent signal.
**Fix direction:** accumulate an `errors[]` list; report "N repos failed to index" at done.

### DS-7 · MEDIUM · Search/vector orphans: ghosts keep matching forever

`src/main/db/client.ts:80-83` (FTS DELETE trigger exists but never fires — nothing
deletes), `src/main/services/lance.ts:81-88,127-157`
Falls out of DS-2: fixing deletion lets the FTS trigger clean up; call `deleteEmbedding`
on removal.

### Verified fine (suspected, cleared)

- ATR-019 FTS DROP+CREATE self-heal is non-destructive (triggers only; `CREATE ... IF NOT
EXISTS`; idempotent backfill) — `client.ts:54-106`.
- Scan cancel / crash mid-scan breaks no invariant (each upsert atomic, synchronous).
- WAL + `foreign_keys=ON` set (`client.ts:167-168`); migrations additive; legacy migration
  copy-only and sentinel-gated. Minor: no `busy_timeout`; settings atomic write lacks an
  `fsync` before rename (`settings.ts:79-90`) — low impact.

---

## Part B — Scanner completeness (SC)

### SC-1 · CRITICAL · A scan root that is itself a git repo hides everything beneath it

`node_modules/find-git-repositories/cpp/src/FindGitRepos.cpp:197-205` — **hand-verified**
The BFS walker discards a directory's entire subtree once it finds a child `.git`
(`if (!isGitRepo) foundPaths.splice(...)`). If `~/Repos` itself has a `.git` (dotfiles,
accidental init), the scan indexes exactly 1 repo and every project underneath is
invisible — UI shows a green "done · 1 repos". Same mechanism blocks all nested repos:
monorepo sub-repos, vendored checkouts (SC-1b).
**Fix direction:** pre-expand each root one level and feed children individually, keep
queuing subdirs after a repo is found, or wrap/replace the walker.

### SC-2 · HIGH · Git worktrees & submodules (`.git` is a _file_) are never detected

`FindGitRepos.cpp:179-195` — non-directory entries `continue` before the `.git` name check.
Linked worktrees/submodules use a `gitdir:` pointer file → invisible. (This project's own
tooling uses worktrees.)
**Fix direction:** treat a `.git` file as a repo (read the `gitdir:` line); requires
wrapping/replacing the native walker.

### SC-3 · HIGH · Symlinked directories never followed during the walk

`FindGitRepos.cpp:184,188-190`. A `~/Repos` of symlinks to repos on other volumes finds
nothing. (Symlinked _roots_ are fine — `canonicalPath` realpaths the root first.)
**Fix direction:** optional follow-symlinks with cycle detection.

### SC-4 · HIGH · Missing/unmounted/typo'd/`~` scan roots → silent zero, no error

`FindGitRepos.cpp:171` (`scandir < 0 → continue`), `metadata.ts:76-82` (no `~` expansion)
Unmounted drive, `~/Repos` literal, or a typo all resolve to zero results with a clean
"done". Also covers permission-denied subtrees (macOS TCC: `~/Documents`, `~/Desktop`).
**Fix direction:** stat each root before dispatch and emit a distinct "root missing"
error; expand `~`; surface the Full-Disk-Access caveat.

### SC-5 · HIGH · Scan errors are invisible in the UI — a broken scan looks clean

`src/renderer/stores/scan.ts:65-98`, `scan-status-bar.tsx:70`, `schemas.ts:90-111`
`done` overwrites `phase:"error"`; only the _last_ error is kept and never rendered after
completion; no error count in the `done` event. (Same root cause as DS-6.)
**Fix direction:** persistent `errors[]` + `errorCount` on done + "N errors" affordance.

### SC-6 · HIGH · No filesystem watcher on scan paths — new projects invisible until manual rescan

Only `~/.claude/projects/` is watched (`claude/watcher.ts`); `scanService.boot()` is a
no-op; no scan on launch or on scan-path change. Directly hits "I keep creating new
projects."
**Fix direction:** debounced chokidar over `scanPaths` → incremental scan, or a
scan-on-launch + periodic rescan.

### SC-7 · MEDIUM · Cold start is a dead-end

`settings.ts:33` (`scanPaths: []`), `repo-grid.tsx:42-50`, `settings-form.tsx:333-344`
Fresh install: empty catalog labeled "No repos match — adjust your filters," and the only
scan trigger is buried in Settings.
**Fix direction:** first-run panel (pick folder → scan); distinguish unconfigured-empty
from filtered-empty.

### SC-8 · MEDIUM · `ignorePaths` is dead code with wrong semantics

`scan.ts:231-238` reads a field that `SettingsSchema` (`schemas.ts:149-156`) strips and no
UI sets; even if set, the worker applies exact-path equality (`scanner.worker.ts:99-101`),
not prefix, and only post-discovery.
**Fix direction:** add to schema + UI with prefix semantics, or delete it.

### SC-9 · MEDIUM · Add-scan-path UX invites every silent-miss failure

`settings-form.tsx:110-119,190-212` — free-text, no folder picker, no existence check, no
`~` expansion, literal-string dedup (trailing slash = duplicate root).
**Fix direction:** native folder picker + stat-validate + `canonicalPath` normalize.

### SC-10 · MEDIUM · Non-git projects invisible by design (product gap)

Discovery is 100% `.git`-driven; a just-created, not-yet-`git init`'d project doesn't
exist to the app.
**Fix direction (product decision):** optional marker-file indexing (`package.json`,
`Cargo.toml`, …) with an "uninitialized" badge + one-click `git init`.

### Verified fine

Hidden dirs are traversed; weird repos (empty/detached/corrupt) are indexed with nulls
rather than skipped; cross-root dedup works via canonical paths; depth is unlimited; the
single-scan concurrency guard is real. Low: `node_modules` is traversed during discovery
(perf); README candidate list misses some lowercase variants; bare repos undetected
(arguably correct — document it).

---

## Part C — Catalog UX (UX)

User's explicit wish: _"lists of projects with the description, details, last opened."_
All three fields exist in the data model; none are properly surfaced.

### UX-1 · HIGH · No sort control in the main window — "last opened" unreachable

`stores/ui.ts:34,44` has `sort` incl. `"lastOpened"` but it's dead: `catalog-shell.tsx:83-94`
reads no `sort` param, `index.tsx:38` calls `useRepos({limit:200})` unsorted. Only the tray
popover uses it (`tray-popover-app.tsx:114`). Backend support exists (`queries.ts:206-207`).
**Fix:** sort dropdown in the catalog header → URL param → `useRepos`. Pure wiring.

### UX-2 · HIGH · `lastOpenedAt` never rendered in the main window

Zero grep hits outside the tray. Add to card (`repo-card.tsx:105-111`) and detail meta rows
(`repo-detail-content.tsx:198-232`). Depends on DS-4 for the data to be truthful.

### UX-3 · HIGH · Fresh-install empty state is misleading (same as SC-7)

`repo-grid.tsx:42-50` — "No repos match / Adjust your filters" with no scan CTA.

### UX-4 · HIGH · Description missing from the detail view; nothing is editable but tags

Card clamps it to one line (`repo-card.tsx:99-101`); `repo-detail-content.tsx:197-359`
renders branch/commit/remote/languages/tags/groups/README but never `repo.description`;
no notes/description editing (only tags, `:91-104`).

### UX-5 · HIGH · Catalog silently capped at 200 repos; no pagination/virtualization

`index.tsx:38` (`limit:200`); `repo-grid.tsx:53-72` mounts every repo as a live card (each
with `useProcessesForRepo`, `repo-card.tsx:60`); count renders "200 of 200"
(`catalog-shell.tsx:394-398`). Repos 201+ invisible with no indication.

### UX-6 · HIGH · Manual groups are a dead-end: create but never populate

`useSetGroupMembers` (`hooks/use-groups.ts:157`) and the `groups.setMembers` bridge
(`lib/atr.ts:152`) have **no callers** in any component. Sidebar only
creates/renames/deletes; detail shows groups read-only (`repo-detail-content.tsx:318-334`).
**Fix:** "add to group" multi-select on detail or a card context action.

### UX-7 · MEDIUM · Card omits the requested details

Never rendered anywhere: `lastCommitMsg`, `sizeBytes`, branch, last-opened. Card shows
lang dot, name, dirty badge, 1-line description, language bar, "last commit Xd ago", tags.

### UX-8 · MEDIUM · No list/table view

Only a 1-3 column card grid (`repo-grid.tsx:26-27,55-57`) — wrong primitive for triaging
hundreds of repos by description + last-opened. Pairs with UX-1 and UX-5.

### UX-9 · MEDIUM · Detail footer hardcodes VS Code, ignoring the editor preference

`repo-detail-content.tsx:108,365-369` builds `vscode://file/...`; settings support
`vscode|cursor|none` (`schemas.ts:154`) and the card launcher respects it — inconsistent.

### UX-10 · LOW · No ghost indication (depends on DS-2), no "Recent" rail in the main

window (tray has one), relative-only timestamps with no exact-date hover `title`,
first-paint flash of the empty state (`index.tsx:54`), static window title.

### Quick wins (hours each)

Sort dropdown (UX-1) · last-opened on card + detail (UX-2) · description paragraph in
detail (UX-4) · first-run CTA (UX-3) · detail footer respects `defaultEditor` (UX-9) ·
hover-exact dates · `lastCommitMsg` + size chip on card (UX-7).

### Bigger lifts

Sortable list/table view (UX-8) · lift the 200 cap via pagination/virtualization (UX-5) ·
group-membership UI (UX-6) · "Recent" rail · ghost badges (with DS-2).
