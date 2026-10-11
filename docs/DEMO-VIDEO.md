# Demo video — pre-production plan

**Status:** pre-production. Nothing built yet, and nothing buildable yet.

> **On this branch (2026-10-10):** the demo library is `scripts/demo-data.mjs` (`pnpm demo`). The
> capture harness `scripts/make-demo-video.mjs` and per-repo notes, both described below as built,
> are not on `main` yet; they sit uncommitted in the `dfc163dd` hyperframes worktree.

The video is downstream of two things that are not finished: the **UI changes** (landing and
being tested) and the **demo database**. This document is the part that does not have to wait —
the plan, the asset inventory and the capture mechanism — so that the creation run itself is
mostly execution.

Owner: John. Planned creation run: the **HyperFrames** skill (`/hyperframes`), which renders
video from HTML and can carry captured app footage, titles, callouts and captions.

**Confirmed 2026-10-07:** a **2–3 minute feature walkthrough** with **scripted voiceover**, shipping
as a **16:9** cut (README hero + landing page) and a **1:1** cut (social feed).

> This file is a _plan_, not a `BRIEF.md`. HyperFrames writes its `BRIEF.md` as the first action
> after `hyperframes init`, and `init` refuses a non-empty directory — so the video project lives
> in its own empty directory (proposed: `demo/`) and this plan stays out of it.

---

## 1. What the video is

A **product showcase and feature walkthrough for AllTheRepos**, built from the app's own captured
screens, in the app's own dark, code-and-terminal look.

| Field     | Decision                                                             | Basis                                                                                                                                                                                                                        |
| --------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow  | `/product-launch-video`, **no-capture mode**                         | The route contract covers "a product-launch script with no derivable site"; there is no site to scrape, and its show-it-as-is clause makes the app's own captured screens the featured assets rather than a route of its own |
| Message   | _"Which repo was that?" — answered in one window, on your machine_   | The README's own positioning, verbatim                                                                                                                                                                                       |
| Length    | **2:30 target, 3:00 hard cap**                                       | The specialized narrative routes are strongest at 30–90s and cap near 3 min; going longer means `/general-video` instead                                                                                                     |
| Aspect    | **1920×1080 (16:9)** primary · **1080×1080 (1:1)** social cut        | Confirmed destinations: README hero + landing page, and the social feed                                                                                                                                                      |
| Narration | **Scripted voiceover** (~340 words at ~135 wpm) over a music bed     | Confirmed; music ducks under the VO                                                                                                                                                                                          |
| Captions  | Burned in on the 1:1 cut; optional `.srt` for the 16:9 cut           | Social feeds autoplay muted; the README hero is often muted too                                                                                                                                                              |
| Review    | **Storyboard first** (`storyboard.html` sketch pass), then the build | Mandatory at this length — a 2:30 VO piece is far too expensive to discover the shape of at the render                                                                                                                       |

### The aspect consequence (surfaced now, not at the sketch pass)

The app is a **wide, text-dense desktop window**. Dropping a 1440×900 catalog whole into a 1080×1080
square leaves the repo names somewhere around 9–10pt on a phone — the exact failure the route's
integration check exists to catch.

So the 1:1 cut is **not a rescale of the 16:9 cut.** It is a designed square stage: brand
background, the app window inset as a cropped/zoomed "device" frame, with each beat reframed onto
the one element the VO is talking about (the search field, a language bar, one tag chip). That
means the capture harness should record at a **higher resolution than 1080p** so the square cut has
real pixels to crop into, and it means the storyboard needs a 1:1 column as well as a 16:9 one.

### Narration arc (~2:42 video, 2:28 of speech, 10 beats)

One idea per beat, each showing a real screen. The **locked spoken lines live in
[`demo-video/SCRIPT.md`](demo-video/SCRIPT.md)** — that file is the commit; this table is the
outline, and the times are the schedule measured from it (333 words at 135 wpm plus a ~1.4s hold
a beat), not round numbers.

