# 2026-10-07 — UI/UX review: `/graph` after the button rework, plus a sweep of the other six routes

Point-in-time record. Two halves, deliberately different in depth: the graph page gets a
line-by-line re-read of the two files the rework touched, checking each finding from the plan
against the code that now exists; the other six routes get a sweep that files what it finds
rather than fixing it.

Method is the `ui-ux-pro-max` priority order — anti-AI genericness, accessibility, touch,
performance, style, layout, typography/colour, motion, forms, navigation, data display — applied
to the current source. Severity is the skill's own scale: CRITICAL for accessibility and touch,
HIGH for style, layout and navigation, MEDIUM for typography, motion and forms, LOW for charts
and polish.

Nothing in this pass changed a route. It is the review and its artifacts only.

## How the graph half was verified

The app was built and driven through Playwright against an isolated profile, so the claims below
about rendered state are measurements, not readings. The graph built real data in that run —
**135 repos, 162 links** — because a fresh profile inherits the developer's legacy
`~/.alltherepos/` catalog. Where a claim could only be read from source, it says so.

## Plan findings A1–A6, re-checked against the code as it stands

| # | Finding from the plan | State | Evidence |
| --- | --- | --- | --- |
| A1 | The graph page built its buttons from bare class strings in three different styles, with no grouped control | **Resolved** | `graph.tsx:198,213,280,295` and `graph-canvas.tsx:762,772,782,792` all render the shared `Button` primitive; the filter strip is one `role="group"` at `graph.tsx:231` over a `bg-muted p-0.5` container. Measured: container `background rgb(26,34,45)`, `padding 2px`, `border-radius 6px`, six toggles at `background rgb(35,46,59)`. |
| A2 | The icon-only refresh control had no accessible name | **Resolved** | `graph.tsx:217-218` carries `aria-label="Recompute the graph"` and a matching `title`. Measured: `getByRole("button", { name: "Recompute the graph" })` resolves to exactly one element. |
| A3 | The canvas is pointer-only: no keyboard path, no screen-reader summary | **Partly resolved** | The summary landed: `graph-canvas.tsx:745-746` sets `role="img"` and a counted `aria-label` (measured as `Relationship map of 135 repositories linked by 162 links.`). **Residue: individual nodes are still unreachable by keyboard.** Cytoscape paints into untitled `<canvas>` elements, so there is no focusable node, no roving tabindex and no keyboard equivalent of the tap. The inspector list is a keyboard path to *the selected node's* links only — it cannot select a node. |
| A4 | The error state printed a raw string with no retry; filters that drew nothing showed a blank canvas | **Resolved** | `graph.tsx:274-289` renders the message plus a `Try again` button calling `graph.refetch()`; `graph.tsx:291-303` renders "No links carry the signals you have switched on." plus `Switch every signal back on`. Measured: switching all six signals off produced the empty state and the reset restored all six. |
| A5 | `.atr-segment` is 28px tall and was used icon-only without labels | **Partly resolved** | Every icon-only control on the page now has a name (measured: `Zoom out`, `Zoom in`, `Fit the map to the window`, and a named re-arrange control, all inside the `Graph view` group). **Residue: `.atr-segment` is still `h-7`** — measured `height 28` on all six toggles — and the class is shared with the catalog toolbar, so it is not the graph's alone to change. |
| A6 | Legend glyphs were not tied to their swatches, and status read by colour alone | **Resolved** | `graph-canvas.tsx:801-832`: the warning mark is drawn as an actual ring (`h-2.5 w-2.5 rounded-full border-2 border-warning`, `:819`) rather than the letter `O`, the arrow and star are their own swatches, and the wording stays `text-muted-foreground` so the shape carries the meaning. Measured: three legend keys render. |

### The deliberate omission from Part B

The plan's Part B item 7 asked for an accent cue on `.atr-segment[data-active]` in
`globals.css`. **Not done, on purpose.** That class is shared with `catalog-toolbar.tsx`, so
editing it is a cross-route visual change, and the step that implemented Part B forbade touching
other routes. The finding itself stands: measured, an active toggle is
`rgb(35,46,59)` against a `rgb(26,34,45)` container — a real but small step, roughly 5% luminance.
It is legible on a good display and marginal on a poor one. Filed as ATR-068.

## New findings on the graph code

### G1 (MEDIUM) — the map page has no `h1`, and its sections start at `h2`

`graph.tsx:319` and `graph.tsx:380` are the page's only headings, both `<h2>`, and the page title
"Relationships" is a plain `<span>` at `graph.tsx:192`. The heading hierarchy therefore begins at
level 2 on a page with no level-1 heading, and a screen-reader user gets "strongest links" and
"scattered clusters" with nothing above them to say what page they are on.

The same shape exists on the catalog, one level down: `repo-grid.tsx:153` opens with an `<h2>`
and `repo-card.tsx:173` uses `<h3>` for each card, with no `h1` on the route.

