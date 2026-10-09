# 2026-10-09 — UI/UX review: every route, rendered at the window's real sizes

Point-in-time record. This pass **did** change code: four defects were found by measurement and
fixed, and the rest are filed here rather than touched. Where the two differ it says which is
which.

## Method

Not a code reading. The renderer was served in a plain browser tab (`.atr-dev/vite.renderer.config.mjs`
wraps the app's own `exportedCatalogPlugin`, so the pass reviews the **real 271-repo export**, not the
demo library) and driven by a **visible, non-headless** Chromium through Playwright — the harness is
`.atr-dev/ux-review.mjs`, and it is what took the screenshots.

Two things follow from that, and both are limitations on what the findings can claim:

- **The visual judgement is thin.** The review produced 24 screenshots, but the environment it ran in
  could not composite the preview webview, so the images could not be *looked at* from here — they are
  artifacts for a person, not evidence any claim below rests on. Every finding below is therefore a
  **measurement**: geometry, hit-testing, computed colour and contrast, accessible names, console
  output. Nothing here is a claim about whether a screen looks good.
- **The sizes are the app's own.** `src/main/window/main-window.ts` opens at 1280×800 with a minimum of
  800×600, so those are the passes. There is no phone width to test: the window cannot go below 800px,
  and a 375px result would describe a layout that cannot ship.

| Pass | Size | Screens |
| --- | --- | --- |
| desktop | 1280×800 | catalog, repo detail, map, Claude, Running, Settings, Debug, command palette |
| tablet | 1024×768 | the same eight |
| minimum | 800×600 | the same eight |

A screen is reached the way a user reaches it — a click in the top bar — because the renderer routes on
an in-memory history, so a URL path cannot select one.

The harness asks the question a screenshot cannot answer: **is this control actually pressable?** It
places the pointer at each control's centre and reads back what is there. That check is what found U1
and U2; a viewport-bounds check alone misses both, because in both cases the control is still on screen
and merely buried under something.

Reproduce:

```sh
node .atr-dev/vite.renderer.config.mjs   # serves the renderer at http://127.0.0.1:5173
node .atr-dev/ux-review.mjs              # visible browser; add --headless for CI
```

## Fixed in this pass

### U1 (CRITICAL, measured) — the detail drawer covered the top bar, so every global control was dead below 1024px

`detail-panel.tsx` renders the repo panel as a fixed drawer under `lg` (`fixed right-0 top-0 z-30 h-full`)
and as a layout column at `lg` and above (`lg:static`). The drawer was anchored to the window top, not to
the content area, so between 800 and 1023px it painted over the 48px top bar.

Measured at 800×600, with one repo open: the drawer's box was `x 380 / y 0 / w 420 / h 600`, and
`elementFromPoint` at the *Map* link's centre returned an element inside the drawer. Playwright then
could not click any of the five nav destinations — and the app's minimum window width is 800. The
drawer also covered the app title and the search field, and because the failure is an overlay rather
than a layout collapse, the shell looked correct while being unusable.

Fixed: the drawer now starts below the bar it was covering — `top-12` with `h-[calc(100%-3rem)]`,
matching the bar's `h-12` — so it occupies the content area at every width. The `lg:static` /
`lg:h-auto` overrides still win above 1024px and the wide layout is untouched. With the fix in place the
same harness opens all 24 screen/width combinations; before it, seven of the nine minimum-width screens
could not be opened at all.

### U2 (HIGH, measured) — the catalog toolbar pushed Fetch, Pull and the repo count outside their own column

`catalog-toolbar.tsx` laid its controls out as one unbreakable row. They need **854px**; the column they
sit in is 544px at the 800px minimum and 644px at 1280 with the detail panel open, and an ancestor
(`div.flex.min-w-0.flex-1.flex-col.overflow-hidden`) clips the overflow rather than scrolling it.

Measured: at 800px the bar's `scrollWidth` was 854 against a `clientWidth` of 544, the Fetch control sat
at `x 959…989`, and `elementFromPoint` at its centre returned the *detail panel's* header — the button was
on screen, outside its column, and impossible to press. At 1024px the repo count (`271 repos`) was cut
off the same way; the bar has zero slack even at 1280 once the panel is open.

Fixed: `flex-wrap` with `min-h-11` and a half step of vertical padding (`py-0.5`) for the wrapped case.
A single row is still exactly the 44px it has always been — the tallest control is 36px, so a full step
(`py-1`) measured 45 and moved every pixel below the bar, while a half step leaves `36 + 4 + 1 = 41`
under the 44px floor. A second row appears only when the controls genuinely do not fit, which keeps every
control visible and pressable instead of clipping the last three.

