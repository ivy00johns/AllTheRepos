---
format: 1920x1080
duration: 135s
message: "\"Which repo was that?\" — answered in one window, on your own machine"
arc: Cold open (the forgotten repo) → what this is → scan → search → triage → your vocabulary → links & map → it keeps up → local-first, provably → close
audience: developers with hundreds of local repos — README hero and landing-page visitors
mode: collaborative
music: calm, modern low-key synth underscore — unobtrusive under narration
---

## Video direction

- **What this is:** a show-it-as-is walkthrough. Every UI pixel is the **real app**, recorded by `scripts/make-demo-video.mjs` against a throwaway profile (`assets/captures/NN-*.webm`, 2560×1600 at scale 2). Never rebuild app UI in HTML — the footage is the source of truth, and the composition only frames, crops and annotates it.
- **Presentation:** each clip rides in a **window card** — `frame.md` card radius, a 1.5px accent-tinted border at 20%, no shadow (blue-professional has none) — on the `#0F172A` canvas, inset so ~4% canvas shows around it at rest. Because the app's frame is 2560×1600 (16:10) and the canvas is 16:9, the card **crops** the recording vertically; crops are centred on the element the beat is about, never on the chrome.
- **The clip is act one, the overlays are the rest.** Every recording is shorter than its narration window (5–15s of footage against 11–22s of voice). The clip plays at 1× in the frame's opening act; after it, the shot **holds the last frame** and the beat's remaining reveals land on the voiceover cues. The motion budget therefore lives in the overlays, not in a re-timed camera.
- **Overlays (the only additions):** (1) **eyebrow chip** top-left — mono, uppercase, 0.08em tracking, accent text on the tinted card fill — one per frame, one or two words. (2) **callout pill** — accent fill, canvas-coloured label, ≤ 4 words, anchored to the region it names. (3) **mark row** — the small counter/count chips a list beat ticks off (below). Never more than one callout on screen at a time.
- **Counts are real or absent.** Where a beat shows a number it is the number the capture actually produced — `35 repos` from the scan log, `23 curated links`, the demo library's own `3 tags / 4 tasks`. Never invent a figure for a beat that has none; use a word instead.
- **Palette:** `frame.md` roles only — canvas `#0F172A`, ink `#F8FAFC`, accent `#22C55E`, muted `#94A3B8`; accent-tinted card fill/border for surfaces. No gradient meshes, no glows, no second hue.
- **Type:** `frame.md` display role (JetBrains Mono) for hero lines, eyebrows, chips and counts; body role (IBM Plex Sans) for supporting labels. No other font. Both ship in `assets/fonts/`.
- **Motion grammar:** `power3`-family long-tail settles; entrances are `fromTo` slide-ups of 20–36px; a single continuous move per frame may run underneath (the ghost drift in Frame 1, the card's slow push). NO bounce, NO overshoot, NO lazy breathing, NO back-half slow drift. Every overlay reveals on its spoken cue — never at t=0.
- **Rhythm / held beats:** Frame 1 and 10 are type-and-mark bookends. Frames 4, 6 and 8 are deliberate calmer beats (one or two moves, then a held read) between the busier Frames 3, 5, 7 and 9. A held read beats bad motion.
- **Caption keep-out:** everything sits above y = 900. The caption pill owns the bottom ~17%.
- **Negative list:** no slideshow (front-load then freeze), no screensaver (independent floating parts), no rebuilt UI, no fake cursor, no browser chrome, no invented numbers, no bokeh or “AI” gradients, no narration sentence rendered as on-screen text.

## Frame 1 — Cold open

- type: hook
- blueprint: kinetic-type-beats (Adapt)
- scene: A wall of half-remembered folder names drifts past while a typed path keeps resolving to the wrong repo
- duration: 11.392s
- transition_in: cut
- status: outline
- focal: type
- roles: none
- sfx: soft tick on each wrong-name swap
- voiceover: "Somewhere in your home folder is a project you can't remember the name of. You know it's there. You just can't remember what you called it, or where you put it, or what it does."
- src: compositions/frames/01-cold-open.html

Adapt: keep the kinetic-type-beats signature (staggered per-token reveal + an in-place hard swap), but the tokens are a **typed path that keeps being wrong** rather than three facts, and one continuous background drift carries the frame instead of a scene change.

Scene 1 (0.0–4.0s): canvas ground + a very low-opacity wall of ~14 mono folder labels in three columns, drifting upward continuously (this drift runs the whole frame, 9s of travel). Centered upper-third: an empty prompt line `~/Code/` with a blinking caret. Nothing else.
Scene 2 (4.0–8.5s): on "you just can't remember what you called it", the caret line types `old-prototype-v2` — then the name **hard-swaps in place** through `old-project-v2`, `prototype-old`, `v2-old-prototype` (the signature swap), one per spoken beat, each swap a single opacity flick with a tick. The drift wall dims ~40%.
Scene 3 (8.5–12.5s): on "where you put it", a small mono row under the prompt ticks through the four scan roots — `~/work` `~/projects` `~/oss` `~/sandbox` — each landing on its own beat; the caret line's candidate name collapses to `?`.
Scene 4 (12.5–16.0s): the wall settles to its dimmer level and the prompt line holds still — `~/Code/?` with one faint chip at the right edge reading `not on disk yet`. Deliberate held read; no motion but the drift.

## Frame 2 — What this is

- type: product_intro
- blueprint: product-hero-open (Adapt)
- scene: The catalog settles in its window card; the promise lands as three quiet chips
- duration: 15.104s
- transition_in: crossfade
- status: outline
- asset_candidates: assets/captures/02-catalog.webm — the real catalog, recorded
- focal: assets/captures/02-catalog.webm
- roles: 02-catalog = background plate (full window card)
- sfx: soft whoosh into the window card
- voiceover: "AllTheRepos is one window for every git repository on your machine — hundreds, or thousands of them. Point it at the folders where you keep code, and it learns what all of them are, without moving a single one."
- src: compositions/frames/02-what-this-is.html

Adapt: keep product-hero-open's signature (the product surface arrives as a framed window and resolves into readable heroes), and replace its logo/repo-name hero with **the catalog itself** plus the promise chips; the "hero" is the real screen, not a wordmark.

Scene 1 (0.0–1.4s): on the product name, the window card animates in from 96% scale with a short slide-up; the eyebrow chip `THE CATALOG` fades in top-left. The clip starts at 1.4s and plays at 1×.
Scene 2 (1.4–5.4s): the clip runs — the catalog settles and scrolls once. No overlay competes with it; the card carries a slow 1.02 → 1.00 push.
Scene 3 (5.4–10.0s): clip holds its last frame; on "hundreds, or thousands of them" a mono count chip lands beside the eyebrow reading `hundreds · thousands`, then on "point it at the folders" a second chip `4 scan roots` slides in under it.
Scene 4 (10.0–14.0s): on "without moving a single one" a single callout pill lands lower-left over the card: `read-only`. The card's push stops.
Scene 5 (14.0–17.0s): everything holds still — deliberate read of the settled catalog with its three chips.

## Frame 3 — The scan

- type: key_feature
- blueprint: process-reveal (Adapt)
- scene: The real scanner fills an empty grid — 0 to 35 repos — while the counter ticks beside it
- duration: 16.043s
- transition_in: cut
- status: outline
- asset_candidates: assets/captures/03-scan.webm — the real scanner filling the grid
- focal: assets/captures/03-scan.webm
- roles: 03-scan = background plate (full window card)
- sfx: soft tick per fill burst, gentle riser into the final count
- voiceover: "Add a scan root, press Scan, and watch it fill. It walks the tree in a worker thread, reads each repository's remotes, languages and last commit, and writes the result into one SQLite file on your own disk."
- src: compositions/frames/03-scan.html

Adapt: process-reveal's signature is a step sequence where each step's **evidence appears behind the step** as it is named; here the steps are words and the evidence is the grid filling — so the step rail runs across the top and the counter ticks in the card's corner while the footage plays the whole frame.

Scene 1 (0.0–2.0s): window card in place (hard cut in, no entrance); eyebrow chip `SCAN`; a mono counter pinned bottom-right of the card reads `0 repos` in muted.
Scene 2 (2.0–6.0s): the clip plays from 0; on "watch it fill" a step row top-right reveals `scan root → tree walk → write` as three small mono tokens, left to right.
Scene 3 (6.0–12.0s): as the VO lists them, three callouts land in sequence over the card's header strip — `remotes`, `languages`, `last commit` — each dwelling ~1.2s, never two at once. The counter ticks upward from the clip's own progress.
Scene 4 (12.0–15.0s): on "one SQLite file on your own disk" the counter resolves to `35 repos` in accent; a single callout pill lands lower-left: `~/Library/Application Support/alltherepos`.
Scene 5 (15.0–17.0s): the filled grid holds; counter and callout stay — deliberate read.

## Frame 4 — Search

- type: key_feature
- blueprint: focus-lock (Adapt)
- scene: A half-remembered word typed into search, results narrowing under a lock-on callout
- duration: 13.867s
- transition_in: crossfade
- status: outline
- asset_candidates: assets/captures/04-search.webm — search typing and narrowing
- focal: assets/captures/04-search.webm
- roles: 04-search = background plate (full window card)
- sfx: soft click on the search field
- voiceover: "Then stop guessing at folder names. Search all of them at once — full text by default, and when Ollama is running, vector ranking fused into it, so even a half-remembered phrase still lands."
- src: compositions/frames/04-search.html

Adapt: keep focus-lock's signature (the canvas dims to one region and a ring locks onto it), but the lock is a **soft vignette on the card** rather than a full-canvas dim, so the surrounding catalog stays legible.

Scene 1 (0.0–1.2s): window card in place; eyebrow chip `SEARCH`; the clip starts at 1.2s.
Scene 2 (1.2–5.6s): the clip plays — the search field takes a word and the grid narrows. A soft vignette closes in on the search field's strip.
Scene 3 (5.6–9.0s): clip holds; on "full text by default" a callout lands under the field: `full text`. A mono caption-scale row under the card reads `no folder names required`.
Scene 4 (9.0–12.0s): on "when Ollama is running" a second callout lands beside the first: `+ vector rank`; the two sit together as a pair.
Scene 5 (12.0–14.0s): held read — field, pair of callouts, narrowed grid.

## Frame 5 — Triage at a glance

- type: feature_list
- blueprint: feature-callout-tour (Adapt)
- scene: The grid's marks are called out one at a time — recency, language, dirty tree, off-disk, ownership
- duration: 18.389s
- transition_in: crossfade
- status: outline
- asset_candidates: assets/captures/05-triage.webm — hover across three cards
- focal: assets/captures/05-triage.webm
- roles: 05-triage = background plate (full window card)
- sfx: soft tick per mark
- voiceover: "The grid answers what you would otherwise open six repositories to ask. How long since you touched it, what it is written in, whether the tree is dirty, whether the folder has moved off disk — and a mark that says whether it is yours, a clone, or only ever local."
- src: compositions/frames/05-triage.html

Adapt: feature-callout-tour's signature is one callout per card as the pointer walks the tour; keep that exactly, and replace its pointer with the recording's own hover (the clip already walks three cards).

Scene 1 (0.0–2.0s): window card in place; eyebrow chip `TRIAGE`; a mono mark row sits under the eyebrow, empty, reading `marks: —`.
Scene 2 (2.0–9.8s): the clip plays; its hover walks three cards. On each spoken clause a callout lands: `last touched` → `language` → `dirty tree`. Each callout ticks a corresponding token into the mark row.
Scene 3 (9.8–15.0s): clip holds. On "moved off disk" a callout lands with the accent ring on a card's missing badge: `off disk`; the mark row takes a fifth token.
Scene 4 (15.0–20.0s): on "yours, a clone, or only ever local" three small ownership chips land in a row under the mark row — `yours` · `clone` · `local only` — accent for the active one, muted for the other two.
Scene 5 (20.0–22.0s): the full mark row holds — deliberate read of the whole ledger.

## Frame 6 — Your vocabulary

- type: feature_list
- blueprint: in-place-token-swap (Adapt)
- scene: The detail panel's tags, favourites, groups and its own tasks — swapped in place, one idea at a time
- duration: 9.643s
- transition_in: crossfade
- status: outline
- asset_candidates: assets/captures/06-vocabulary.webm — lighthouse-ui detail, tags, Notes tab
- focal: assets/captures/06-vocabulary.webm
- roles: 06-vocabulary = background plate (full window card)
- sfx: soft pop on each chip
- voiceover: "Add your own words on top of it: tags, favourites, groups — and each project's own tasks read from the files that already declare them."
- src: compositions/frames/06-vocabulary.html

Adapt: keep in-place-token-swap's signature (one element that changes its content rather than four elements arriving), and drive it with a **three-chip rail** that each swaps to the next word on the beat, while the recording shows the real panel underneath.

Scene 1 (0.0–1.2s): window card in place; eyebrow chip `YOUR WORDS`; clip starts at 1.2s on the `lighthouse-ui` detail panel.
Scene 2 (1.2–4.0s): clip plays. On "tags" the first chip in the rail lights accent and swaps `tags` → `3 user tags`; the other two stay muted.
Scene 3 (4.0–6.5s): on "favourites" the second chip swaps to `pinned`; on "groups" the third swaps to `10 groups`.
Scene 4 (6.5–9.5s): clip holds on the Notes tab; on "read from the files that already declare them" a callout lands over the panel's task section: `4 tasks · from the repo itself`.
Scene 5 (9.5–11.0s): held read — the three resolved chips and the task callout.

## Frame 7 — Curated links and the graph

- type: key_feature
- blueprint: relationship-map-build (Adapt)
- scene: The map draws itself, then the MCP server makes it readable to your agents
- duration: 16.064s
- transition_in: crossfade
- status: outline
- asset_candidates: assets/captures/07-graph.webm — the map, then the detail panel
- focal: assets/captures/07-graph.webm
- roles: 07-graph = background plate (full window card)
- sfx: soft whoosh on the map settling, soft pop on the MCP chip
- voiceover: "Draw the lines between repositories you already know belong together, see the whole shape as a graph, and let your own coding agents read those relationships through the built-in MCP server, so your tooling knows the map too."
- src: compositions/frames/07-graph.html

Adapt: relationship-map-build's signature is edges arriving between already-placed nodes; the recording already *is* that, so the frame keeps the signature by **overlaying one drawn edge** in the app's accent that traces the first link the VO names, while the real map settles behind it.

Scene 1 (0.0–2.0s): window card in place; eyebrow chip `THE MAP`; clip starts at 2.0s on `/map`.
Scene 2 (2.0–7.0s): the clip lays the graph out. On "draw the lines" an accent hairline draws left→right across the card between two labelled chips (`lighthouse-ui` → `atlas-kit`) — the drawn-edge signature — then fades as the real map's own edges dominate.
Scene 3 (7.0–11.0s): on "the whole shape as a graph" a mono count chip lands top-right: `23 curated links`.
Scene 4 (11.0–15.0s): on "through the built-in MCP server" a callout pill lands lower-left: `MCP server · local`; the clip's second half (the detail panel) plays behind it.
Scene 5 (15.0–17.0s): held read of the detail panel and the two chips.

## Frame 8 — It keeps up

- type: feature_list
- blueprint: quiet-proof (compose)
- scene: The rail's scanned folders expand — the live roots behind an always-correct catalog
- duration: 9.813s
- transition_in: crossfade
- status: outline
- asset_candidates: assets/captures/08-live.webm — the folder rail expanding
- focal: assets/captures/08-live.webm
- roles: 08-live = background plate (full window card)
- sfx: soft tick on the rail expand
- voiceover: "Scan roots, folders and file watching all stay live in the background, so when you come back to the window, the catalog is already correct."
- src: compositions/frames/08-keeps-up.html

compose: this is the video's calm beat — no blueprint shape fits a deliberately quiet frame, so it is built from the motion vocabulary directly: one entrance, one callout, then a long held read.

Scene 1 (0.0–1.4s): window card in place; eyebrow chip `LIVE`; clip starts at 1.4s and expands the folder rail.
Scene 2 (1.4–5.0s): the clip plays its single expand move; nothing overlays it.
Scene 3 (5.0–8.0s): clip holds. On "stay live in the background" a callout pill lands beside the rail: `watching`; a small mono row under the eyebrow reads `4 roots · live`.
Scene 4 (8.0–11.0s): held read — the quiet frame before the claim.

## Frame 9 — Local-first, provably

- type: proof
- blueprint: proof-stack (Adapt)
- scene: Settings, with the three claims stacked as countable proof
- duration: 15.04s
- transition_in: crossfade
- status: outline
- asset_candidates: assets/captures/09-local-first.webm — settings scrolled
- focal: assets/captures/09-local-first.webm
- roles: 09-local-first = background plate (full window card)
- sfx: soft tick per claim
- voiceover: "No account, no telemetry, and nothing leaves the machine. One SQLite file that is yours — and every command, every write and every network request is inventoried and disclosed in the repository."
- src: compositions/frames/09-local-first.html

Adapt: proof-stack's signature is claims stacking one on another until the stack is the argument; keep that, with three count-chips stacking on the left of the card as the recording scrolls settings behind them.

Scene 1 (0.0–1.4s): window card in place; eyebrow chip `LOCAL-FIRST`; clip starts at 1.4s, settings settling.
Scene 2 (1.4–5.0s): the clip plays. On "no account" the first proof chip slides in at the card's left edge: `accounts: none`. On "no telemetry" the second stacks under it: `telemetry: none`.
Scene 3 (5.0–9.0s): on "nothing leaves the machine" the third chip lands: `network: disclosed`. The clip holds on the settings list.
Scene 4 (9.0–12.0s): on "every command, every write and every network request" a callout pill lands lower-left: `docs/COMMAND-DISCLOSURE.md`; the three-chip stack holds beside it as one block.
Scene 5 (12.0–14.0s): held read of the stack — the claim the whole piece rests on.

## Frame 10 — Close

- type: close
- blueprint: logo-lockup-close (Adapt)
- scene: The ⌘K palette opens over the catalog, then the mark and the one-line ask
- duration: 9.835s
- transition_in: crossfade
- status: outline
- asset_candidates: assets/captures/10-close.webm — the command palette over the catalog
- focal: assets/captures/10-close.webm
- roles: 10-close = background plate (window card, dimmed as the close resolves)
- sfx: soft click on the palette open
- voiceover: "Keyboard-first, free, and local. It is alpha on macOS — so download it, and finally find that repository you were looking for."
- src: compositions/frames/10-close.html

Adapt: keep logo-lockup-close's signature (the surface recedes, the mark arrives centred, the ask lands under it); the surface here is the palette shot, and the ask stays honest — **alpha on macOS**, no notarised-install claim.

Scene 1 (0.0–1.4s): window card in place; eyebrow chip `⌘K`; clip starts at 1.4s.
Scene 2 (1.4–5.0s): the clip plays the palette opening over the catalog. On "keyboard-first" a small mono row lands at the card's top-right: `⌘K · every command`.
Scene 3 (5.0–7.5s): on "free, and local" the card dims to ~35% and recedes slightly (0.96 scale); the app mark fades up centred, with `AllTheRepos` in display type under it.
Scene 4 (7.5–10.0s): on "alpha on macOS" a single honest line lands under the wordmark: `free · open source · alpha on macOS`; the downloads line arrives at ~9.0s.
Scene 5 (10.0–11.0s): the only real exit in the piece — the mark, the line and the card fade out together over the final second.