Suggested change: make the "Relationships" caption an `<h1>` (it is the page's name), or add a
visually-hidden `<h1>` and leave the mono caption as decoration.

### G2 (HIGH, measured) — the graph page hard-codes a viewport height inside a padded shell

`graph.tsx:178` sizes the page `h-[calc(100dvh-3rem)]`, but `/graph` is not the full shell —
`__root.tsx:31` only gives `/` the three-column layout, so everything else renders inside
`SimpleShell` (`mx-auto w-full max-w-5xl px-6 py-8`) with 32px of vertical padding top and bottom.

Measured at the default 1280×800 window: `innerHeight` 800, `document.documentElement.scrollHeight`
**864**. The page scrolls by 64px it was never designed to need, and the bottom-anchored
furniture — the legend at `bottom-3 left-3` and the control bar at `bottom-3 right-3` — sits below
the fold on first paint. This is also why the graph header only had 656px to work with during the
Part B rework.

Suggested change: give the route a height that fits its parent (`h-full` with the shell owning
the height, or `flex-1 min-h-0`), and let `SimpleShell` be the thing that decides page height.

### G3 (LOW) — sub-12px type carries control and section labels

`graph.tsx:380` uses `text-[10px]` for the "Scattered clusters" section heading and the filter
counts use `text-[10px]`; the legend and metadata use `text-[11px]`. Measured legible at 2× device
pixel ratio, but it is below the 12px floor the guidelines set for labels. See S10 — this is the
same systemic choice, not a graph-specific defect.

## Sweep of the other six routes

Each row is a finding with the file and line it lives in and a concrete change. Severities follow
the skill's scale.

### S1 (HIGH, measured) — the catalog overflows its own viewport by 48px

`catalog-shell.tsx:573` roots the catalog at `h-[100dvh]` inside `main.flex-1`, which itself sits
under a 48px top bar. Measured at 1280×800: the shell's box is `top 48 / height 800 / bottom 848`
against `innerHeight` 800, and `document.documentElement.scrollHeight` is **848**. Because the
shell is `overflow-hidden`, the last 48px of the catalog — the tail of the grid and the end of its
scroll region — is clipped rather than reachable by scrolling the page.

Suggested change: `h-full` (or `min-h-0 flex-1`) instead of `h-[100dvh]`, letting `main` own the
height it already computes.

### S2 (HIGH) — every top-level nav destination is unnamed below 1024px

`top-bar.tsx:214` renders each nav label as `<span className="hidden text-xs lg:inline">` next to
an `aria-hidden` icon, and the `Link` at `:206` carries no `aria-label` or `title`. `hidden` is
`display: none`, which removes the text from the accessible-name computation, so under 1024px the
five destinations (Running, Map, Claude, Settings, Debug) become icon-only links with **no
accessible name at all**. The window's minimum width is 800 (`main-window.ts:22`), so this is
reachable by dragging the window edge.

Measured at 1280: the label span computes to `display: block` and the text is present. The
sub-1024 case is read from source and CSS semantics, not measured — the window was not resized.

Suggested change: keep the `lg:hidden` text as a `sr-only` sibling (the pattern the update chip
already uses at `top-bar.tsx:156,174,197`), or add `aria-label={label}` to the `Link`.

### S3 (HIGH) — the repo card is a `role="button"` wrapping real buttons

`repo-card.tsx:131` gives the card `role="button"`, and inside it are `PortChipsForRepo` (`:176`,
which renders `PortChip` buttons), `FavoriteStar` (`:180`, a button) and `LauncherButtons` (`:249`,
four icon buttons). Interactive descendants inside a `button` role are invalid: screen readers
flatten or skip the children, and the nested controls become unreachable or ambiguous (the
`nested-interactive` rule in axe).

Suggested change: drop `role="button"` from the `<article>` and let it be a container —
selection stays on the card's `onClick` plus `tabIndex`, while the nested controls keep their own
semantics; or make the card's title itself the button and leave the rest as siblings.

### S4 (MEDIUM) — three routes print an error with no way to recover

`repos.$slug.tsx:36-45`, `settings.tsx:49-58` and `process-list.tsx:75-81` all render a headline
plus a raw `error.message` in a `<pre>`, and stop there. `/graph` gained a `Try again` action in
Part B; these three did not, so a transient IPC failure leaves the user with a dead screen and no
route back other than the top bar. The guidelines ask error states to name a recovery path.

Suggested change: add a retry `Button` calling the query's `refetch()`, as `graph.tsx:279-288`
now does.

### S5 (MEDIUM) — loading states are bare text where their siblings use skeletons

`repos.$slug.tsx:28-32` ("Loading repo…"), `settings.tsx:45-48` ("Loading settings…") and
`process-list.tsx:54-64` render a sentence, while `detail-panel.tsx:51-55` and `repo-grid.tsx:172`
already use `animate-pulse` skeletons for the same class of wait. A cold start is ~22s on this
machine (ATR-055), so the first paint is exactly where the difference shows.

Suggested change: reuse the existing skeleton shape rather than inventing a new one.

### S6 (MEDIUM) — the Claude range selector is a radiogroup that does not behave like one

`claude.tsx:117` declares `role="radiogroup"` with `aria-label="Date range"` and its four children
at `:127` declare `role="radio"` with `aria-checked`. Nothing implements the pattern's required
behaviour: all four are separate tab stops (no roving `tabIndex`), and ArrowLeft/ArrowRight do
nothing. A screen-reader user is told "radio button, 1 of 1" and gets a control that ignores the
keys radios are expected to answer.

Suggested change: either implement roving tabindex plus arrow-key selection, or drop the radio
roles and use the toolbar's `role="group"` + `aria-pressed` segmented pattern, which matches the
pressed-button behaviour this control actually has.

### S7 (MEDIUM) — the table view's rows are click targets with no role

`repo-table.tsx:182-198` puts `tabIndex={0}`, `onClick` and an `Enter`-only `onKeyDown` on a
`<tr>`. It is announced as a table row, Space does nothing, and the click target has no role or
name of its own — the accessible way to open a repo from the table is not discoverable.

Suggested change: keep the row click, but make the repo name a real `<button>`/link inside the
first cell so the action has a name and a keyboard home; or add `role="button"` and handle Space.

### S8 (MEDIUM) — destructive confirmations use two different mechanisms

`process-list.tsx:37` and `port-chip.tsx:57` call `window.confirm` to confirm a kill, while the
rest of the app confirms through the Radix `Dialog` (`group-sidebar.tsx:463`, `move-dialog.tsx`,
`scan-root-dialog.tsx:142`). The native dialog is blocking, unstyled, and announces differently
from every other confirmation the app shows.

Suggested change: move the kill confirmation onto the shared dialog, as `repo-detail-content.tsx`
already does for repo removal.

### S9 (LOW) — no skip link

`__root.tsx` renders the top bar, notices and `main` with no "skip to content" affordance, so the
keyboard path to catalog content starts with the whole top bar. The only `sr-only` element in the
shell is the process badge at `top-bar.tsx:224`.

Suggested change: a visually-hidden-until-focused link before `<main>`.

### S10 (LOW) — 127 uses of sub-12px mono type, several as labels and headings

`text-[10px]` / `text-[11px]` appear 127 times across 20+ files, including as **control labels and
section headings** rather than only as metadata: `claude.tsx:130`
(`text-[11px] uppercase tracking-widest`), `graph.tsx:380` (`text-[10px]`), `repo-detail-content.tsx:328`
and `:342` (tab labels). This is a deliberate density choice that suits the product, and the
guidelines' 12px floor is about body text — but a 10px uppercase tracking-widest *heading* is a
label a user has to read, and it is the smallest thing on the screen.

Suggested change: a decision, not a sweep — either raise the label tier to 11–12px and keep 10px
for true metadata, or record here that sub-12px labels are intentional so it stops being
re-litigated.

### S11 (LOW) — the accent hue also means "running"

`--accent` (`globals.css:75`) is the brand/primary action colour, and it is also the running-process
indicator (`port-chip.tsx:84` pulses `bg-accent`, the port chip is `text-accent` on `bg-accent/10`).
The palette deliberately keeps status hues out of the recency ramp for exactly this reason, so
accent doing double duty as brand and as "server is live" is an inconsistency with the app's own
stated rule.

Suggested change: pick the status from the existing `--color-activity-*` family or a dedicated
token, leaving accent to mean "the app's own colour".

### S12 (LOW) — `/debug` is shipped in the primary navigation

`top-bar.tsx:57` lists Debug alongside Running, Map, Claude and Settings. Its own copy says it
exists so the Phase 0 Playwright spec keeps passing (`debug.tsx:10`, and the `h1` reads
"/debug — system.ping"). Developer scaffolding in the main nav is the kind of thing that reads as
unfinished on a build that is about to be announced.

Suggested change: reach it from a dev-only affordance (the command palette already has a
dev-tools action) and drop it from `NAV_ITEMS`.

## What is measured, and what is read

Measured in the running app: every claim in the A1–A6 table, the transition colours in the Part B
omission, and the overflow figures in S1 and G2 — `innerHeight` 800 against document heights 848
(`/`) and 864 (`/graph`).

Read from source only, and labelled as such above: the sub-1024px nav accessible name (S2),
`nested-interactive` on the repo card (S3), and the keyboard behaviour of the radiogroup (S6) and
the table rows (S7). None of these needed a running app to establish — each is a property of the
markup that is visible in the file — but none was reproduced in a browser either.

## What this pass did not do

No route was modified. No Part C prose work, no `lint:prose` gate, no launch post. The sweep
findings are filed in [`../REMAINING-WORK.md`](../REMAINING-WORK.md) as ATR-059 … ATR-074 rather
than fixed, per the plan's decision to review the other routes and file rather than touch them.