### U3 (MEDIUM, measured) — a leaf folder's chevron was an unnamed, disabled button

`dir-rail.tsx` renders the disclosure chevron as a button that is `disabled` and `opacity-0` when a
folder has no children, and its `aria-label` was conditional (`hasChildren ? … : undefined`). So every
leaf folder contributed an unnamed button to the accessibility tree — reported on the catalog, the repo
detail and the command palette at all three widths.

Fixed: `aria-hidden` when there are no children. A disabled control cannot be operated, so it has nothing
to name.

### U4 (LOW, measured) — the "external" ownership label failed AA at 11px

`--color-own-external` was `#7c8899`; the ownership label is 11px monospace, so it needs 4.5:1. Measured
on the repo card: **4.24:1**.

Fixed: the token is `#828e9f`, the smallest step that clears the bar. Re-measured after the change: zero
contrast failures across all 24 screen/width combinations.

### U8 (found after the sweep, by using the tab) — Fetch and Pull hung on every click

Not a sweep finding: the sweep navigates screens, and neither sync button was pressed in it. Reported
from the running tab and reproduced at once.

Two defects, one symptom. First, the browser bridge answered `git.fetch` and `git.pull` with
`{ results: [] }`, but the caller's summary counts `result.entries` (a `SyncResult` is
`{ entries, updated, failed }`), so every click threw `TypeError: result.entries is not iterable` at
`catalog-shell.tsx:546`. Second, both handlers set the notice strip to `Fetching 5…` *before* awaiting the
sync and caught nothing, so the rejection left the strip counting forever with the error only in the
console — the user-visible half of the bug, and the half a bridge fix alone would have left in place.

Fixed in both places: the bridge returns a real `SyncResult` with one `failed` entry per requested repo
carrying the reason a tab cannot reach a remote, the two handlers report a rejection into the strip, and
`tests/unit/renderer/browser-bridge.spec.ts` pins the answer against `SyncResultSchema`. Re-measured in
the tab with the catalog filtered to 61 repos: the notice resolved to `61 failed`, no longer stuck, with
**no console errors and no page errors**. The lesson for the next sweep is in the method: navigating to
every screen does not exercise the controls on it.

### U9 (systemic, measured) — the bridge's answers had drifted from fourteen contracts

U8 was one instance of a pattern, so this pass went after the pattern instead of the instance. The
bridge is a hand-written stand-in for the preload script, every one of its answers is cast (`as never`)
past the type checker, and those answers never travel through `src/main/ipc/*` — so nothing ever compared
what a caller reads with what the bridge hands it. Two crashes and a silent `undefined` were the cost of
that gap; nobody could say how many others were left.

`tests/unit/renderer/browser-bridge-contract.spec.ts` closes it by refusing to describe the contract a
second time: it pairs each method on the installed bridge with the `@shared/schemas` schema the matching
IPC handler parses its real result with. Two guards keep it honest as the surface grows — every method on
the bridge must have an entry, and every entry must name a method that still exists — so a new method
arrives checked and a removed one cannot leave a green test behind.

Its first run failed **14 of 85** cases. Each was a real drift, not a test artifact:

| Method | Answered | Owes |
| --- | --- | --- |
| `catalog.list` | `{ items, total }` | `+ limit, offset` — the fields a caller pages by |
| `scan.status` | `{ running, scanned, total }` | `{ jobId, status, processed, total, startedAt, endedAt, errorMessage }` |
| `scan.start` | `{ started, reason }` | `{ jobId, status: "running", startedAt }` |
| `scan.cancel` | `{ cancelled }` | `+ jobId` |
| `git.status` | `{ branch, ahead, behind, dirty }` | `{ slug, isDirty, ahead, behind, currentBranch, upstream }` |
| `git.branches` | `{ branches, current }` | the array itself |
| `git.openInEditor` | `{ ok, reason }` | `{ opened, uri }` |
| `groups.delete` | `{ deleted: false, reason }` | `{ deleted: true, id }` |
| `app.setDockBadge` | `{ ok: true }` | `{ badge }` |
| `app.notify` | `{ ok: false }` | `{ shown }` |
| `app.showSpotlight` / `hideSpotlight` | `{ ok }` | `{ visible: true }` / `{ visible: false }` |
| `app.registerActions` | `{ registered: 0 }` | `{ accepted, skipped }` |
| `catalog.folderCreate` | `{ ok, reason }` | a full `FolderOpResult` |

