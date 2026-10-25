# Redesign brief — AllTheRepos

**Status:** direction decided, not yet built.
**Evidence:** [the design-review packet](./README.md) — 51 screenshots of the
shipped renderer, plus the audit in that file.
**Scope:** the whole interface. No new features, no new dependencies, no light
theme.

---

## The product

One window for every git repository on your machine. You point it at the folders
you keep code in; it indexes them and answers the question you actually ask
forty times a day: **which repo was that?**

It is a desktop tool for one person on their own machine. It is not a dashboard,
not a landing page, and not a team product. Nothing here is a marketing surface.

---

## The direction: **Catalogue**

> **The repository name is the product. Everything else is a footnote.**

The app becomes a typographic index of your work, set like an index: names at
reading size, metadata as a small colophon, rules instead of boxes, and colour
used only where it carries meaning. The current design is a card dashboard with
a developer skin — generic covers, generic cards, generic stat tiles, an accent
doing six jobs. Catalogue is the opposite bet: fewer containers, more type, one
hue per meaning, and the whole window used.

### The five commitments

1. **Name first.** A repository's name is the largest, highest-contrast thing in
   its row, and it is never truncated before it has wrapped to two lines.
2. **Rules, not boxes.** Content sits on the canvas and is separated by 1px
   hairlines and space. Bordered cards are reserved for things that are *one
   object you act on* (a dialog, a note editor), and elevation is reserved for
   overlays.
3. **Ink, not brand colour, for interaction.** Selection is an ink block and a
   2px rule. The primary button is light-on-dark, not green-on-dark. Green means
   *running*, and nothing else.
4. **Full-bleed layout.** The rail, index and detail fill the window. Only prose
   gets a measure limit (65–70 characters), never a whole page.
5. **Density is a choice the user makes** — three views at three densities,
   all three built from the same typographic system rather than three different
   card designs.

### What it removes

Green primary buttons · generated cover art (gradients, stripes, grid patterns,
two-letter monograms in a tinted tile) · the four-card stat row · a bordered card
around every block on every page · repeated table headers per group · the 970px
centred column · `UNKNOWN` badges · slug hashes on screen · the full-page sticky
"Open in Visual Studio Code" bar.

### Alternatives considered, and why not

- **Terminal/TUI monochrome.** Authentic to the audience, but it throws away the
  README rendering, the heatmap and the map, and it reads as a novelty.
- **Finder-style chrome with a fixed sidebar and list.** Safer, but it is what a
  generic Mac app already looks like, which is the problem.
- **Bigger, friendlier product design.** Wrong audience: this app is opened to
  find something and closed again, in seconds, hundreds of times a week.

---

## Problems it must fix

Severity is about consequence, not taste. P0 is broken; P1 is why it reads as
generic; P2 is polish.

### P0 — broken on screen today

| # | Problem | Evidence | Rule that fixes it |
|---|---|---|---|
| 1 | Repo names truncate (`Lighthou…`, `weatherb…`) with free space beside them | `screens/02-…`, `screens/17-catalog-1280x800.png` | Name is 15–17px, wraps to two lines, and ellipsises only after that |
| 2 | At 1280 the card's action icons overlap the description, which is cut mid-word | `screens/17-catalog-1280x800.png` | Actions live in a reserved gutter that exists at every width; they never overlay text |
| 3 | Map labels collide into an unreadable smear | `screens/10-graph.png` | Labels only at focus/hover and at cluster level; the opening framing must fit every node |
| 4 | The detail panel's sticky footer covers the README | `screens/20-catalog-1024x768.png` | The primary action moves into the panel header; no sticky footer |
| 5 | The repo page overflows the window at 1024 | `screens/21-repo-page-1024x768.png` | Fluid grid, `min-width: 0` on every pane, no fixed inner width |
| 6 | The heatmap occupies a fifth of the card it sits in | `screens/22-claude-usage.png` | Charts fill their container or the container fits the chart |
| 7 | Two empty badges (`UNKNOWN`, `configured`) side by side | `screens/23-repo-page-claude.png` | Status is a sentence with one honest icon, or it is absent |
| 8 | Slug hashes are shown as repo names in two tables | `screens/09-processes.png`, `screens/22-claude-usage.png` | Always the name; the slug stays a key |