| #   | Beat                  | Time      | Screen                                                          |
| --- | --------------------- | --------- | --------------------------------------------------------------- |
| 1   | Cold open             | 0:00–0:16 | Type over dark                                                  |
| 2   | What this is          | 0:17–0:34 | The catalog, settled                                            |
| 3   | The scan              | 0:35–0:52 | Rail → add root → Scan → grid fills                             |
| 4   | Search                | 0:54–1:08 | Type a half-remembered word                                     |
| 5   | Triage at a glance    | 1:10–1:32 | Recency ramp, language bar, dirty/missing marks, ownership      |
| 6   | Your vocabulary       | 1:33–1:44 | Tags, favourites, groups, per-repo notes, a project's own tasks |
| 7   | Curated links + graph | 1:45–2:02 | `/graph`, then the MCP server                                   |
| 8   | It keeps up           | 2:04–2:15 | Folder rail, live file watching                                 |
| 9   | Local-first, provably | 2:16–2:30 | Settings                                                        |
| 10  | Close                 | 2:31–2:41 | `⌘K` palette → logo → downloads line                            |

**Honesty constraint on the script:** the app is **alpha**, macOS/Apple-silicon only, and ad-hoc
signed (not notarised) until ATR-046 lands. The README is scrupulous about this. The VO should not
claim a notarised one-click install the app cannot yet deliver — say "macOS, in alpha" and let the
README/`READ-ME-FIRST.txt` carry the first-launch steps.

---

## 2. What already exists (verified 2026-10-07)

Almost all of the raw material is already in the repo — this is the good news, and the reason
pre-production is worth doing now.