Three of those (`scan.start`, `groups.delete`, `app.showSpotlight`) have result types with no room for a
refusal at all — `status` is `z.literal("running")` and `deleted` is `z.literal(true)`. The no-op result
they used to return was not a soft refusal; it was a shape nobody validates. They now refuse by throwing,
which is what `groups.create` already did and what the callers already handle: `settings-form` renders the
message under the scan stats and the delete-group dialog renders it in its `role="alert"`.

Verified after the fixes: **85/85** in that spec, and the full unit suite **1883 passed** across 93 files.
In the running browser tab, all 24 screen/size combinations still render with **no console errors**, and
the Fetch flow that started this resolves to `171 failed` rather than sticking. Two follow-on notes for the
record: the old `browser-bridge.spec.ts` case that asserted `scan.start` answered `{ started: false }` was
updated to assert the rejection instead, since that assertion was pinning the drift; and this spec needed a
pinned fixture (`vi.stubGlobal("fetch", …)` plus `vi.resetModules()`) because the suite runs every file in
one process, so both the demo store's module state and any stubbed global are shared with whichever file
ran first.

## The press pass: every control on every screen, pressed

The render pass above only looks; this pass presses. The distinction is the one that mattered: U8 above
(Fetch and Pull hung on every click) was invisible to a pass that merely navigates, because the control
was broken only *when pressed*. The sweep now presses every control it can see on every screen and
reports four outcomes, all four of them failures:

| Outcome | Means |
| --- | --- |
| `hang` | the click never completed |
| `threw` | the click raised, or the console logged an error |
| `stuck` | a notice the press introduced was still on screen three seconds later |
| `gone` | the control was there when the screen opened, and not when the same clean screen was re-created to press it |

**Coverage: 247 of 247.** catalog 90, repo detail 84, map 20, Claude 14, Running 11, Settings 11, Debug 10,
command palette 7 — every control whose centre is inside a 1280×800 window, which is every control a
person can reach without scrolling. No screen was cut short by the 120-per-screen cap and none failed to
open. The result: **no `hang`, no `gone`, no screen that a press could not re-open, and no notice left
stuck.** Six presses logged an error, and all six are one defect — U10 below. U8's control was re-run for
real in the process: Fetch and Pull are both in the catalog toolbar, both were pressed, and neither hung
nor left a notice on screen — the regression that started this pass is still fixed.

The one non-defect is the command palette's *Open Spotlight*, which refuses in a tab because there is no
Electron main process to open the window — Electron implements it (`app.showSpotlight`), so it is reported
apart from the defects rather than counted as one.

Two limits on what the numbers above mean, both deliberate rather than discovered late. The list is the
controls whose *centre* is inside the window, so a row that is scrolled out of a long list (a repo card
below the fold, on a catalog of 271) is not in it — same shape, same handler, but not pressed. And a control
is only reported when it *logs* something: U10's relative-image half was invisible to this pass because a
relative `img` that resolves to the app's own origin loads with a 200 and no console error, and was found by
reading the DOM in the running tab instead.

### Three ways the harness lied before it could be trusted

The first full run of this pass reported 28 catalog "hangs" and nothing else usable. Every one was the
harness, and each is worth recording because each looked exactly like an app bug:

1. **Every press shared one document, so state leaked between presses.** The app keeps scope, sort, folder
   and selection in memory and persists them, and re-clicking the nav link is not a reset. Measured in the
   run: the rail's *Favourites* took the catalog from 173 rendered rows to 1, and *Mine* took it from 1 to
   0 — and because the filter that remembers that is persisted under its own key, the harness's own
   `?reset-edits` reload did not bring the rows back (F1). A screen with no rows cannot be opened by
   `openFresh`, so from that press on every catalog finding was `could not open`. The pass now clears
   storage before any app script runs, so each press is a genuine first run.
2. **A failed re-open was charged to the wrong control.** That is how one mutated catalog became 28 named
   "hangs": the finding named the control *after* the one that poisoned the screen. A screen-level failure
   is now its own finding, named `(screen)`, and one failed re-open is retried before the screen is
   abandoned.
3. **The stuck check read the whole page.** It searched `document.body.innerText` for
   `Fetching|Pulling|…|Saving`, and the repo detail screen renders an entire README as page text — so the
   sentence "Saving the Simulation" in `generative_agents`'s README was reported as a notice left on
   screen. The check now reads only the app's notice surfaces (`role="status"`, `role="alert"`) and
   counts only a label that this press *introduced*. The earlier version of this same check is what found
   the real U8, so the change narrowed the read without narrowing the claim.