### P1 — why it reads as generic

| # | Problem | Fix |
|---|---|---|
| 9 | One bordered 8px-radius card is used for every surface on every page | The surface ladder under **Space and surfaces** |
| 10 | Green is brand, primary action, selection, focus, live status, sparkline and chart ramp at once | Four semantic jobs, one hue each — **Colour** |
| 11 | Two type vocabularies and no display step; labels are the same size as their values | A six-tier scale with a real display tier — **Type** |
| 12 | Cover art generated from a hash is the loudest thing in the gallery | A flat language spine and the name at display size |
| 13 | Pages sit in a ~970px column at three different left offsets, leaving a third of the window empty | One full-bleed grid; measure limits only on prose |
| 14 | The table repeats a five-column header for every group | One sticky header; group rows are rules with an eyebrow |
| 15 | The command palette has no visible cursor row | Ink selection block, always visible, moved by keyboard |
| 16 | Settings actions escape their own section (`Test Ollama connection` floats below its card) | Actions belong to the block they act on |

### P2 — polish

| # | Problem | Fix |
|---|---|---|
| 17 | Three different treatments for "nothing here" (italic sentence, dashed box, plain text) | One empty state: 12px muted sentence, one optional action |
| 18 | `12 repos` at the far right of the toolbar is the only count, and filtering does not explain it | Count sits beside search as `3 of 12`, with the active filters named below it |
| 19 | Route, panel, tab and dialog transitions are instant cuts | One motion spec — **Motion** |
| 20 | Page titles are inconsistent (sans here, mono there, absent on the repo page) | One page-title role, sans, 18px |

---

## The system

Everything below is a token decision, because the guard rails (see
**Non-negotiables**) fail a build on a raw pixel size or a raw hex value.

### Type

Two faces are bundled: IBM Plex Sans (Regular/Medium/SemiBold/Bold) and JetBrains
Mono (Regular/Medium). Keep both, and give each one job: **Plex sets names,
prose and headings; Mono sets data** — paths, ports, counts, SHAs, shortcuts,
table numerics. Mono is no longer a heading face.

| Token | Size / leading | Face | Job |
|---|---|---|---|
| `--text-display` | 28 / 1.15 | Plex SemiBold | The repo name on its own page, the poster view |
| `--text-title` | 18 / 1.3 | Plex SemiBold | Page titles (Settings, Running, Map, Claude) |
| `--text-name` | 15 / 1.35 | Plex Medium | Repo name in the index and the detail header |
| `--text-body` | 13 / 1.5 | Plex Regular | Descriptions, README body, notes (existing token) |
| `--text-label` | 12 / 1.2 | Plex Medium | Labels, column headers, control captions (existing tier) |
| `--text-meta` | 11 / 1.2 | Mono Regular | Timestamps, paths, ports, counts (existing tier) |
| `--text-micro` | 10 / 1.0 | Mono Medium | Badge numbers and units only (existing tier) |

Rules:

- Uppercase + tracking is for **section eyebrows only** (`LANGUAGES`, `RELATED`,
  `SKILLS`), at 11px in mono. Column headers become 12px sentence case in Plex.
  This is the single change that stops the interface shouting.
- Nothing is smaller than 12px except `.atr-micro` data.
- A name never uses a smaller tier to fit; it wraps, then clamps.

### Colour — four jobs, no fifth

No new hues. Every value below already exists; what changes is which job each one
is allowed to do.

| Job | Token | Value | Used for |
|---|---|---|---|
| Ink | `--color-foreground` | `#e8edf2` | Selection block, primary button fill, active tab rule, focus ring |
| Live | `--color-status-live` | `#4ade80` | A port that is listening, a process that is running |
| Attention | `--color-warning` | `#f0a83c` | Dirty tree, update available, semantic search off |
| Destructive | `--color-destructive` | `#f0616d` | Delete, kill, an error |
| Ownership | `--color-own-local` | `#a78bfa` | Local-only and cloned marks, in data contexts only |

