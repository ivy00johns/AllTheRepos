# 2026-10-06 — Installed-DMG symptom baseline & first fixes

Point-in-time record behind the "the DMG I installed is broken" report. Captures
the measurements taken **before** any change, the three deterministic fixes
landed in this pass, and the baseline numbers the still-open list-performance
and CPU/GPU phases will be measured against.

## Environment & method

- Worktree branch `freebuff/we-need-to-test-…`, built from source
  (`pnpm electron:build`), launched via Playwright `_electron` with an
  **isolated `--user-data-dir`** so the installed `/Applications/AllTheRepos.app`
  (which holds the single-instance lock and the user's real catalog) was never
  touched.
- Catalog: 12 seeded repos plus whatever the legacy `~/.alltherepos/` migration
  brought in — **118 cards** rendered, so the grid measurement is against a
  realistic list, not a toy one.
- Window: default **1280×800** (devicePixelRatio 2).
- Native menu inspected from the main process via `Menu.getApplicationMenu()`.
- `ps -Ao %cpu,%mem,rss` was used for CPU/RSS. Note it reports a **lifetime
  average**, not an instantaneous sample, so it is a coarse floor.
  **GPU was not measured** — `powermetrics` needs elevation, and the Activity
  Monitor GPU column is not scriptable here. That gap is explicit, not a zero.

## Symptom 1 — Grid collapses to one full-width column

Content width is `window − rail (256px) − detail panel (380px) = 644px` at the
default window. Grid columns were `repeat(auto-fill, minmax(320px,1fr))`, and two
tracks need `2×320 + 12 gap = 652px`, so `auto-fill` produced **one** column.

| | measured before | after |
| --- | --- | --- |
| Grid tracks, no selection | 2 (`480px 480px`) | 3 (`316px 316px 316px`) |
| Grid tracks, repo selected (panel 380px) | **1 (`592px`)** | **2 (`290px 290px`)** |

Fix: grid minimum column width 320px → **240px** (`GRID_COLUMNS` in
`repo-grid.tsx`), so two columns survive the rail + panel at the default size.

## Symptom 2 — Top bar sits under the macOS traffic lights

The window uses `titleBarStyle: "hiddenInset"`; the traffic lights overlay the
top-left ~76px of web content. The top bar had no reserved space.

| | before | after |
| --- | --- | --- |
| Sidebar-toggle button `left` | **12** (under the traffic lights) | **76** |

Fix: reserve a 76px left inset on the header, darwin only
(`MAC_TRAFFIC_LIGHT_INSET` in `top-bar.tsx`).

## Symptom 3 — Menu accelerators shadowing the real actions

`Menu.buildFromTemplate` binds the **first** matching accelerator and drops the
rest, so standard-menu roles silently ate the renderer actions' shortcuts.

| Accelerator | Before (wins) | After (wins) |
| --- | --- | --- |
| `CmdOrCtrl+R` | View ▸ Reload (role) — reloads the window | `catalog.refresh` |
| `CmdOrCtrl+,` | App ▸ Settings… (explicit) | `app.open-settings` |
| `CmdOrCtrl+Alt+I` | View ▸ Toggle Developer Tools (role) | `app.toggle-devtools` (dev only) |

Explicit duplicate accelerators in the built menu: **1** before → **0** after.
Clicking `Open Settings` reaches the renderer handler (navigates to Settings) in
both cases — the click was never broken; the *shortcuts* were being intercepted.

Fix: `buildAppMenu` no longer hardcodes `CmdOrCtrl+,` on `Settings…`;
`buildViewMenu` drops `reload`/`forceReload` in every mode and `toggleDevTools`
outside dev builds; `actionToMenuItem` claims each accelerator once, and logs
(never silently drops) when one is already taken.

## Symptom 4 — Repo actions no-op'd silently with nothing selected

`repo.copy-path` / `repo.open-in-editor` / `repo.open-in-finder` returned with
no feedback when no repo was focused, which reads as a broken menu.

Verified live: invoking `Open in Editor` from the native menu with nothing
selected now shows
`"Select a repo first to open it in your editor."` in the notice strip
(`ActionNotice`, backed by the `notice` slot on the UI store).

## Baselines for the follow-up phases

Idle, catalog open, nothing else happening (two samples 8s apart):

| Process | CPU (lifetime avg) | RSS |
| --- | --- | --- |
| main | 0.3–3.4 % | 115–262 MB |
| renderer | ~0 % | 225–272 MB |
| GPU helper | not measured | — |

Still-open causes for the "slow / always rescanning / high CPU-GPU" report (not
addressed in this pass — next phases):

- `listRepos` selects every column including full `readme_content` for all rows,
  with no SQL `LIMIT`, on every `["catalog"]` invalidation.
- `catalog:on:changed` invalidates the whole catalog; `shouldIgnorePath` is
  O(repos) per filesystem event.
- `process:list` polls every 5s and **every** `RepoCard` subscribes; cards are
  not memoized.
- `vibrancy: "sidebar"` + `backdrop-blur` sticky headers + `animate-ping` port
  chips add compositor work; the Map runs fcose `quality: "proof"` with
  `numIter: 3500` synchronously.
- The catalog is capped at 200 rows, so >200-repo libraries silently truncate.