### U10 (MEDIUM, measured) — a README's images do not load, one console error each

Pressing a repo card opens that repo's README in the detail panel. Six of the 247 presses logged an error,
all of the same shape:

```
Loading the image 'https://img.shields.io/badge/Release-Jan%2030%2C%202026-black?style=for-the-badge'
violates the following Content Security Policy directive: "img-src 'self' data: blob:
https://avatars.githubusercontent.com"
```

The six presses are four distinct repos, and every one of them references images on a host the CSP does not
allow: `generative_agents` (`joonsungpark.s3.amazonaws.com`), `EpsteinFilesAllHopefully` (shields.io),
`ChatDev` (`github.com/NA-Wen.png`, which is not the allowed `avatars.githubusercontent.com`), and
`Universal-LPC-Spritesheet-Character-Generator` (shields.io). The catalog pressed all four cards; the repo
detail pass (which opens the first card) reproduced the first two. Re-checked through the app itself rather
than the harness — opening `generative_agents` in the running tab and reading back the images gives **7
`<img>` elements, every one with `naturalWidth === 0`**: six blocked by the CSP, plus a relative one below.

Neither the CSP nor its consequence is news to the code. `src/main/services/cover.ts:14-18` says remote
images "would need network access from the main process and would then be blocked by the renderer CSP
anyway, so a remote-only README yields no cover and falls back to generated art" — the cover path was built
around the constraint. The README body was not: `README_SANITIZE_SCHEMA` allows `img src` and
`react-markdown` renders whatever the README asked for, so the detail page draws a broken image where every
remote badge and screenshot should be, and logs one console error per image.

Two halves, and they want fixing together:

- **Remote images.** Drop them, or swap them for a labelled placeholder. Nearly all are status badges; the
  rest cannot be fetched under the CSP without widening `img-src`, which is not worth doing for a README.
- **Relative images are worse, and are broken wherever the app runs.** Measured on the same screen: the
  README's own `cover.png` resolved to `http://127.0.0.1:5173/cover.png` — the *app's own origin*, because
  `react-markdown` resolves a relative URL against the document rather than the repo. In the packaged build
  that is the renderer origin, which serves no repo files, so the image is broken there too and the read
  points at the app instead of the repo. The pattern for fixing it is already in the codebase: the cover
  service resolves a local image to a data URL (`cover.ts` — `MAX_IMAGE_BYTES` of 1.5 MB, MIME by
extension, and every candidate path realpath-checked to stay inside the repo), and the CSP does allow
  `data:`.

### F1 (LOW, measured, fixed) — `?reset-edits` reset the edits but not the view

The bridge tells a reviewer to "add `?reset-edits` to the URL to start from the catalog alone", and
`clearPersistedEdits()` did clear the demo store's edit record. But the catalog's scope, sort, group and
folder filters live in a second `localStorage` key, persisted by `stores/catalog-view.ts` and untouched by
that reset. Measured in the tab, in one session: press *Mine* → `30 of 271`; press *Favourites* →
`0 of 271`; then load the same URL with `?reset-edits=1` → still **`0 of 271`**, with
`atr:catalog-view:v1` reading `{ favoritesOnly: true, ownershipFilter: ["mine"] }` and the edits key gone
from `localStorage` entirely. Nothing on the page says a filter is on except the rail rows' own highlight.
This is dev-affordance-only (a browser tab; the app has no such URL), but it is what made the first three
runs of this pass lie.

Fixed: `resetPersistedViewState()` in `browser-bridge.ts` now runs beside `clearPersistedEdits()`, and both
halves are needed. The stores are put back to their initial state with `setState(getInitialState(), true)`,
because zustand hydrates them as `stores/*` is imported — before the bridge installs — so removing a key is
too late for the tab that is open now; then the keys are removed, because a `setState` is itself a persist
write and removing first would be undone by the write that follows. Each store now *names* its own persist
key (`PERSIST_KEY` is exported) so the bridge cannot silently drop out of step with a version bump, and the
reset is best-effort: a storage that refuses writes must not be able to throw out of `installBrowserBridge`
and take the renderer down at boot. `tests/unit/renderer/browser-bridge.spec.ts` seeds a saved view, installs
under `?reset-edits=1` and asserts both halves — the keys are gone from storage *and* the filters are back to
their defaults in memory — plus that a URL without the flag changes nothing.

Reproduce the whole pass:

