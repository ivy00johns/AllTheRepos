# Real-data walkthrough

Ran 2026-10-13T00:54:22.250Z against a copy of `/Users/johns/Library/Application Support/alltherepos`.

**23 ok · 0 failed · 0 skipped · 0 script errors · 109 CSP/asset refusals**

| # | step | result | detail |
|---|------|--------|--------|
| 1 | Boot against the real profile (copied) | ✅ | seams ok; Debug affordance: 1 |
| 2 | Catalog: rail, toolbar and grid agree — nothing lost past one page | ✅ | 273 repos · rail 273 · toolbar "238 of 273" · page 2 on screen 50/73 · archived 35 revealed 273 |
| 3 | The count explains the difference and can clear it | ✅ | strip "Hidden by owner Mine 185 Archived 35 Show all 273" · counts 185+35 = 220 of 220 missing · Show all → 273 cards · filters off again, 238 cards |
| 4 | Search a real repo name | ✅ | "50statesforukraine" → 2 result(s) |
| 5 | An empty grid names the filter that emptied it, and offers the nearest repos | ✅ | Nothing matches “zzz-no-such-repo” Hidden by search “zzz-no-such-repo”. Clear search “zzz-no-such-repo” Show all 273 · clear → 238 cards back · mistyped "50statesforukraine" → offered 50statesforukraine-site |
| 6 | Gallery / Grid / Table | ✅ | clicked Gallery, Grid and Table |
| 7 | Every Group and Sort option | ✅ | 6 group modes, 6 sort keys, reverse toggled twice |
| 8 | Rail: views + a real folder | ✅ | views: All repos, Favourites, Mine, Local only, Cloned, Uncommitted \| toggled folder: Repos |
| 9 | Select 4 different real repos; panel must match each | ✅ | opened 4: VibeOS, andrej-karpathy-skills, Emergence-World, anthropics-skills |
| 10 | Favourite star on a real repo, then back off | ✅ | Pin VibeOS → Pin VibeOS → (after refresh) Unpin VibeOS; reverted |
| 11 | Launcher icons on a real repo (OS launches stubbed) | ✅ | editor, terminal, finder, remote, copy \| footer: Open anthropics-skills with the default editor |
| 12 | Cmd-click multi-select + Clear selection | ✅ | cmd-clicked 2 more cards, then Clear selection |
| 13 | Table view: sort columns, open a row | ✅ | sorted by Project, Owner, Language, Size, Touched; opened a row |
| 14 | Detail panel: add a tag then remove it | ✅ | added then removed the tag "zz-walkthrough" |
| 15 | Detail panel: assert a curated link, then remove it | ✅ | asserted "50statesforukraine" then removed it |
| 16 | Detail panel footer: Open in editor + full detail page | ✅ | opened in the editor, opened the full detail page, came back |
| 17 | Processes: refresh (Kill deliberately not fired) | ✅ | 158 rows, 158 kill buttons — not fired |
| 18 | Settings: selects, identity, scan paths, Scan now (bounded) | ✅ | removed 2 real scan path(s) on the copy; scan found 1, indexed 1, errors 0 |
| 19 | Task runner: expand, run, stop, clear (on the indexed fixture) | ✅ | ran and stopped the fixture's serve task; output pane cleared |
| 20 | /debug: ping round-trip | ✅ | ping → pong over IPC |
| 21 | Command palette: open and list actions | ✅ | 8 actions offered |
| 22 | Inventory the destructive controls that still exist (none fired) | ✅ | rail menu → Stop scanning… |
| 23 | Return to the catalog | ✅ | catalog back with 239 cards |

## Destructive controls present but NOT fired

- /processes exposes 158 live "Kill PID" button(s) (158 rows listed)
- rail menu → Stop scanning…
