# Real-data walkthrough — findings

Companion to `report.md` / `report.json` / `shots/` (30 screenshots). Every screen
below is the app driving the developer's **own** catalog, launched against a
*copy* of `~/Library/Application Support/alltherepos`.

**23 ok · 0 failed · 0 skipped · 0 script errors.** 109 CSP/asset refusals, all
cosmetic (see #5).

The original was never opened by the app: after all runs, `alltherepos.db` still
reads `Oct 11 14:44`, `settings.json` `Oct 7 14:53`, `window-memory.json`
`Oct 11 14:44`. Everything the walkthrough changed — the favourite, the tag, the
curated link, the identity, the scan paths, the editor default — landed in the
temp copy, whose `settings.json` now points at the fixture scan root instead of
`~/Repos` and `~/Projects`.

---

## 1. The stale-list bug reproduces on real data — the one thing that feels broken

Click the star on **VibeOS**: the row flips in SQLite, the card keeps reading
`Pin VibeOS` — and goes on reading it through a page of other interactions. Only
the command palette's **Refresh Catalog** turns it into `Unpin VibeOS`. Reported
in step 8 exactly as `Pin VibeOS → Pin VibeOS → (after refresh) Unpin VibeOS`.

Root cause is the same one found on seeded data: the renderer invalidates
`["catalog"]`, a key **no query uses** (the list keys are `["repos","list",…]`).
Six call sites across four hooks. On a 273-repo catalog this is worse than it
sounds, because the affected surfaces — star, tags, scan results, delete — are
precisely the ones whose whole value is that they are immediate.

## 2. The 200-repo cap showed three different numbers at once (ATR-042) — fixed

The catalog holds **273** repos (274 once the fixture is indexed). One screen
displayed: the rail's `All repos 200`, the toolbar's `188 of 273`, and a grid
that rendered **188 cards**. All three were wrong in different ways, and all
traced to one call: the index route read `catalog.list({ limit: 200 })` — one
page — while the contract's own `total` said 273. So the rail counted a page
(200), the toolbar compared a filtered page against the catalog total
(`188 of 273`), and 73 repos were simply unreachable, `50statesforukraine`
among them (findable only by typing its name).

**Fixed** by reading the list to completion instead of taking one page:
`readAllRepos` (in `hooks/use-repos.ts`) walks `catalog:list` a 200-row page at
a time until `total` is consumed, and `useAllRepos()` is what the catalog route
now calls.
The per-request ceiling stays (it is the right bound for a payload); only the
consumer changed. `useGroupMemberSlugs` had the same shape — a manual group
larger than 200 members was truncated the same way — and now pages too, as does
the spotlight window's repo search.

This walkthrough now asserts the three surfaces agree (`rail === toolbar total
=== catalog total`, `cards === toolbar shown`), that page two is actually on
screen, and that the difference has a door: `cards + Archived count === total`,
and toggling **Archived** reveals all of them. Measured here — `rail 273`,
`toolbar "238 of 273"`, `archived 35 revealed 273` — so 238 + 35 = 273 with
nothing behind a wall. The search path keeps its 200-result ceiling: ranked
results are not the catalog, and a name query matches its repo directly.

The count no longer leaves the difference to be reverse-engineered either. When
it is smaller than the catalog it is a control: clicking it opens a strip naming
the filters that are keeping repos out — a folder scope, an owner filter, a
group, a search, favourites-only, the archive — each as a chip carrying **its
own count** and ranked by impact, so the filter that gives back the most repos
is the one you read first, plus one **Show all 273**.

The counts come from the filtering pass itself: one rejection per repo,
attributed to the *first* filter that rejects it. That makes them disjoint and
exactly additive — they sum to the difference the count states — where a count
derived per filter would double-count a repo that two filters both exclude and
leave the chips failing to add up. Measured on the real catalog with the archive
and the owner view both on: `owner Mine 185` + `Archived 35` = **220 of the 220**
repos the grid was missing (`53 of 273`), with the bigger chip first. Step 3 of
the pass sets both filters, asserts the chips are ranked and that they account
for the whole difference, and that **Show all** then puts all 273 on screen.

The blank grid is the same derivation read from the other end. It used to shrug
("Try a different search, or clear the filters") after working out the culprit
for itself with a chain of guesses that could name a filter hiding nothing — an
archived repo can exist while it is the folder scope that emptied the grid. It
now takes the first entry of the ranked list, so the two surfaces name the same
filter by construction, and offers to clear it: search a nonsense term on the
real catalog and the grid reads
`Nothing matches “zzz-no-such-repo” / Hidden by search “zzz-no-such-repo”.` with
one **Clear search** button and **Show all 273**. Clicking the button restores
all 238 cards without hunting the toolbar
(`shots/005-real-empty-culprit.png`, `shots/006-real-empty-cleared.png`); step 5
asserts the named filter matches the reason the strip ranks first and that
clearing it brings the grid back.

Giving up on the query was the last thing the blank grid got wrong: it named the
filter, and then had nothing to say about the query itself. A search that
matches nothing now offers the repos closest to what was typed — scored over the
catalog the renderer already holds (no round trip, and it works while the
backend is unreachable), with a word in a repo's name counting for more than the
same word in its description, and quiet unless one repo accounts for most of the
query. Two repos are compared by *kind* before degree: a word mistyped by a
letter or two is a different piece of evidence from a word that merely overlaps
the query, and the second can never outrank the first — "Liber" is not nearer to
"liberary" than "Library" is, it is just shorter. Step 5 mistypes a word in the middle of a real repo's name — the one
place the backend's prefix search cannot reach — and gets that repo back
(`shots/007-real-empty-near-miss.png`); taking the suggestion searches for the
repo by name and opens it (`shots/008-real-near-miss-picked.png`). The list is
offered only when the search is what emptied the grid: three repos hidden by a
filter are not "close" to anything — they are right there, behind a control the
reader turned on — and the grid names that control instead.

This does not rest on this pass. `tests/e2e/catalog-flow.spec.ts` — the committed
Electron suite, which runs on any machine — makes the same assertions against the
three seeded repos: a misspelling of one of their names must put that repo back
as a suggestion, picking the suggestion must replace the query and return the
card, the grid's own button must clear the filter it named, and a filter that
empties the grid must be named with **no** suggestion list. This pass is the
reason the behaviour is worth having; the suite is what keeps it.

## 3. Destructive controls that are still present and reachable

The file-management surface (move / rename / create folder) is genuinely gone —
that is the read-only commit. These remain:

| Control | Where | What it does |
|---|---|---|
| **Kill** | `/processes`, one per row; also the port chip on a repo card | SIGINT → SIGTERM → SIGKILL against a **real OS process** |
| **Stop scanning…** | rail scan-root menu → dialog | drops the scan root, can forget every repo under it |
| **Remove from catalog…** | detail panel | deletes the catalog row (only rendered for a missing folder; 0 in this catalog) |

`/processes` listed **167 rows with 167 Kill buttons**, and the great majority are
`(unmatched)` machine-wide daemons — `ControlCenter`, `rapportd`, `mongod`,
`LogiPluginService` — under a subtitle that reads "dev servers detected across all
configured repos". The Kill button never discriminates between the two. Screenshot
`022-real-processes.png`. **None of these were fired.**

## 4. Task output opens with the developer's own shell noise (new)

The task runner itself is sound — `025/026/027` show `TASKS 2` expanded, `serve`
running with its spinner, then the run stopped and the pane cleared. But the
output pane starts with the user's shell config, not the task:

```
(anon):setopt:7: can't change option: monitor
[31mERROR[39m: gitstatus failed to initialize. …
Add the following parameter to ~/.zshrc for extra …
```

`src/main/services/tasks.ts:369` spawns `[shell, "-l", "-i", "-c", command]`. The
`-i` is deliberate and load-bearing — the comment explains it is what puts
`nvm`/`pyenv`/Homebrew shims on `PATH` — but it also sources `~/.zshrc`, so every
run is prefixed with powerlevel10k / gitstatus stderr, emitted with raw ANSI
escapes (`FORCE_COLOR=0` does not stop p10k's own escapes). Every task in this
build looks like it failed at line 1. The trade-off is real, so the fix is likely
to separate the shell's startup banner from the task's output rather than to drop
`-i` and break `PATH`.

Verification here deliberately used the **temp fixture**, not a real repo:
clicking Run on a real repo executes an arbitrary npm script inside the
developer's working tree (`dev` holding a port, `build` writing files). The
fixture's only scripts are `console.log` and a 120 s sleep.

## 5. Real READMEs render with broken images (CSP) — cosmetic

109 refusals, zero script errors. The CSP allows images from `self`, `data:`,
`blob:` and `avatars.githubusercontent.com`, so every badge in a real README is
blocked: `shields.io`, `dcbadge.vercel.app`, `i.vimeocdn.com`. Visible as
broken-image icons in `013-real-detail-panel.png` and in card covers for
`claude-os`, `space-agent`, `ratel`. Probably deliberate — it is a security
boundary — but on real repos it reads as a rendering bug. Card covers also
resolve to `file://` paths that do not exist (`ERR_FILE_NOT_FOUND`).

## 6. Single-character heuristic tags (new)

120 of 273 repos carry a 1–2 character tag, all `source: heuristic`:

| tag | repos |
|---|---|
| `ci` | 116 |
| `go` | 8 |
| `c` | 4 |
| `c#` | 1 |

`ci` and `go` read fine. **`c` does not** — it is the language C lowercased, and it
is indistinguishable from a typo (see the `TAGS` row in
`013-real-detail-panel.png`). Heuristic tags are not user-editable, so there is no
way to remove it, and a one-letter tag is useless for filtering.

## 7. Not a bug — "Version 36.9.5" in the Updates panel

The pass shows `Version 36.9.5` (Electron's version). That is the harness: it
launches `electron out/main/index.js`, and with a bare script path
`app.getVersion()` falls back to Electron. Launched normally it reports
**0.1.8** — verified both ways during this session.

## 8. Note for anyone re-running this suite

The first attempts hung with **no window and 0 % CPU**, which looks exactly like a
wedged app. It was macOS: once the crash reporter has recorded a crash for the
bundle, AppKit opens its modal "reopen windows?" alert
(`NSPersistentUIRestorer promptToIgnorePersistentStateWithCrashHistory` →
`NSAlert runModal`) *before* the window exists, blocking the main thread. Nothing
can dismiss it over the debugger protocol, so `firstWindow()` never resolves. The
crash history here was self-inflicted (SIGKILLing Electron between attempts), and
the suite now passes `-ApplePersistenceIgnoreState YES`, which switches the whole
restore/prompt path off. `sample <pid>` on the blocked process is what identified
it; the profile gave it away too — a healthy boot creates `Local Storage/` and
`Preferences`, the blocked one created neither.

## What was exercised on real data and works

Boot against the copied profile with the OS-launch seams neutralised; the real
catalog (273 rows, 238 cards shown, 35 archived behind one toggle, and the count
opening a strip that names the filter and clears it — **Show all** → 273 cards);
search (`50statesforukraine` → 2, a nonsense term whose empty grid names the
search and clears it, and a one-letter mistype of a real repo's name, whose
empty grid offers that repo and puts it back on screen); Gallery, Grid,
Table; 6 group modes, 6 sort keys and reverse; the rail with real taxonomy —
**All repos, Favourites, Mine, Local only, Cloned, Uncommitted**, plus expand and
collapse of the `~/Repos` scan root and its real subfolders; four different repos
opened in turn with the panel matching each (`VibeOS` →
`andrej-karpathy-skills` → `Emergence-World` → `anthropics-skills`, each checked
against its path); the favourite star; all five launcher icons with the OS calls
stubbed (editor resolved to the saved default); Cmd-click multi-select + Clear;
the table's Project/Owner/Language/Size/Touched sorts and row open; tag add **and
remove** (asserted gone afterwards); the curate-link dialog against the real
catalog — asserted `50statesforukraine` and then removed it; Open with the editor
and the full detail page; `/processes` refresh; Settings (editor/terminal
detection found 5 editors, identity add/remove, scan-path add/remove, **Scan now**
→ `found 1, indexed 1, errors 0`); the task runner (run → stop → clear); `/debug`
ping → pong; the command palette (8 actions).