```sh
node .atr-dev/ux-review.mjs --click            # render pass, then press every control
node .atr-dev/ux-review.mjs --click-only --only=catalog   # one screen, presses only
node .atr-dev/_analyze.mjs                     # newest run: defects vs browser-tab-only refusals
```

## Filed, not fixed

U10 above is filed the same way — measured, written down, and left alone, because it wants a decision about
scope (what a README is allowed to ask the renderer for) rather than another guess. The two below are the
same shape as each other — a control whose *centre* falls on a boundary, so it renders as half pressable —
and both are at the edges of the supported size range. Neither blocks a workflow; each wants a
deliberate look rather than another guess from geometry.

### U5 (LOW, measured) — two half-covered controls at the size extremes

- **Map at 800×600.** One cluster-filter segment (the name-family toggle) straddles the boundary between
  the canvas column and the page's own 320px side rail: measured centre `456,225`, which is exactly the
  rail's left edge (`aside.flex.w-80`, `x 456…776`), so `elementFromPoint` returns the rail. The left half
  of the control is still clickable. Related: the graph page's height arithmetic inside the padded shell
  was already filed as ATR-061/062 and closed on 2026-10-08, so this is a different symptom on the same
  page.
- **Repo detail at 1280×800.** A "Related" link at the bottom of the panel (`hollywood`, centre `1015,750`)
  has its centre inside the panel's own footer strip (`footer.flex.flex-col.border-t.p-3`), which is the
  last ~50px of the panel.

### U6 (LOW, measured) — sub-24px controls in the repo card

Consistently across the catalog grid: an icon button in the card measures **18×18**, and the card's title
and tag buttons are 20px tall. WCAG 2.2 AA (2.5.8) asks for 24×24 unless the "spacing" or "inline"
exception applies, which is a judgement about the rendered card rather than a number the harness can
settle. This sits next to the open ATR-068 (`.atr-segment` is `h-7`) and ATR-072 (sub-12px label tier) —
the same systemic sizing question, and worth deciding once with them.

### U7 (LOW, measured) — `/` and `/graph` have no `h1`

Heading outlines read back from the rendered page: `/settings`, `/claude`, `/processes` and a repo detail
page each open with an `h1`; the catalog begins at `h2` (one per group, then `h3` per card) and the map at
`h3` then `h2`. This is the same finding the 2026-10-07 review filed as G1, still open.

### F2 (LOW, measured) — the catalog's picture baseline caught a running process

`tests/e2e/catalog-visual.spec.ts` compares the catalog against a committed picture, and one thing in that
picture is not the layout: the count badge on the `Running` destination, which is drawn only while the
process sweep has something to count. The committed Table baseline had recorded a run with a dev server
up, so the same screen failed on a machine with nothing listening — **167 pixels at `x 934…953`,
`y 5…21`**, the badge and nothing else, which was the whole of that failure. The baseline is re-rendered
here without a listener, because the picture is about the layout. It wants a mask instead, the way the
cover art and the machine paths are already masked, so a badge saying something true about the machine
cannot decide the result; that in turn needs `visual-baselines.yml` re-run on the runner, which is a build
of its own rather than the last step of this one.

## What was already right

Worth recording, because a sweep that only lists faults is not a review: the top-bar labels that collapse
to icons below `lg` keep their text in the accessible name (`sr-only … lg:not-sr-only`, the fix for the
2026-10-07 review's S2), every `img` on every screen in every pass carries an `alt`, the command palette
opens with no console errors, and **no screen in any pass logged a console error or a page error** —the only console output was Vite's connect banner, the React DevTools notice, and the browser bridge's own
explanation of which library it is serving and why it refused a write. That claim was scoped to a pass that
only navigated — U8 was the counterexample, a control that was broken only *when pressed*. It no longer
needs the caveat: the press pass above opens all 247 controls and the only error any of them logged was
U10's blocked README images, which are the README's content rather than a control of the app's.

## Artifacts

- Screenshots: `.playwright/<run>/screenshots/<viewport>-<screen>.png` — 24 files, gitignored.
- Measurements: `.playwright/<run>/review.json`, the same 24 rows with every probe result, plus the press
  pass: `clicks.pressed` (247), `clicks.enumerated` (247) and one row per finding — `{ screen, control,
  outcome, browserOnly? }`. `.atr-dev/_analyze.mjs` splits the rows into defects and browser-tab-only
  refusals.
- Harness: `.atr-dev/ux-review.mjs`, dev-only and gitignored, alongside the renderer server config it
  pairs with. Flags: `--click` adds the press pass, `--click-only` runs it without the render pass,
  `--only=<screen>` runs one screen, `--headless` drops the visible window.
