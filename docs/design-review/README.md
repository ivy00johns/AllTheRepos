# AllTheRepos — design review packet

51 screenshots of the running desktop app, for a designer (or a design model) to
review and redesign: every route, every view mode, the repeating elements on
their own, the dialogs, the two satellite windows, and the app at the window's
minimum widths.

Nothing here is a mockup. Each image is the built app driven through Playwright
and captured at CSS-pixel scale, so what you see is the shipped renderer.

- **`screens/`** — the whole window, 1440×900 unless the filename says otherwise
- **`elements/`** — one component per image, cropped out of those screens
- **`windows/`** — the spotlight panel and the menu-bar popover, at their own sizes
- **`manifest.json`** — the same inventory, machine-readable, with capture notes

This file is the evidence. The direction that came out of it — what to fix, what
to keep, and the one look to commit to — is in [BRIEF.md](./BRIEF.md).

## Provenance, and why the data looks invented

The app is local-first: the real library on the machine that built this packet is
that person's actual repositories. So the packet runs against a **synthetic demo
library** (twelve repos, four languages, one dirty tree, one local-only, one
clone of somebody else's project) in a throwaway profile — the same demo library
the README screenshots use. The scan root is `~/Code`, and it is created and
deleted by the capture script.

The Claude screens are a **second launch with `HOME` pointed at a temp
directory** holding invented `~/.claude.json` and session transcripts, because
that service reads the real home and would otherwise put real project paths in
the pictures. The token counts, session counts and heatmap on
`22-claude-usage.png` are fabricated; the layout is not.

Re-generate with:

```bash
node scripts/ensure-native-abi.mjs electron
pnpm electron:build
node scripts/make-design-shots.mjs          # writes docs/design-review/
```

## 1. The screens

### Catalog — the app's main surface

| Image | What it is |
| --- | --- |
| `screens/01-catalog-grid.png` | Grid view, nothing selected: rail, toolbar, grouped card grid, empty detail column |
| `screens/02-catalog-detail-open.png` | Grid view with a repo selected — the three-pane layout at full width |
| `screens/03-catalog-gallery.png` | Gallery view — cover art, one row of large cards |
| `screens/04-catalog-table.png` | Table view — one line per repo, a header per group |
| `screens/07-catalog-search.png` | A search with one keyword result, plus the "semantic search is off" strip |
| `screens/17-catalog-1280x800.png` | Grid + detail at the layout contract's own height |
| `screens/18-catalog-table-1280x800.png` | Table at 1280×800 |
| `screens/20-catalog-1024x768.png` | 1024×768 — nav labels collapse, the toolbar wraps, card actions appear |

### One repository

| Image | What it is |
| --- | --- |
| `screens/11-repo-page-details.png` | Full-page repo view, details tab, README rendered below the metadata |
| `screens/12-repo-page-notes.png` | Notes tab: markdown editor beside its preview |
| `screens/23-repo-page-claude.png` | Claude tab: launch actions, CLAUDE.md, skills, agents, MCP servers |
| `screens/21-repo-page-1024x768.png` | The same page at 1024×768 |

### The other routes

| Image | What it is |
| --- | --- |
| `screens/09-processes.png` | Running dev servers, bound to the repo that owns each cwd |
| `screens/10-graph.png` | Map: relationship canvas, signal filters, cluster list |
| `screens/22-claude-usage.png` | Claude usage: 4 stat cards, 12-week heatmap, per-project table |
| `screens/08-settings.png` | Settings: scan paths, embeddings, editor/terminal, updates, identities, scan now |
| `screens/19-settings-1280x800.png` | Settings at 1280×800 |
| `screens/13-debug.png` | Debug: a bridge round-trip, development builds only |

### Overlays

| Image | What it is |
| --- | --- |
| `screens/05-command-palette.png` | ⌘K palette at rest, grouped commands |
| `screens/06-command-palette-filtered.png` | Palette narrowed by a query |
| `screens/14-dialog-new-group.png` | New group |
| `screens/15-dialog-curate-link.png` | Assert that two repos belong together |
| `screens/16-dialog-tag-cleanup.png` | Review a bulk tag rewrite before applying it |
| `windows/spotlight.png` | The global quick-open panel (720×440, frameless) |
| `windows/tray-popover.png` | The menu-bar popover (320×420) |

## 2. The elements

| Image | What it is |
| --- | --- |
| `elements/top-bar.png` | Menu, wordmark, search, update chip, nav, Debug |
| `elements/nav.png` | The five destinations, with the running-processes badge |
| `elements/search-bar.png` | Search field and its `/` focus hint |
| `elements/catalog-toolbar.png` | View switch, Group, Sort, Save filter, Tag cleanup, Fetch, Pull, Select all, count |
| `elements/view-mode-switch.png` | Gallery / Grid / Table on its own |
| `elements/folder-rail.png` | Views, folder tree, scan roots, groups |
| `elements/repo-card.png` | One grid card |
| `elements/repo-card-dirty.png` | A card with a port, a dirty mark and a local-only mark |
| `elements/repo-table.png` | The table's header and rows |
| `elements/detail-panel.png` | The whole detail panel: header, tabs, metadata, languages, tags, related, groups, README, footer |
| `elements/detail-tabs.png` | Details / Notes / Claude |
| `elements/command-palette.png` | The palette dialog |
| `elements/process-table.png` | Process table with port chips |
| `elements/graph-clusters.png` | The cluster list |
| `elements/graph-signals.png` | The six relationship signals |
| `elements/dialog-new-group.png` | New-group dialog |
| `elements/dialog-curate-link.png` | Curate-link dialog |
| `elements/dialog-tag-cleanup.png` | Tag-cleanup dialog |
| `elements/settings-scan-paths.png` | Scan-path rows and the add form |
| `elements/settings-embeddings.png` | Ollama / OpenAI fields |
| `elements/settings-updates.png` | Update check and channel |
| `elements/settings-identities.png` | Identity list |
| `elements/settings-scan-now.png` | Manual scan card |
| `elements/claude-range.png` | 7d / 30d / 90d / All |
| `elements/claude-heatmap.png` | The heatmap block — note it occupies about a fifth of the card it sits in |
| `elements/claude-tab.png` | The Claude tab's cards and tables |

## 3. What is wrong with it

Written from the images above. The design is coherent — dark, mono labels, one
green accent — and that coherence is exactly what makes these read as generic:
each choice is the default one, applied everywhere.

### 3.1 The repo card — the app's central object — fails at all three of its jobs

- **The name truncates.** `02-catalog-detail-open.png` shows `Lighthou…`,
  `weatherb…`; at 1280 (`17-catalog-1280x800.png`) the selected card reads
  `lighthouse-…`. The one string a person is scanning for is the first thing
  thrown away, and it happens with hundreds of pixels of free space to the right.
- **The card has no hierarchy.** Avatar, name, ownership, folder, description,
  recency bar, date, language, star and — on hover/selection — five action icons
  all share one weight and one density. The card is a list of facts, not a
  scannable object.
- **Selection is a green border plus a row of icons.** At 1280 the action row
  overlaps the description (`The desktop surface: catalog, filter chips and th…`
  is cut mid-word by the icons) and a checkbox appears where the avatar was.
- **The cover art is a striped or dotted gradient with two initials**
  (`03-catalog-gallery.png`). Twelve of them, in five colour families. It is
  decoration generated from a hash — the strongest single "AI slop" tell in the
  app.

### 3.2 Two type vocabularies, no third

Mono uppercase 10–12px labels for chrome; 13–14px sans for content; a 20–24px
title for the one thing that is a heading. That is the whole scale.

- Section labels (`DESIGN 1`, `LANGUAGES`, `RELATED`, `WHICH REPOSITORY`) are all
  the same size, weight and tracking as the *values* underneath them, so nothing
  recedes.
- Body copy and its label are nearly the same size: in
  `elements/detail-panel.png`, `BRANCH` and `main` differ by 1px.
- Long explanatory sentences are set in the same 12px muted style as labels
  (`08-settings.png`: the editor section's four-line explanation;
  `15-dialog-curate-link.png`: the dialog description).
- Page titles are inconsistent: `Settings` and `Processes` are 20px sans;
  `Claude Usage` and `/debug — system.ping` are mono; the repo page has no page
  title at all, just a card header.

### 3.3 Green is doing five jobs

`--color-accent` (#4ade80 among others) is the brand, the primary action, the
selected state, the focus ring, the live-status dot's neighbour, the sparkline,
the token heatmap, the language ramp and the text-link colour.

- `elements/detail-panel.png`: the largest, loudest element in the panel is a
  full-width green **Open in Visual Studio Code** button — an action you take
  once per repo, painted like the app's primary purpose.
- `windows/spotlight.png` and `10-graph.png` also lean on green for selection.
- Meanwhile `--color-status-live` (#4ade80) was deliberately split from the
  accent, and the two now look identical, so the distinction the token makes is
  invisible.

### 3.4 Every surface is the same shadcn surface

One 1px border, one 8px radius, one `bg-card` fill, one 16–20px padding, applied
to: page sections, cards, the detail panel, dialog bodies, stat cards, table
wrappers, the heatmap card, the note editor. Nothing is inset, nothing is raised,
nothing is grouped by anything but a line.

Consequence visible in `08-settings.png`: six cards of equal weight down a single
column, so "which of these do I touch daily" has no answer. And the
**Test Ollama connection** button floats *outside* the Embeddings card it belongs
to, because the card is a container rather than a grouping.

### 3.5 Layout: a 970px column on a 1440px screen

- Settings, Claude, Processes, Debug and the repo page all set their content in a
  ~970px column that starts between x=226 and x=385 and leaves the entire right
  third empty. The three widths do not agree with each other or with the top bar.
- `10-graph.png`: the canvas labels collide into an unreadable smear
  (`lighthe ledg terrafo orchestrator`). Node labels are painted at a fixed size
  into a canvas whose opening framing does not fit them.
- `22-claude-usage.png`: the 12-week heatmap is a small grid hugging the left
  edge of a full-width card — roughly 80% of the card is empty
  (`elements/claude-heatmap.png`).
- `20-catalog-1024x768.png`: the detail panel's sticky footer
  (**Open in Visual Studio Code**) sits over the README, and the panel's own
  content is clipped at the bottom edge.
- `21-repo-page-1024x768.png`: the repo card overflows the right edge of the
  window.
- Grouped grids leave orphan rows: a group with one member draws one narrow card
  and a wide empty gutter (`01-catalog-grid.png`, first row).
- The table view repeats a five-column header for every group
  (`04-catalog-table.png`): five headers for twelve rows.

### 3.6 Data shown as database, not as language

- Repos are labelled by slug: `lighthouse-ui-e2b08309` in the process table and
  in the Claude projects table. The hash is the app's internal key and it is on
  screen in two places.
- `23-repo-page-claude.png`: MCP servers are `UNKNOWN` in a badge, next to
  `configured` in another badge — two chips saying nothing, one of them looking
  like an error.
- `10-graph.png`: six signal filters, five cluster rows, every count `0`.
- `07-catalog-search.png`: the semantic-search warning is a full-width amber
  strip with no icon container, reading like a build failure rather than a
  setting you could turn on.
- Empty values are written as sentences in italics (`No README detected.`,
  `Not in a group yet.`, `Nothing scattered — tidy machine.`), three different
  treatments for the same concept.

### 3.7 State, feedback and motion

- The only motion is a 150ms colour transition and a spinner. Selection,
  route change, panel open/close, tab change and dialog entry are all instant
  cuts, which is why the app reads as a web form inside a desktop shell.
- The palette (`05-command-palette.png`) has no visible selected row: the
  pointer can be anywhere and the keyboard cursor is invisible until you move it.
- Nothing in the catalog says how many of the twelve are showing because of which
  filter; the count is a bare `12 repos` at the far right of the toolbar.

## 4. Tokens in force

From `src/renderer/styles/globals.css` and
`design-system/alltherepos/MASTER.md`. A redesign should keep these as the
plumbing and change the mapping, not replace the variables ad hoc.

| Role | Value | Notes |
| --- | --- | --- |
| background | `#0b0f14` | dark only; `color-scheme: dark` |
| surface | `#141b24` | rail, cards |
| surface-raised | `#1c2634` | popovers, hover |
| foreground | `#e8edf2` | |
| muted-foreground | `#93a1b1` | most secondary text |
| border / border-strong | `#283444` / `#3a4a5e` | |
| accent | configurable, green in practice | brand + actions + selection |
| status-live | `#4ade80` | separate token, same colour on screen |
| destructive / warning | `#f0616d` / `#f0a83c` | |
| activity ramp | teal → sky → blue → slate → grey | recency bar, language ramp |
| ownership | mine = accent, local = `#a78bfa`, external = `#828e9f` | |
| radius | 4 / 6 / 8 / 12 / 16 px | almost everything uses 8 |
| shadow | `0 1px 2px`, `0 4px 12px -2px`, `0 16px 40px -8px` | rarely used; borders do the work |
| type | label 12px, micro 10px, meta 11px mono, body 13px, headings 20–24px | JetBrains Mono + IBM Plex Sans |

## 5. Constraints a redesign has to respect

These are enforced by tests, not taste, and they are the reason some of the
"generic" choices exist:

- **No raw font sizes anywhere.** `tests/unit/renderer/type-scale.spec.ts` fails
  on a pixel/rem/em size in a component, and `tests/e2e/type-scale.spec.ts`
  reads every route and every view mode in the built app. A new scale has to be
  introduced as tokens/tiers first.
- **Colour comes from tokens.** The palette above lives in `@theme`; painting a
  surface with a hex value is how the scale drifted before.
- **The shell is the product.** Rail + grid + detail panel is one layout, not
  three pages, and the rail collapses while the panel slides. Routes keep their
  hash URLs (`#/graph?cluster=3`), because the app restores the last route.
- **Keyboard first.** `/` focuses search, ⌘K the palette, ⌘Space the spotlight,
  arrows move inside the rail/table/graph listbox, `Enter` opens the selected
  repo. Each of those is asserted in the e2e suite.
- **Accessibility is measured, not intended** (`tests/e2e/accessibility.spec.ts`,
  `nav-card-a11y.spec.ts`): every destination keeps its accessible name at
  800px, every card control is its own tab stop, and both satellite windows are
  audited by the type sweep.
- **Both satellite windows render the same tokens.** The spotlight (720×440) and
  the tray popover (320×420) are separate renderers; a theme change has to reach
  them.

## 6. What is missing from this packet

- No error-with-retry, loading-skeleton or "bridge missing" screens: those states
  have to be forced from the main process, and they are covered by
  `tests/e2e/retry-and-loading.spec.ts` instead.
- No macOS window chrome, menu bar or native dialogs — Playwright captures the
  renderer, not the OS.
- No light theme, because the app has none.