| Asset                         | Where                                                                           | What it gives the video                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Demo library**              | [`scripts/make-readme-shots.mjs`](../scripts/make-readme-shots.mjs)             | **36** invented repos across **10** groups (`design`, `services`, `infra`, `graphics`, `labs`, `web`, `mobile`, `hardware`, `toolbox`, `archive`), spread over **4 scan roots** (`work`, `projects`, `oss`, `sandbox`) — so the rail's "Scanned folders" anchor list, its per-root counts and the per-root rescan all have something to show. **24 languages**, recency from two hours to two years, two dirty trees, five local-only repos, three repos cloned from somebody else, **two favourites**, and one repository that is in the catalog but **missing from disk**. The seed writes the **10 groups**, **23 curated links** (`depends-on` / `related` / `supersedes` / `forked-from`) and the four scan roots, so the map beat has a map and the vocabulary beat has groups rather than an empty chip row                  |
| **Repo manifests**            | same file, each row's `files`                                                   | The demo repos are not README-only shells: each declares the files it would really have (`package.json`, `go.mod`, `Makefile`, `Cargo.toml`, `pyproject.toml`, `mix.exs`, `Package.swift`, …). Two things depend on that being true rather than asserted. `tasks.ts` reads those files to build the **task list** beat 6 is cut against (**30 of the 36 rows** yield at least one task, which is exactly the bar the suite asserts), and `tag.ts` derives the **heuristic tags** the detail rail shows as read-only badges beside your own — the half of the tag panel that a library of user tags alone leaves empty. `tests/unit/scripts/make-readme-shots.spec.ts` runs the app's own `inferTags` and `detectTasks` over each row's files, so a demo tag the app would not derive fails the suite instead of bending the footage |
| **Capture harness**           | `scripts/make-demo-video.mjs`                                                   | The moving-picture sibling of the shots script — one recorded clip per beat, the same throwaway profile and the same guard, driven through Playwright. Writes `captures/demo-video/*.webm` plus a `manifest.json` that binds each clip to a script line. **Built and run 2026-10-07** (see §3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Throwaway-profile harness** | same file                                                                       | Launches the real app with `--user-data-dir` at a temp path and refuses to publish shots if **any** repo outside the demo library is on screen. The video needs the same guard: this repository is private and the published artifact is not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Electron-native seeding**   | same file, `--seed` mode                                                        | Writes rows under `ELECTRON_RUN_AS_NODE=1 <electron>` because `better-sqlite3` is built for Electron's ABI, not host Node's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Screenshot capture**        | same file                                                                       | Playwright `_electron` driving the real app; `docs/images/catalog.png`, `command-palette.png`, `settings.png` at 1440×900                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Brand tokens**              | [`design-system/alltherepos/MASTER.md`](../design-system/alltherepos/MASTER.md) | Palette (`#0F172A` bg, `#22C55E` accent), IBM Plex Sans body + JetBrains Mono headings, shadow/spacing scales, the "Dark Mode (OLED)" mood — the video's design spec, already written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Fonts**                     | [`src/renderer/fonts/`](../src/renderer/fonts/)                                 | IBM Plex Sans + JetBrains Mono are bundled in-repo, so the composition needs no webfont fetch and renders identically offline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **App icon**                  | [`resources/icon.png`](../resources/icon.png), `resources/icon.icns`            | The mark for the title card and the close                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Marketing copy**            | [`README.md`](../README.md)                                                     | The positioning, the feature claims and the honest alpha/disclosure language are already written and fact-checked — reuse the wording rather than inventing new claims                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Disclosure text**           | [`docs/COMMAND-DISCLOSURE.md`](COMMAND-DISCLOSURE.md)                           | Beat 9's "provably local-first" claim is backed by an actual inventory — cite it, don't gesture at it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

---

## 3. The capture mechanism — built and run (2026-10-07)

Everything above produces **stills**. A demo video needs **motion of the real app**, and as of
2026-10-07 that mechanism exists: `scripts/make-demo-video.mjs`.

It is a small extension of the harness that already existed, because Playwright's Electron
launcher takes **`recordVideo: { dir, size }`** and records the app's **web contents**. That is
exactly what a product demo wants and a desktop screen recording is not: the catalog and its
interactions, with no menu bar, no dock, no notification popups, no other windows, and no real
window title. It is also deterministic — the beats drive the UI through Playwright at human pace,
so any beat can be re-shot alone (`--beats 05`) and two runs frame the same pixels.

How it is shaped:

- **One clip per beat, one launch each.** `recordVideo` is a context option and this app is one
  context, so a launch yields one file. Relaunching per beat is slower (cold start ~22s) and buys
  the re-shoot property, which matters more at the edit.
- **Capture order is not playback order.** Beat 3 is the scan, and it is only honest against an
  _empty_ catalog — so the run clears the library, records the real scanner filling the grid from
  the git repositories on disk, then seeds the curated demo library for every other beat. A real
  scan of README-only repos yields no languages, tags or descriptions, so the other nine beats
  are shot against the curated library.
- **The guard carries over, and it checks the path.** Playwright's video records the page, and
  this repository is private while the clips are not, so every beat is checked before its app
  closes and its clip is deleted if a repository outside the demo library is on screen. The test
  is each row's **`fullPath` against `--root`**, read from the app's own `catalog:list`. Matching
  on a slug cannot work — after a real scan the scanner derives its own, while the seeded rows
  hash the path they were told to occupy — and the earlier fallback to the card's _visible name_
  was worse than useless: a card with no cover image renders the repo's **initials** before its
  name, so `lighthouse-ui` read as `LU`, and the check rejected exactly the scanned rows it existed
  to allow. Nothing noticed because every beat that had run until 2026-10-07 was seeded, so the
  guard's answer always came from the slug half. The path is both stable across the two writers and
  the property that actually matters: inside `--root` is content the harness created, outside it is
  somebody's real work.
- **Recorded above 1080p.** A window sized 1280×800 at device scale factor 2 renders 2560×1600
  genuinely — that is the frame in the file, so the 1:1 cut has pixels to crop into and the VO
  can legitimately push in on one element.
- **It writes a `manifest.json`** binding each clip to a script line, so the composition can
  match footage to the narration window without anyone re-reading the harness.
- **The scan beat starts the scan through the app's bridge, not its menu.** `scan:start` is
  single-job-at-a-time (`contracts/ipc.v1.md`), so a click per root left three "A scan is already
  running" notices on screen for the rest of the beat; called with no `paths` it scans every
  configured root in one job, which is also the honest shot for a video whose point is several
  folders.

**Verified end to end, not just written.** The native rebuild needed the `SDKROOT` workaround
(ATR-057), then `pnpm electron:build`, then real beats were recorded. The scan beat reports
`scan → done: 35/35 repos` and a grid that fills to 35 cards, and the vocabulary beat reports
`lighthouse-ui detail: 3 user tag(s), 3 inferred tag(s), 4 task(s)` before it pins the repo — so
the tags and the task list that beat 6 is cut against are demonstrated on screen rather than
assumed. Both clips are valid **VP8 2560×1600** and the guard reports no strays. The script's pure
parts (the guard, the beat list, the scan-root coverage, the frame size) have a unit test.

**A real bug fell out of running it.** The first live run of the scan beat filled the catalog with
35 rows and left the grid empty. The cause was not in the harness: nine renderer call sites
invalidated `["catalog"]`, a query key nothing has ever been registered under — the repo list lives
at `["repos", "list", …]` — and TanStack matches keys by prefix, so a finished scan, a new scan
root, a move, a folder rename, the git buttons and the live filesystem stream all invalidated
nothing. It went unnoticed because every beat that had run was seeded _before_ the app launched, so
the grid's first read already had the data. Fixed, with a source-scanning regression test; see the
Unreleased entry in [`CHANGELOG.md`](../CHANGELOG.md). The harness keeps the diagnosis it needed:
a read timeout asks the same IPC channel the grid asks and prints what it answered, and the scan
beat follows `scan:status` to its end, so a scan that errors says so instead of timing out.

**A second, subtler bug came out of looking at a frame.** With per-repo notes built, beat 6 opens the
new Notes tab on `lighthouse-ui` and the harness asserts the seeded markdown is in the editor and
that the preview rendered a heading from it — and that all passed while the frame, read by eye,
showed the autosave status reading **"Unsaved changes"** on a note nobody had touched. Seeding the
editor runs the save effect twice — once against the not-yet-loaded state, once against the loaded
note — and the first pass both scheduled a write of the still-empty text and flipped the status to
`dirty`; the second pass cancelled the write but left the status alone, and the no-op guard only
ever lifted `saving`, never `dirty`. So the note settled into a permanent claim of unsaved work.
Fixed, and beat 6 now _waits for the status to read `Saved`_ and fails the beat otherwise, because
an assertion that the note is present cannot tell you the note looks correct.

Three traps the implementation had to handle, and does:

1. **Cold start is ~22s** ([ATR-055](./REMAINING-WORK.md)). The window is created only after
   every service boots, so a naive capture opens on a blank frame. The harness must wait for the
   catalog to be genuinely ready **before** recording starts.
2. **Recording is one file per context.** Beats are therefore separate clips (one context per
   beat), or one long take that the composition trims. Ten separate clips are easier to time
   against a VO and cheap to re-shoot individually.
3. **Native ABI is broken on this machine** ([ATR-057](./REMAINING-WORK.md)) — any rebuild
   needs `export SDKROOT=$(xcrun --sdk macosx --show-sdk-path)` first, or the capture script dies
   before the app appears.

---

## 4. Pre-production checklist

- [ ] **Demo database frozen** — the demo profile the video captures must be the same one the
      shots and the demo use. Decide whether the video seeds from `make-readme-shots.mjs`'s
      `DEMO_REPOS` or from whatever the newer demo database becomes, and make one the source of
      truth for all three.
- [ ] **UI changes landed and tested** — a re-shoot is cheap, but a moving target wastes it.
- [x] **Voiceover script written** — [`demo-video/SCRIPT.md`](demo-video/SCRIPT.md): ten lines,
      **333 words**, 2:28 of speech, every count and timestamp derived rather than typed. Locked
      except for the voice itself.
- [ ] **Voice chosen and recorded** — human or synthetic; decide before the storyboard pass, since
      line length drives beat length.
- [ ] **Music bed chosen**, licensed for every destination (README, landing page, social).
- [x] **Capture script written** — `scripts/make-demo-video.mjs`:
      seed → record → drive → guard → flush, one clip per beat at 2560×1600, plus a
      `manifest.json` and a unit test for the guard. Verified end to end on 2026-10-07.
- [ ] **Storyboard** — `storyboard.html` sketch pass with **both** a 16:9 and a 1:1 column.
- [ ] **Captions** — burned in on the 1:1 cut; decide on an `.srt` for the 16:9 cut.
- [ ] **First-launch honesty** — if the close mentions installing, keep it to "macOS, alpha" until
      notarisation lands (ATR-046/ATR-048).

---

## 5. Kickoff, once unblocked

1. `npx hyperframes usage --json` — **currently reports `status: unknown` on this machine**
   (`unsupported_harness`). Re-check at kickoff; do not assume an allowance.
2. `mkdir demo` (empty — `hyperframes init` refuses a non-empty directory).
3. Run the `/hyperframes` intent layer, then `hyperframes init` and `/product-launch-video`, which
   writes `BRIEF.md` as its first action. Answer the route's must-haves — **angle**, **length**,
   **destination** — with the decisions already made above, and declare `VO_MODE: verbatim`: the
   narration is locked and must be read as written.
4. **Copy the script in** — `cp docs/demo-video/SCRIPT.md demo/SCRIPT.md`. It is the canonical
   plan-layer file, so it belongs _in_ the project, but it cannot be there before `init` runs.
5. Load `/media-use` for the design spec (the tokens above are the natural "use an existing spec"
   answer), `/hyperframes-audio` for the VO carve and the music duck, `/hyperframes-core` before
   authoring any composition HTML, and `/hyperframes-animation` for the beat transitions.
6. Storyboard pass → build → check → approval → render (16:9), then the 1:1 reframe.

---

## 6. Remaining open decisions

1. **Voice** — human or synthetic? A synthetic read is faster and re-records free when a beat
   changes; a human read is warmer and sells a developer tool better. Decide before the storyboard
   pass, because line length drives beat length.
2. **Source of the demo data** — reuse `DEMO_REPOS` as-is, or bind the video to the newer demo
   database? (See the checklist; this is the one blocker with a real dependency.)
3. **Whether the 1:1 cut ships with the 16:9 cut or after it** — simultaneous means two
   storyboard columns and every beat composed twice; sequential means the 1:1 cut is a cheap
   reframe pass once the VO and timings are frozen.
4. ~~**Per-repo notes cannot be shown, because they are not built.**~~ **Resolved (2026-10-07): notes
   are built, and beat 6 shows them.** `NEW-PLAN.md` §5.9's markdown scratchpad now ships as a
   **Notes** tab beside Details and Claude — a plain editor with a live, sanitized markdown preview,
   stored one file per repo at `{userData}/notes/<repo-id>.md` and keyed on the catalog row id. Two
   parts of the §5.9 spec were deliberately **dropped**: the optional `<repo>/.alltherepos/notes.md`
   mirror (writing inside a repository is exactly what `docs/COMMAND-DISCLOSURE.md` §4 promises
   never happens) and the tray quick-capture window (deferred). The demo library seeds notes on four
   repos — including `lighthouse-ui`, the repo beat 6 opens — so the beat shows a real notes surface
   rather than a blank editor, and the harness asserts both that the editor holds the seeded markdown
   and that the preview rendered a heading from it. This was the last open decision that was a
   _build_ rather than a _choice_; the rest of this list is scheduling.
