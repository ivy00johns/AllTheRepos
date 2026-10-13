# Alpha walkthrough — Electron desktop pass

Ran 2026-10-12T06:15:52.768Z. Deferred: graph, Claude panel, mobile.

**54 ok · 2 failed · 1 skipped · 0 console errors · 38 screenshots**

| # | step | result | detail |
|---|------|--------|--------|
| 1 | App launches and paints the catalog | ✅ |  |
| 2 | Neutralise OS-launch seams (shell, clipboard, folder picker) | ✅ | shell.openExternal / showItemInFolder / clipboard.writeText replaced in main; PATH prefixed with stub open/osascript |
| 3 | Give the seeded repos a package.json (so Tasks renders) | ✅ | 3 repo(s) prepared |
| 4 | Top bar: sidebar toggle (both ways) | ✅ |  |
| 5 | Top bar: AllTheRepos home link | ✅ |  |
| 6 | Top bar: search input — type, settle, clear | ✅ |  |
| 7 | Keyboard: `/` focuses search | ✅ |  |
| 8 | Top bar nav: Running → /processes | ✅ |  |
| 9 | Top bar nav: Settings → /settings | ✅ |  |
| 10 | Top bar dev door: Debug → /debug (unpackaged only) | ✅ |  |
| 11 | /debug: Ping again | ✅ |  |
| 12 | Return to the catalog | ✅ |  |
| 13 | Catalog toolbar: Gallery / Grid / Table view modes | ✅ |  |
| 14 | Catalog toolbar: every Group option | ✅ |  |
| 15 | Catalog toolbar: every Sort option + reverse | ✅ |  |
| 16 | Archived toggle | ⏭️ | no archived repos in the seeded catalog |
| 17 | Catalog toolbar: Archived toggle (if offered) | ✅ |  |
| 18 | Catalog toolbar: Fetch | ✅ | 3 without a remote Dismiss |
| 19 | Catalog toolbar: Pull | ✅ | 3 without a remote Dismiss |
| 20 | Catalog: dismiss a transient notice, if any | ✅ |  |
| 21 | Rail: All repos / Favourites / Mine / Local only / Cloned | ✅ |  |
| 22 | Rail: Add folder to scan (picker stubbed to the fixture) | ❌ | fixture repos did not appear after the scan |
| 23 | Rail: scan-root menu — Scan now | ✅ |  |
| 24 | Rail: Stop scanning dialog — both radio options, then Cancel | ✅ |  |
| 25 | Rail: 'directly in this folder' row (if present) | ✅ |  |
| 26 | Catalog: select every repo card (opens the detail panel) | ✅ | 3 cards rendered, clicked through |
| 27 | Detail panel: close button | ✅ |  |
| 28 | Repo card: favourite star on / off | ✅ |  |
| 29 | Repo card: every launcher icon | ✅ | editor, terminal, finder, remote, copy |
| 30 | Repo card: cmd-click multi-select, then Clear selection | ✅ |  |
| 31 | Table view: column sort + row select + star | ✅ |  |
| 32 | Detail panel: Details tab (Claude tab deferred) | ✅ | 2 tab(s) present; Claude tab left alone on purpose |
| 33 | Detail panel: add a tag, then remove it | ✅ |  |
| 34 | Detail panel: Related → Add → assert a link | ✅ |  |
| 35 | Detail panel: remove the curated link | ✅ |  |
| 36 | Detail panel: Tasks — expand, run, stop, clear output | ✅ |  |
| 37 | Detail panel: Open in editor + open full detail page | ✅ |  |
| 38 | Processes: start a dev server so a row exists | ✅ | server pid 10837 in /private/var/folders/1q/783qksvs4mq6ylpzq4b8bg280000gn/T/atr-walkthrough-4FoWQL/scan-root/Fixture Beta |
| 39 | Processes: Refresh + copy URL + Kill (confirm dialog) | ✅ |  |
| 40 | Settings: add a scan path, then remove it | ✅ |  |
| 41 | Settings: embeddings inputs | ✅ |  |
| 42 | Settings: default editor + terminal selects | ✅ | editor=vscode, terminal=iterm2 |
| 43 | Settings: add an identity, then remove it | ✅ |  |
| 44 | Settings: Check for updates | ✅ | Version 36.9.5 |
| 45 | Settings: Save settings | ✅ |  |
| 46 | Settings: Scan now | ✅ | Completed — 2 repos in 545ms |
| 47 | Keyboard: j / k navigate, Enter opens, Esc closes | ✅ |  |
| 48 | Keyboard: g s chord → Settings | ✅ |  |
| 49 | Command palette: Cmd+K opens it | ✅ | Open SpotlightSearch across all repos from anywhere⌘⇧Space \| Open Command PaletteRun any action from the keyboard⌘K \| Open Settings⌘, \| Toggle DevTools⌘⌥I \| Open Debug PageThe Phase 0 bridge/ping smoke test \| Refresh Catalog⌘R \| Focus Search/ \| Toggle Sidebar⌘\ |
| 50 | Command palette: run "Open Settings" | ❌ | palette item "Open Settings" not offered |
| 51 | Command palette: run "Refresh Catalog" | ✅ |  |
| 52 | Command palette: run "Focus Search" | ✅ |  |
| 53 | Command palette: run "Toggle Sidebar" | ✅ |  |
| 54 | Command palette: run "Open Debug Page" | ✅ |  |
| 55 | Command palette: run "Open Spotlight" | ✅ |  |
| 56 | Command palette: run "Toggle DevTools" | ✅ |  |
| 57 | Return to the catalog and settle | ✅ |  |

## Seam activity (what OS launches were — deliberately — intercepted)

```json
{
  "openExternal": [
    "vscode://file/private/var/folders/1q/783qksvs4mq6ylpzq4b8bg280000gn/T/atr-e2e-template-U8cnGW/repos/demo-library",
    "vscode://file/private/var/folders/1q/783qksvs4mq6ylpzq4b8bg280000gn/T/atr-e2e-template-U8cnGW/repos/demo-library"
  ],
  "showItemInFolder": [
    "/private/var/folders/1q/783qksvs4mq6ylpzq4b8bg280000gn/T/atr-e2e-template-U8cnGW/repos/demo-library"
  ],
  "clipboard": [
    "/private/var/folders/1q/783qksvs4mq6ylpzq4b8bg280000gn/T/atr-e2e-template-U8cnGW/repos/demo-library"
  ]
}
```
