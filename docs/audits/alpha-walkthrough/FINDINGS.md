# Alpha walkthrough — findings

Companion to `report.md` (the raw, machine-generated step log) and `shots/`.
Desktop only. Deferred by request: `/graph`, the Claude panel, mobile.

Pass result: **54 ok · 1 real defect · 1 harness artifact · 1 skipped · 0 console errors · 38 screenshots.**

The skipped step is the Archived toggle — there are no `_archive`-style folders in
the seeded catalog, so the control is correctly absent.

---

## 1. Catalog mutations invalidate a query key that does not exist — the grid never refreshes in place

**Severity: high for the alpha.** Every catalog-mutating path in the renderer calls
`invalidateQueries({ queryKey: ["catalog"] })`, but the repo list is keyed
`["repos", "list", filters]` (`queryKeys.repos.all` = `["repos"]`, `src/renderer/lib/query-client.ts`).
Nothing uses a bare `["catalog"]` key — the only keys that begin with it are
`["catalog","cover",slug]` and `["catalog","tasks",slug]` — so the invalidation
matches the cover-image and task-list caches and misses the repo list entirely.

Reproduced twice, deterministically, against the private seeded profile:

- **Add a scan root** (`Rail → Add folder to scan`). The database goes from 3 → 5 repos
  within ~3 s and the rail updates, but the grid stays pinned at 3 cards at t+3 s,
  t+8 s, t+15 s and t+25 s. It only catches up when `/` is remounted (the walkthrough
  navigated away and back, which is why a later screenshot shows all 5).
- **Toggle a favourite star.** The database flips (`dbFavorites: ["Demo Library"]`)
  but the card's star keeps saying `Pin Demo Library`. Running the command palette's
  **Refresh Catalog** — which invalidates the correct `["repos"]` key
  (`actions/registry.ts`) — makes it say `Unpin Demo Library`.

Affected call sites (all should use `queryKeys.repos.all`):

| File | Hook | What silently fails to refresh |
|---|---|---|
| `src/renderer/hooks/use-actions.ts:39-42,62` | `useToggleFavorite` | optimistic star update **and** the settle refetch |
| `src/renderer/hooks/use-actions.ts:78` | `useFetchRepos` | behind/ahead after Fetch |
| `src/renderer/hooks/use-actions.ts:90` | `usePullRepos` | state after Pull |
| `src/renderer/hooks/use-scan-roots.ts:23` | add / remove scan root | newly scanned (or removed) repos |
| `src/renderer/hooks/use-scan.ts:115` | scan completion | catalog after "Scan now" |
| `src/renderer/hooks/use-catalog-live.ts:55` | live file watch | catalog after a change on disk |

The palette's "Refresh Catalog" and `useSetRepoTags`/`useDeleteRepo` use the right
keys, which is what makes the bug easy to see: the same mutation refreshes from one
entry point and not another. One-line fix per site.

## 2. The Processes page lists every listener on the machine, and offers Kill on all of them

The page's own subtitle is "Listening dev servers detected across all configured repos",
but on this machine it rendered **162–166 rows**, nearly all `(unmatched)`: `rapportd`,
`ControlCenter`, `mongod`, `LogiPluginService`, and five separate `workerd` processes
from an unrelated Cloudflare dev server. System daemons are mixed in with the user's own
servers and every row carries a live **Kill** button.

This bit the walkthrough itself: the Kill step clicked the first row, which was an
`(unmatched)` system listener rather than the fixture server it had started. The
confirm dialog said `Kill PID 454 … workerd on port 64815`; it was confirmed and the
PID is now gone. (The real `workerd` on port 64815, PID 11332, is still running — so
either the detection paired the wrong PID with the port, or that stray process was
already dead. Either way, targeting by row position is not safe, and the UI gives no
signal about which rows are the user's own repos.)

Worth deciding for the alpha: default to repos-only (matched) listeners and put
unmatched ones behind a disclosure, and/or require the repo to be in the catalog
before offering Kill.

## 3. Harness artifact (not an app bug)

The `palette → "Open Settings"` step failed with "palette item not offered". It was
the walkthrough's own fault: the previous step left the palette open, so the next
`Cmd+K` *closed* it instead of opening it, and the item was never on screen. Every
subsequent palette item (Refresh Catalog, Focus Search, Toggle Sidebar, Open Debug
Page, Open Spotlight, Toggle DevTools) ran fine.

## What was exercised and looked correct

- Every top-bar control, all four nav destinations (Running, Settings; Map/Claude
  deliberately skipped), the dev-only Debug door, and `system.ping` round-trip.
- Catalog: all three view modes, every Group and Sort option plus reverse, Fetch,
  Pull, notice dismissal, the whole rail (views, scan-root menu, "Stop scanning"
  dialog radios, "directly in this folder", adding and scanning a folder).
- Repo cards: selection, favourite star, all five launcher icons, Cmd-click
  multi-select and Clear selection; the table view's column sorts and row controls.
- Detail panel: tabs (Claude untouched), add/remove a tag, assert and remove a
  curated link, expand the Tasks section and run/stop/clear a task, "Open in
  Visual Studio Code", "open full detail page".
- Settings: scan-path add/remove, embeddings inputs, editor/terminal selects,
  identity add/remove, Save, Check for updates, Scan now (found 2 repos).
- Keyboard: `/`, `j`/`k`, Escape, the `g s` chord, `Cmd+K`.
- No console errors or uncaught page errors anywhere in the pass.

The two OS-facing seams the harness neutralised (`shell.openExternal`,
`shell.showItemInFolder`, `clipboard.writeText`, plus a stubbed `open`/`osascript`
on `PATH`) recorded the intended calls and opened nothing — see the seam block in
`report.json`.
