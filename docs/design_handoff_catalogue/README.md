# Handoff: AllTheRepos — "Catalogue" redesign

## Overview
This handoff re-skins the whole AllTheRepos Electron renderer, following `BRIEF.md` (included here).

The redesign turns a card dashboard into a typographic index:
- names at reading size
- metadata as a small mono colophon
- hairline rules instead of boxed cards
- colour used only for meaning (live, attention, destructive, ownership)
- ink (`#e8edf2`) used for every interaction state

There are **no new features, no new dependencies and no light theme**.

## Corrections in this revision
Four rules contradicted themselves in the first draft. They are fixed here, and the prototype now matches the spec rather than the spec describing something else:

1. **Uppercase is spent, not defined.** "Eyebrows only" had been read to include group headings, definition-list labels, form labels and map cluster names, which put 25 tracked strings on the default screen. Now only the nine section eyebrows are uppercase; group names and field labels are sentence case at 12 Plex, and the map's cluster names match the index group heading instead of shouting over it.
2. **The focus ring is back on inputs.** The draft set a 2px ink `:focus-visible` ring and then removed it from every input. Inputs now keep it — a bordered field draws the ring just outside its border, and a composite field (the search box, the palette's input row) rings its container, since the input inside it is borderless.
3. **Metadata is delimited.** The meta line was three to six spans separated by a 10px gap, so `yesterday Go 5.2 MB 3 uncommitted` read as one string. Every item now follows a `·` in `#3a4a5e`, and a conditional item carries its separator with it.
4. **Secondary routes use the display tier.** Every page title was 18, level with the block headings beneath it, which measured as a 1.20:1 hierarchy on six of the eight screens. Page titles are 28 at 1.15 / -0.015em; the display tier is now the thing that makes a route open like a place.

## About the design files
`Catalogue.dc.html` is a **design reference built in HTML**. It is a working prototype of the intended look and behaviour, not production code.

Recreate it inside the existing renderer:
- React + Tailwind v4 `@theme` tokens, in `src/renderer/styles/globals.css`
- the existing primitives and Lucide icons

The prototype uses inline styles and literal hex values for speed. In the app, **every value must become a token**. Two guards enforce this:
- `tests/unit/renderer/type-scale.spec.ts` fails on a raw font size
- the colour-from-tokens rule fails on a raw hex

To view the prototype, open `Catalogue.dc.html` in a browser; `support.js` must sit beside it. The Tweaks panel props are `route`, `defaultView`, `openDetail` and `paletteOpen`.

## Fidelity
**High-fidelity.** Colours, type, spacing, radii and states are final. Copy is final where it's UI chrome; repo data is the synthetic demo library.

## Design tokens

### Colour — four jobs (plus ownership), no fifth
| Token | Hex | Job |
|---|---|---|
| `--color-background` | `#0b0f14` | canvas for every route |
| `--color-surface` | `#141b24` | rail, sticky table header, hovered table row |
| `--color-surface-raised` | `#1c2634` | selected row/entry, rail hover, overlays, tooltips |
| `--color-foreground` (Ink) | `#e8edf2` | text; **selection rule, primary button fill, active tab/nav underline, focus ring, palette cursor** |
| `--color-muted-foreground` | `#93a1b1` | secondary text, eyebrows, column headers |
| rail item text (new, optional) | `#c3ccd6` | unselected rail/list rows |
| `--color-border` | `#283444` | the one hairline |
| `--color-border-strong` | `#3a4a5e` | overlay border, input/kbd chip border on raised |
| in-table row divider | `#1c2634` | between rows inside a table (lighter than the group rule) |
| `--color-status-live` | `#4ade80` | listening port, running process, nav badge — **nothing else** |
| `--color-warning` | `#f0a83c` | dirty tree, Uncommitted count, semantic search off |
| `--color-destructive` | `#f0616d` | Remove/Stop hover text; Stop hover bg `rgba(240,97,109,.12)` |
| `--color-own-local` | `#a78bfa` | "local only", "cloned", non-own remote — data contexts only |
| `--color-accent` | `#22c55e` | **app icon / 8×8 wordmark mark only.** Never a fill in chrome. |
| scrim | `rgba(5,8,11,.6)` | behind palette and dialogs |
| port chip border | `rgba(74,222,128,.35)` | |

The language ramp is used only in data (spines, language bar, map nodes):
- TypeScript `#38bdf8`
- Go `#2dd4bf`
- Python `#60a5fa`
- Rust `#94a3b8`
- C++ `#7c8aa0`
- HCL `#64748b`
- Jupyter `#828e9f`
- CSS `#3b82f6`
- Shell `#5b6b7f`
- GLSL `#475569`
- Astro `#6b7b8f`

In the app, keep the existing ramp tokens rather than these literals.

The heatmap ramp, low to high: `#1c2634`, `#334155`, `#3b82f6`, `#38bdf8`, `#2dd4bf`.

### Type
Two faces: IBM Plex Sans (400/500/600/700) and JetBrains Mono (400/500).
- **Plex** sets names, prose and headings.
- **Mono** sets data and eyebrows.

| Tier (new tiers marked ★) | Size / line-height | Face | Used for |
|---|---|---|---|
| `--text-display` ★ | 28 / 1.15, -0.015em | Plex 600 | Poster name; repo page name; page title on every secondary route |
| (detail) ★ name-lg | 22 / 1.2, -0.01em | Plex 600 | Detail panel header name |
| — numeric | 22 / 1.1 | Mono 400 tabular | Claude stat values |
| `--text-title` ★ | 18 / 1.3 | Plex 600 | Page titles, dialog titles, README h2 |
| `--text-name` ★ | 15 / 1.35 | Plex 500 | Index entry name; settings block heading (600); palette input; README h3 (600) |
| `--text-body` | 13 / 1.5 (README 1.6) | Plex 400 | Descriptions, prose, inputs, table names (500) |
| `--text-label` | 12 / 1.2 | Plex 500 | Tabs, nav, toolbar, column headers (sentence case), quiet text buttons, empty states (400) |
| `--text-meta` | 11 / 1.2 | Mono 400 | Paths, timestamps, ports, counts, sizes, pids, legends |
| eyebrow | 11 / 1.2, 0.08em, UPPERCASE | Mono 400 muted | Section eyebrows only (`LANGUAGES`, `DESIGN`, `PROJECTS`) |
| `--text-micro` | 10 / 1 | Mono 500 | Kbd chips (`/`, `esc`, `⌘K`), nav badge numbers, heatmap day labels |

Rules:
- Nothing is smaller than 12px except mono data.
- Names wrap to two lines and only then clamp (`-webkit-line-clamp: 2`, `overflow-wrap: anywhere`). A name never shrinks to fit.
- Uppercase tracking is for the nine section eyebrows only — the rail's section titles, `LANGUAGES` / `TAGS` / `RELATED` / `GROUPS` / `README`, Claude's `ACTIVITY` and `PROJECTS`, and the palette's group titles. A group name, a definition-list label, a form label or a map cluster name is never uppercase: they are 12 Plex 600 and 12 Plex 500 in sentence case, and tracking is what separates an eyebrow from a heading.

### Space, radii, shadow, motion
- **Spacing:** 4px base, using 8/12/16/24/32/48.
  - page gutter 24
  - group spacing 28–32
  - entry padding 12/8/14/16
  - block padding 20 (detail) and 24 (settings rows)
- **Radii:**
  - 4 for chips, inputs, segmented controls and kbd
  - 6 for buttons, icon buttons, palette rows and `<pre>`
  - 10 for overlays
  - 2 for heat cells and swatches
- **Overlay shadow:** `0 16px 40px -8px rgba(0,0,0,.6)`, plus a 1px `#3a4a5e` border. Nothing else casts a shadow.
- **Focus:** a 2px solid outline at `rgba(232,237,242,.8)` with `outline-offset: 2px`, via `:focus-visible`.
  - Inputs keep it. A bordered field draws the ring 1px inside its own border; a composite field (the search box, the palette's input row) rings its container on `:focus-within`. No input may set `outline: none` — the field, not the text box, is what a keyboard user is looking at.
- **Motion:**
  - `140ms cubic-bezier(0.2,0,0,1)` for colour, background and box-shadow
  - `180ms` with the same curve for `grid-template-columns` (detail open/close)
  - `120ms` for the palette cursor background
  - Nothing animates on route change.
  - `prefers-reduced-motion` turns all of it off.

## Shell layout (all routes)
- The root is a CSS grid: 48px top bar, then the body (`minmax(0,1fr)`), with `height: 100vh` and a minimum height of 600.
- **Top bar** (a three-column grid, `232px | 1fr | auto`, with a 1px bottom hairline):
  - **Wordmark cell:**
    - 232px wide, on the surface colour, with a right hairline
    - 8×8 radius-2 accent square, then "AllTheRepos" in Plex 600 13
  - **Search:**
    - field: max 560px, 32px tall, 4px radius, border colour, canvas background
    - 14px search icon, 13px input, `/` kbd chip on the right
    - beside it, the **count** `N of 12` in 11 mono, muted when unfiltered and ink when filtered
  - **Nav** (right side):
    - Repos · Running · Map · Claude · Settings, at 12 Plex 500, 20px gap
    - The active item is ink with a 2px ink bottom rule (`inset 0 -2px 0`). Inactive items are muted, turning ink on hover.
    - Running carries a live dot + count (10 mono, green) when processes exist.
- **Body** grid: `232px minmax(280px,1fr) minmax(320px,440px)` with the detail panel open; `232px minmax(0,1fr)` when closed.
- **Rail** (surface background, right hairline):
  - **Section titles:**
    - eyebrow style: VIEWS · FOLDERS
    - Groups is omitted when there are none
  - **Rows:**
    - 30px tall, 13 Plex
    - count in 11 mono on the right
    - the Uncommitted count is amber when non-zero
  - **Selected row:**
    - raised background, ink text
    - `inset 2px 0 0 #e8edf2` rule on the left edge
  - **Folder children:** indented 32px
  - **Footer:** "+ Add folder to scan" and "+ New group" as 12px muted text buttons
  - Clicking any rail row returns to Repos.

## Screens

### 1. Repos — toolbar
- Sits in the index pane: 24px padding, bottom hairline, `flex-wrap: wrap` with a minimum height of 44.
- **View tabs:** Index · Posters · Table, at 12 Plex 500. The active tab is ink with a 2px ink underline.
- Then a 1px vertical rule.
- Then `Group Folder ⌄` and `Sort Last touched ⌄`: the label is muted, the value ink, 12 Plex 500.
- On the far right, a 28px ⋯ overflow holding Fetch all, Pull all, Tag cleanup and Save filter. These buttons are removed from the bar.
- **Filtered state:** a second line reads `Showing 3 of 12 · Local only · matching "vox"` (12 muted), followed by an underlined ink **Clear** button.
- **Nothing matches:** a single 12px muted sentence plus a "Clear search" button.

### 2. Repos — Index (default)
- **Group heading:**
  - the group name at 12 Plex 600 muted, sentence case, with its count at 11 mono
  - not an eyebrow: tracking is reserved for the rail and the panel's section labels
  - 28px padding above, 8px below
- **Entries:**
  - one full-width row per repo, in a plain list — see *Landed in the app* below for why the prototype's `repeat(auto-fill, minmax(min(280px,100%), 1fr))` was dropped
  - each entry has a 1px top hairline; the first entry of a group does not, because the group heading's hairline already opens it
- **Entry layout:** a two-column grid, `minmax(0,1fr) 128px`, with gap 12 and padding 12/8/14/16.
- **Language spine:** absolutely positioned at left 0, top 12, bottom 14, 2px wide, in the language colour. It becomes **ink when selected**.
- **Content column:** name (15 Plex 500, two-line clamp), description (13 muted, one line with ellipsis), then the meta line.
- **Meta line** (11 mono muted, wrapping, gap 4):
  - every item is separated by a `·` in `#3a4a5e`; a conditional item (port, uncommitted, ownership) carries its own separator, so the line never leaves a double gap or a trailing dot when an item is absent
  - recency · language · size
  - port, as a green 6px dot + `:8080`
  - `3 uncommitted` in amber
  - `local only` / `cloned` in violet
- **Selected:** raised background and an ink spine. The **gutter** (128px, always reserved) holds two bands — select + pin on top, the five launchers beneath at 24px each. Both are hidden at rest and still take their space, so **actions never overlay text**.
- There is no avatar, cover, checkbox or star in the resting state.

### 3. Repos — Posters
- **Layout:** a wrapping flex row. Each poster is `1 1 340px` with `min-width: min(340px,100%)`, so a full line keeps the handoff's 340 tracks and the line that is short of a full row shares the width left over. A group of one and the trailing poster of an odd group both take the whole row, at 1440 and at 1024.
- **Entry:** padding 20/20/28 with a top hairline. It contains, in order:
  - a 48×6 language bar
  - the name at 28/1.15 Plex 600, clamped to two lines
  - the description at 13 muted, max 52ch, clamped to two lines, minimum height 39
  - the meta line
- **Selected:** raised background and an ink bar.

### 4. Repos — Table
- **Header:** one sticky header for the whole table, on the surface background, 36px tall, with a bottom hairline.
  - Columns: `minmax(160px,1.3fr) minmax(0,2fr) 110px 110px 72px`, gap 16, padding 0 24.
  - Headers: Name · Description · Language · Last touched · Size (right-aligned). They are 12 Plex 500 muted, in sentence case.
- **Group rows:** a group name at 12 Plex 600 muted plus count at 11 mono, padded 20 above and 8 below, with a hairline under it. No repeated column headers.
- **Rows:**
  - minimum height 36, padding 6/24, with a `#1c2634` divider
  - name 13 Plex 500, plus a live dot when listening
  - description 13 muted, with ellipsis
  - language as a 2×12 spine + 11 mono
  - date and size in 11 mono, tabular, with size right-aligned
- **Selected:** raised background and a 2px ink rule on the left edge.
- The table has a minimum width of 720 and scrolls horizontally below that.

### 5. Detail panel (right column, Repos only)
- Left hairline; it scrolls independently. Every section is `flex:none`.
- **Header** (padding 20/20/16, bottom hairline):
  - name at 22 Plex 600, plus a 28px close (×) button
  - path in 11 mono muted, e.g. `~/Code/design/lighthouse-ui`
  - description in 13 muted
  - action row:
    - **Open** — primary ink button: 32px, `#e8edf2` fill, `#0b0f14` text, 6px radius, 13 Plex 500, `↵` hint at 60% opacity, white on hover
    - **Terminal** — secondary button: 1px border, raised on hover
    - spacer, then a 32px ⋯
  - The full-width green button and the sticky footer are removed.
- **Tabs:** Details · Notes · Claude, in a 40px bar with an ink underline on the active tab.
- **Definition list:**
  - two columns, padding 0 20; each cell is padded 12 with a bottom hairline
  - each label is 12 Plex 500 muted in sentence case (`<dt>`), each value 13 Plex (`<dd>`)
  - Fields: Branch, Last commit, Status, Remote, Size, Port.
    - Status reads "Clean", or "N files uncommitted" in amber.
    - Remote is violet when local/cloned; local reads "None — local only".
    - Port reads ":8080 listening" in green, or "Not running" muted.
- **Languages:**
  - a 4px full-width bar of segments in flex proportion, with 2px gaps
  - legend: 2×10 swatch + name (ink) + pct, in 11 mono
- **Tags:** the eyebrow, with "Add" as a quiet 12 text button on the right, then 11 mono chips (4px radius, 1px border, padding 5/7).
- **Related:** the eyebrow plus "Link a repo". Rows show the name (13 Plex 500) with the reason on the right in 11 mono muted; clicking a row selects that repo. Empty state: "No linked repositories." (12 muted).
- **Groups:** the eyebrow plus "Add to group" (opens the New group dialog). Empty state: "Not in a group."
- **README:**
  - layout: `<article>`, padding 24/20/48, max 68ch
  - headings: the README eyebrow, then h2 at 18/600, then h3 at 15/600
  - body: 13/1.6
  - code: `<pre>` with a 1px border, 6px radius, 11 mono

### 6. Running (`/processes`)
- **Page header** (used on every secondary route):
  - minimum height 56, padding 12/24, bottom hairline
  - h1 at 28 display (1.15, -0.015em) Plex 600, followed by meta (`3 listening`, 11 mono) — the display tier is what makes a route open like a place rather than a panel; 18 here left the title level with the block headings beneath it
- **Table:**
  - columns: `minmax(140px,1.2fr) 88px minmax(0,2fr) 64px 72px 132px`
  - headers: Repository · Port · Command · PID (right) · Age · (actions)
- **Rows:**
  - **name** as a 13 Plex 500 button that opens the repo in Repos. The slug hash is never shown.
  - **port chip:** green 11 mono, 1px green-35% border, 4px radius, with a dot
  - **command** in 11 mono muted with ellipsis
  - **pid** tabular and right-aligned
  - **age**
  - **actions:** Copy URL and Stop (Stop turns destructive on hover)
  - row hover: surface background
- **Empty state:** "Nothing is listening. Start a dev server in any indexed repo and it appears here." (12 muted). No dashed box.

### 7. Map (`/graph`)
- **Layout:** a grid of `minmax(0,1fr) minmax(240px,300px)`. The header row holds the title plus the signal toggles.
- **Signal toggles:**
  - 28px tall, 4px radius, nowrap
  - On: `#93a1b1` border, ink text. Off: `#283444` border, muted text.
  - The count shows only when it is greater than 0.
  - Signals: Same owner, Co-edited, Shared deps, Curated links, Same folder, Imports.
- **Canvas** (margins 32/48 so the framing fits every node):
  - **Edges:** 1px `#283444` lines; edges touching the lit node become 1.5px `#93a1b1`.
  - **Nodes:** 9px circles, 12px when focused, with a focus ring of `0 0 0 3px bg, 0 0 0 5px ink`.
    - Lit node and neighbours: language colour. Everything else: `#3a4a5e`.
  - **Node labels:** shown only for the focused or hovered node, as a 12 Plex 500 pill on raised background, 4px radius, below the node.
  - **Cluster labels:** 11 mono muted in sentence case, centred above each cluster — the same name as the index group heading, so it must not be uppercase here and sentence case there.
- **Cluster list** (right, `role=listbox`, left hairline):
  - each cluster is a name at 12 Plex 600 muted plus count at 11 mono, followed by 30px member rows
  - each row: a 2×12 language spine + 13 Plex
  - selected row: raised background + 2px ink left rule
  - hovering a row highlights its node on the canvas
- **Opening zoom:** clamp it to fit all nodes. Never show every label at once.

### 8. Claude (`/claude`)
- **Header:** the title, with a range segmented control on the right: 7d · 30d · 90d · All, at 12 mono. The active segment is filled ink with dark text.
- **Stats row:** `repeat(auto-fit,minmax(160px,1fr))`.
  - Each cell is padded 20/24 with a right hairline, a 12 Plex 500 muted label, and the value at 22 mono tabular.
  - Stats: Sessions, Tokens, Projects, Active days. No cards.
- **Heatmap:**
  - header: "ACTIVITY · LAST 12 WEEKS" eyebrow, with a less→more legend on the right
  - grid: `28px repeat(12, minmax(0,1fr))`, seven 14px rows, gap 3, cells at 2px radius, flowing by column
  - day labels Mon/Wed/Fri at 10 mono
  - **It fills the full width.**
- **Projects table:**
  - columns: `minmax(140px,1.4fr) 80px 96px 120px minmax(80px,1fr)`
  - headers: Repository · Sessions · Tokens · Last active · Trend
  - **Trend:** 4px bars, maximum height 18, in `#38bdf8`. It renders only when at least 4 of the 12 points are non-zero; otherwise the cell is empty.

### 9. Settings
- **Block layout:**
  - each block is a wrapping flex row (gap 16/48), padded 24, with a bottom hairline
  - **Label column:** `flex 1 1 240px`, max 420. Heading at 15 Plex 600, then a 13 muted description.
  - **Control column:** `flex 2 1 420px`, with 12px gaps.
- **Blocks, in order:**
  1. **Scan paths:**
     - a path row in 13 mono, `12 repos · 4 min ago` in 11 mono, and Remove
     - below it, an "Add a folder, e.g. ~/Work" input with an **Add folder** button
  2. **Embeddings:**
     - segmented control: Ollama · OpenAI · Off
     - fields: Host, Model (11 mono values)
     - **Test connection** sits *inside the block*, beside an amber status line: "Ollama isn't answering at this host. Semantic search is off."
     - "Changes save as you type."
  3. **Editor and terminal:** two selects (Editor, Terminal), plus the autosave line.
  4. **Updates:** Stable · Beta segmented control, **Check for updates**, and "checked today, 09:12".
  5. **Identities:** a hairline list (name · email/host · Remove), plus "+ Add identity".
  6. **Scan now:** a primary ink **Scan now** button, plus `last: 4 min ago · 12 repos · 1.8 s`.
- **Controls:**
  - **Inputs:** 32px tall, 4px radius, 1px border, canvas background, 13px text. Field labels are 12 Plex 500 muted, sentence case.
  - **Segmented control:** 4px radius, 1px border, 2px padding. Each segment is 26px tall; the active one is filled ink.

### 10. Command palette (⌘K)
- **Scrim and container:**
  - full-window scrim; the palette sits at 12vh from the top
  - `width: min(600px, 100vw - 48px)`
  - raised background, 1px `#3a4a5e` border, 10px radius, overlay shadow
- **Input row:**
  - 48px tall, bottom hairline
  - 16px search icon, 15px input ("Type a repo or a command"), `esc` kbd chip
- **Groups** (eyebrows): Repositories (4, or 6 when there's a query), Go to (Repos ⌘1, Running ⌘2, Map ⌘3, Claude ⌘4, Settings ⌘,), Actions (Open selected in editor ↵, New group, Tag cleanup, Fetch all repositories, Scan now).
- **Rows:**
  - 36px tall, 6px radius, padding 0 10
  - label 13 Plex 500; sub-label (folder) 11 mono; kbd chip on the right
- **Cursor:**
  - the active row is an **ink block** (`#e8edf2` background, `#0b0f14` text; sub-label `#283444`; kbd border `#93a1b1`)
  - it is **always visible, starting at index 0 on open**
  - mouse-move moves it; transition 120ms
- **Footer:** hairline above; `↑↓ move  ↵ open  esc close` in 11 mono.
- **Empty state:** `Nothing matches "…".`

### 11. Dialog — New group (the overlay grammar for all dialogs)
- **Container:** a centred `min(440px,100%)` box with the same surface, border, radius and shadow as the palette.
- **Header:** padding 20/20/0; title at 18 Plex 600 (not mono); description at 13 muted.
- **Body:** padding 20, 16px gap.
  - Form labels are 12 Plex 500 muted in sentence case, with no tracking.
  - The input sits on the surface colour.
  - Fields: Name ("e.g. Client work"), and Start with (the selected repo).
- **Footer:** a hairline above, padding 12/20, right-aligned: **Cancel** (secondary), **Create group** (ink primary).
- Esc closes the dialog, and so does a scrim click.
- Apply the same grammar to Curate link and Tag cleanup.

## Landed in the app (2026-10-26)

Where the built app departs from the prototype, and why. These are decisions, not drift:

- **The index is one column.** The prototype's `auto-fill` grid left a hole for every group whose count was not a multiple of the column count — a group of one left two empty columns at 1440 — and truncated every description at roughly thirty characters. A list gives the width to the description and makes the sections read as sections.
- **The gutter is 128px, not 64px.** Five 24px launchers need one line, and keeping them in the card's absolutely-positioned cluster put them on top of the description and the meta line of every hovered row — the overlap the gutter exists to prevent. The launcher band appears on hover and focus only; a selected row shows select + pin, not seven buttons.
- **The toolbar is the specified single row.** Tabs are text with a 2px ink underline on the active one, a hairline closes them, and Group/Sort are inline selects whose value is the ink. The tabs are **Index · Posters · Table**; the persisted store keys are still `grid` and `gallery`, so an existing saved view survives the rename.
- **Posters has no cover art.** It is the index's language spine promoted to a 48×6 bar, the name at 28/1.15, two lines at 52ch and the same meta line. The old card's select, pin and launchers live in the 28px below the meta line, revealed on hover or focus; at rest they are invisible and still take their space, so nothing overlays the name. Posters wraps as a flex row rather than an `auto-fill` grid: every poster keeps the 340px minimum, and the one that lands alone on the last line takes the rest of it, so neither a single-poster group nor an odd trailing poster leaves a dead column — the same hole the index's one-column rule removes.
- **The table is one table.** A single sticky header sits over the surface and every group is a row inside the same body, rather than a header repeated above each folder. Its row controls (the pin) are hidden at rest in the name cell; the selected row is the raised background and 2px ink rule specified in §4.
- **Not yet landed:** the toolbar's `⋯` overflow. Fetch, Pull, Tag cleanup and Save filter are still buttons in the bar, which is why the bar wraps to two rows at 1280 with the detail panel open.

## Interactions and keyboard
| Input | Behaviour |
|---|---|
| `/` | Focus search (when not typing) |
| ⌘K / Ctrl+K | Open the palette with an empty query and the cursor at 0 |
| ↑ / ↓ | Palette: move the cursor. Elsewhere: move the selection through the filtered, folder-ordered list. |
| Enter | Palette: run the active row |
| Esc | Close the dialog, then the palette; blur the input; otherwise clear the selection (closing the detail panel) |
| Click entry | Toggle selection; the detail panel slides in over 180ms |
| Click rail row | Set the filter and return to Repos |
| Search | Filters on name, description, language, folder and tags |
| Nav / palette Go to | Switches route. In the app these are hash routes (`#/processes`, `#/graph?cluster=3`, …) restored on reload. |
| Running → Stop | Removes the row; the empty state appears when none remain |
| Map: hover/click node or list row | Hover lights the node and its neighbours and shows the label; click sets focus |

## State (prototype → app)
- **Route.** Use the existing hash router.
- **view:** `index | posters | table`
- **Selection:**
  - `sel`: the selected slug, or null
  - `rail`: `all | fav | mine | local | cloned | dirty | root | folder:<name>`
- **Filtering:** `query`
- **Detail panel:** `tab`
- **Palette:** `palette` (open), `pq` (query), `pi` (cursor index)
- **Dialog:** `dialog` (open)
- **Running:** `procs`
- **Claude:** `range`
- **Map:** `sig` (signal toggles), `focus`, `hover`

All data should come from the existing preload bridge. The arrays in the prototype (`REPOS`, `PROCS`, `PROJECTS`, `CLUSTERS`, `EDGES`) are stand-ins for the demo library.

## Not yet designed — extrapolate from the system
- **Spotlight (720×440):** a 20px input with no label; results at 13, with the ink cursor block.
- **Tray popover (320×420):** recents at 13; one primary line, "Open Spotlight…"; running servers under an eyebrow.
- **Debug route:** use the standard page header.
- **Curate link and Tag cleanup dialogs:** use the dialog grammar above.
- **Detail panel tabs:** the Notes and Claude tabs have no content yet. Notes is an editor and preview side by side; the editor is the one bordered card, with a 6px radius.
- **Repo page:** a full-bleed header (name at 28, actions on the right), then a single 68ch column.

## Acceptance (from BRIEF.md)
- No repo name is truncated at 1024, 1280 or 1440.
- Actions never overlap text at 1280 (the reserved gutter).
- The palette always shows a cursor.
- No dead column wider than 240px at 1440, except the prose measure.
- Only the four semantic hues appear in the chrome.
- The type sweep passes with the new tiers.

## Assets
- Fonts: IBM Plex Sans and JetBrains Mono, already bundled in the app; the prototype loads them from Google Fonts.
- Icons: the prototype's inline SVGs (search, external-link, more-horizontal, x, chevron-down) map to Lucide `Search`, `ExternalLink`, `MoreHorizontal`, `X` and `ChevronDown`. Use 16px in rows and 14px inline, stroke 1.5.
- No images.

## Files
- `Catalogue.dc.html` — the prototype, covering every route above plus the palette and dialog. Its logic class is at the bottom of the file.
- `support.js` — the runtime that the prototype needs in order to open.
- `BRIEF.md` — the original redesign brief: rationale, the P0–P2 problem list, non-negotiables and order of work.
- `screenshots/` — reference captures of the prototype, about 914px wide. That is narrower than the 1440 target, so these also show how the layout reflows; open the HTML to see it at full width.
  - `app-index-1440.png`, `app-posters-1440.png`, `app-table-1440.png`, `app-index-1280-detail.png`, `app-index-1024-detail.png` — the built app at 1440 × 900 (and the two narrow states), captured through `scripts/make-design-shots.mjs`: the one-column index, its headings and meta line, the single-row toolbar, and the three densities.
  - `after-index.png`, `after-table.png`, `after-map.png`, `after-running.png`, `after-settings.png`, `after-dialog.png` — 1440 × 900 captures of exactly what this revision changed: group headings, metadata separators, panel labels and a focused search field; the table's group rows; sentence-case cluster names; the display-tier page titles; and the dialog's form labels. Taken with Playwright at `viewport 1440×900, deviceScaleFactor 1`, so they are not the 914 captures above.
  - `01-repos-index.png` · `02-repos-posters.png` · `03-repos-table.png` (detail panel open)
  - `04-command-palette.png` · `05-running.png` · `06-map.png` · `07-claude.png` · `08-settings.png` · `09-dialog-new-group.png`