- `--color-accent` (#22c55e) stops being a fill. It may survive as the app icon's
  colour and nowhere in the chrome.
- Selection is `--color-surface-raised` plus a 2px ink rule on the leading edge.
- Focus is a 2px ink rule at 80% with a 2px offset. It is not a brand colour, so
  it cannot be confused with state.
- The language ramp and the activity ramp stay exactly as they are, and stay
  inside data: the language bar, the recency ramp, the heatmap. Never as
  decoration on a card.

### Space and surfaces

- 4px base; 8/12/16/24/32/48 only. Row padding 8×12, block padding 16×20,
  page gutter 24, section gap 32.
- Three surfaces, three jobs:
  - `background` — the canvas every route draws on.
  - `surface` — the rail, sticky headers, the selected row. Never a page card.
  - `surface-raised` + `shadow-overlay` — overlays only: palette, dialogs,
    popovers, spotlight, tray.
- One hairline: `1px solid --color-border`, used to separate, never to enclose.
- Radii differentiate by role: 4px chips and inputs, 6px buttons and the one
  real card (dialog, note editor), 10px overlays. Uniform 8px everywhere is what
  makes the current build read as one material.

### Motion

- 140ms `cubic-bezier(0.2, 0, 0, 1)` for colour, opacity and focus.
- 180ms for the rail collapse and the detail panel's width.
- 120ms for the palette's selection block.
- Nothing animates layout on route change. `prefers-reduced-motion` removes all
  of it.

---

## The screens, re-cut

### Catalog — the index (`/`)

- Each entry: **name** (15–17, Plex Medium, two lines), description (13, one
  line), then a meta line at 11 mono — recency, language, size, port. No avatar
  tile, no cover, no star in the resting state.
- A 2px language spine on the entry's leading edge replaces the language dot.
- Selection: `surface-raised` block, 2px ink rule on the left, and the action
  gutter on the right — always reserved, never overlapping text.
- Group headings: eyebrow (mono 11, tracked) with a count, then a hairline, then
  entries. Orphan groups stop looking broken because entries are rows, not cards
  floating in a grid.
- Toolbar: view switch (three icons + ink underline), Group, Sort on the left;
  the count moves beside search as `3 of 12`; the bulk actions appear only with a
  selection. Fetch and Pull live in an overflow menu — they are not daily.
- **Posters** (the current gallery): name at 28, description at 13 over two
  lines, language spine as a 6px bar. This is the "recognise it by name" view,
  and it is the only place a repo gets a large surface.
- **Table**: one sticky header for the whole table, group rows as hairlines with
  an eyebrow, numbers right-aligned and tabular, name at 13 in Plex (not mono).

### Detail panel (`02-catalog-detail-open.png`)

- Header: name at 22, path at 11 mono under it, then **Open** as the primary
  action and an overflow menu. The full-width green button and the sticky footer
  are gone.
- Metadata becomes a two-column definition list with 11px eyebrows and 13px
  values, separated by hairlines, not a grid of shuffleboard tiles.
- Language bar: full width, 4px, with the legend beneath at 11 mono.
- Tags, Related, Groups: eyebrows + content, one rule between sections. `Related`
  and `Add` become quiet text buttons, not chips.
- README: 13px body on the panel's measure, headings stepping down from 18. It is
  the panel's main reading surface and currently reads as an afterthought.

### Repo page (`/repos/:slug`)

Full-bleed header (name at 28, actions at the right), then a single 68ch column
for README and notes. The page stops being a 970px card floating in the middle of
the window.

### Settings

Two columns at ≥1200: label column (1fr, with a one-line description) and control
column (2fr). Blocks separated by hairlines, not cards. Every action sits inside
its block (`Test Ollama connection` beside the embeddings fields). Autosave is
stated once per block — "Changes save as you type" — rather than as a paragraph.

### Running (`/processes`)

A table that fits: repo name (Plex 13), port as a live chip when listening, the
command at 11 mono, pid at 11 mono right-aligned, age, then copy and kill. Empty
state: one sentence and a hint, no dashed box.

### Claude (`/claude`)

The four figures become one row of numbers separated by rules — label above,
value at 22 mono — with no cards. Heatmap fills its width or the block shrinks to
the chart. Projects table uses names and puts the sparkline in the row only when
the series has a shape.

### Map (`/graph`)

The map is a picture; the list beside it is the navigation. Node labels appear
for the focused node and hovered node only, at 12px, and cluster labels at the
cluster level; the opening zoom is clamped so the framing always fits every node.
Signal filters become a single row of toggles whose counts are hidden when zero.

### Palette, dialogs, spotlight, tray

One overlay grammar: overlay surface, 10px radius, `shadow-overlay`, title at 18
Plex (not mono), description at 13 muted, form labels at 12 uppercase tracked,
footer above a hairline with the primary action in ink.

- Palette: ink selection block, grouped eyebrows, shortcuts right-aligned in mono
  chips. It must look like the keyboard is already in it.
- Spotlight: the input is the interface — 20px, no visible label, results at 13.
- Tray popover: recents at 13, one primary line ("Open Spotlight…"), running
  servers under an eyebrow. It inherits the same tokens, at a tighter scale.

---

## Non-negotiables

These are enforced by tests or by the product's shape. A redesign that breaks one
of them is a regression, not a direction.

1. **The type-scale guard.** No component states a raw font size, in px, rem or
   em (`tests/unit/renderer/type-scale.spec.ts`), and every route and view mode is
   read in the built app (`tests/e2e/type-scale.spec.ts`). New tiers are tokens
   first, and both specs learn them; neither is loosened.
2. **Colour comes from tokens.** The four jobs above are `@theme` variables.
3. **The shell is the product.** Rail + index + detail is one layout. The rail
   collapses, the panel slides, and it stays one window.
4. **Routes and their state survive a reload.** Hash URLs, `#/graph?cluster=3`,
   and the window reopening where it was left.
5. **The keyboard contract.** `/` search, ⌘K palette, ⌘Space spotlight, arrows in
   the rail, table and graph list, Enter to open, Escape to leave an overlay.
6. **Measured accessibility.** Every destination keeps its name at 800px, every
   card control is its own tab stop, and all body text clears 4.5:1 (the current
   muted grey already clears 7:1, so hierarchy is the work, not contrast).
7. **Both satellites are themed by the same tokens.** Spotlight and tray are
   separate renderers, and the type sweep audits them.
8. **Two fonts, six bundled weights, no new dependency.** Lucide stays, at 16px
   in rows and 14px inline, stroke 1.5, one weight.
9. **Dark only.** `color-scheme: dark` is the current truth and stays.

## Out of scope

New features, new navigation destinations, changes to scanning/indexing, the
preload bridge, packaging, a light theme, an icon-set replacement, and any motion
that is not listed above.

---

## Order of work

Each step leaves the app shippable.

1. **Tokens and scale.** Add the new tiers, re-map the four colour jobs, and land
   the surface ladder. Almost no visual change yet; both guards learn the tiers.
2. **Primitives.** Button (ink primary), input, select, chip, tab, dialog,
   palette row, empty state, eyebrow.
3. **Catalog.** Index, posters, table, toolbar; then the detail panel.
4. **Repo page and notes.**
5. **Secondary routes.** Settings, Running, Claude, Debug.
6. **Map labels and framing.**
7. **Satellites.** Spotlight and tray.
8. **Re-capture the packet** and put every P0 row side by side with its fix.

## How we will know it worked

- No repo name is truncated at 1024, 1280 or 1440 — asserted, not eyeballed.
- The 1280 card case (actions over text) is a test, and it fails on today's
  build.
- The palette always has a visible selection, including on open.
- No page has a dead column wider than 240px at 1440 except a prose measure.
- Only four hues carry meaning anywhere in the chrome.
- The type sweep passes with the new tiers, and the packet's P0 list is empty.

## Two decisions worth confirming before step 1

- **Posters mode.** If it is not worth its own density, cut the catalog to two
  views and give the space back to the index. Recommended: keep it, because
  recognising a repo by name at 28px is the app's actual job.
- **Green.** Retiring it from the chrome leaves it in the app icon and the live
  dot. If that reads as too little identity, the fallback is to keep green for
  *live only* and let the wordmark stay white — not to reintroduce a green
  button.
