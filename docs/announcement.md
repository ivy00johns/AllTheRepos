# Launch posts — Facebook and Reddit

Draft posts for the 0.3.0 launch, written to be pasted as they are. Not linked from `README.md` or
`START-HERE.md`: this is the copy, not part of the project's documentation.

Last checked against the shipped build on **2026-10-24**. If a number or a limitation here stops
being true, the post is wrong — fix the post, do not soften it in the comments.

## What the posts may claim

| Claim                                                         | Where it is true today                                                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version 0.3.0, published 2026-10-24                           | [`alltherepos-releases` v0.3.0](https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.3.0) — DMG 129,407,205 bytes, plus the update feed |
| Free, MIT licensed, source public                             | [`LICENSE`](../LICENSE); `github.com/ivy00johns/AllTheRepos`                                                                                        |
| macOS, Apple silicon only                                     | the DMG is `arm64`; there is no Intel, Windows or Linux build                                                                                       |
| Ad-hoc signed, **not** notarised                              | the release notes and `READ-ME-FIRST.txt` inside the DMG both say so                                                                                |
| No account, no telemetry, one SQLite file on your disk        | [`docs/COMMAND-DISCLOSURE.md`](./COMMAND-DISCLOSURE.md) inventories every command, write and request                                                |
| The updater is the only automatic network call                | same document; the check is anonymous and hands you the release page                                                                                |
| Full-text search by default, vector ranking when Ollama runs  | `src/main/services/search.ts`; without Ollama the results say they are keyword-only                                                                 |
| MCP server for coding agents, added by hand                   | [`mcp/README.md`](../mcp/README.md) — the app never starts it                                                                                       |
| Groups can be filled, and a filter can be saved as one        | three doors (detail panel, toolbar over a selection, create-and-fill) and two ways to remove; gated by `tests/e2e/groups-flow.spec.ts`              |
| ~3 seconds to the shell (measured, 6.6s before)               | `scripts/measure-cold-start.mjs`, recorded in the 0.2.0 changelog                                                                                   |

Do **not** claim: notarised install, a one-click first launch, "open source" without naming MIT,
or Windows or Linux.

Groups **are** fillable in this build — ATR-043 closed on 2026-10-22. A group is filled from the
repo's own panel, from a selection in the toolbar, or in one step when it is created; a saved
filter is a group defined by a rule instead of a list. The 0.2.0 DMG still in the releases
repository can do none of that, so every link in these posts has to point at **v0.3.0**.

## Facebook

Facebook is the warmer room: write as yourself, not as a brand. **Upload the demo video natively**
(the file is `docs/demo-video/alltherepos-demo.mp4`, 3.4 MB, 91 seconds) and put the links in the
first comment — a post whose only content is an outbound link reaches almost nobody.

> I built a small thing for a problem I kept having, and it is finally good enough to hand to
> other people.
>
> I keep a few dozen git repos across ~/Projects, ~/Work and an archive folder. Every week or so I
> need something from one of them and I cannot remember which. Finder is the wrong tool, grepping
> all of them is slower, and my editor only knows the folders I happened to open.
>
> AllTheRepos points at the folders where you keep code and indexes every repository it finds into
> one SQLite file on your disk. One window to search, filter, tag, group and open them: recency,
> language, dirty trees, which ones are clones of somebody else's work, which ones have a dev server
> running. Groups are lists you fill by hand; a saved filter is a group that fills itself from a
> rule. No account, no telemetry, no cloud index.
>
> It is macOS on Apple silicon, it is alpha, and it is free — MIT, source on GitHub.
>
> One honest warning: I do not have an Apple Developer membership, so the build is not notarised
> and macOS will refuse the first launch. You allow it once through System Settings → Privacy &
> Security → Open Anyway and it behaves after that. The DMG has the steps in a READ-ME-FIRST.txt
> because once the launch has been refused there is nothing on screen that can explain it.
>
> Download: github.com/ivy00johns/alltherepos-releases/releases/latest
> Source: github.com/ivy00johns/AllTheRepos

First comment:

> For the curious: it is Electron, so the DMG is 129 MB. Search is SQLite FTS5; if you happen to
> run Ollama it also embeds the repos and fuses vector ranking into the results, and if you do not,
> search still works and says the results are keyword-only. Groups and saved filters are new in
> this build. There is a small MCP server beside it so a coding agent can read the catalog and the
> links between repos, but you install that yourself — the app never starts it.

## Reddit

Two posts, one room each. Do not paste the same text into both on the same day; that pattern is
what the spam filters are looking for.

### r/macapps

**Title:** AllTheRepos — a local-first Mac app to search every git repo on your disk (free, MIT, alpha)

> I have 271 git repositories on this machine across four scan roots, and I could not reliably
> answer "which repo was that?" — so I built the app I wanted.
>
> **What it does.** Point it at the folders where you keep code. It walks them in a worker thread,
> indexes every repository into one SQLite file (FTS5, plus sqlite-vec if Ollama is running) and
> gives you one window to search, filter, tag and open them. The grid carries the things you would
> otherwise ask git one repo at a time: when you last touched it, what it is written in, whether
> the tree is dirty, whether the folder has moved, and whether it is yours, a clone, or local-only.
> On top of that: tags, favourites, groups you fill by hand, saved filters that are groups defined
> by a rule, curated links between repos you know belong together, a relationship map, `⌘K` for
> everything, a spotlight window that does not raise the main window, and a menu-bar presence with
> a dock badge for the dev servers it detects.
>
> **What it does not do.** No account, no telemetry, no cloud index — the catalog is one SQLite
> file in `~/Library/Application Support/AllTheRepos/`. Every git command, filesystem write and
> network request the app can make is inventoried with file and line citations in the repository's
> command disclosure. The only automatic call is an anonymous update check against GitHub, and it
> hands you the release page rather than installing anything.
>
> **The part you will hit first.** The build is ad-hoc signed and not notarised, because
> notarisation needs an Apple Developer Program membership I do not have. macOS will refuse the
> first launch. The way through is **System Settings → Privacy & Security → Open Anyway** after
> trying to open it — the right-click → Open shortcut older macOS accepted is gone in macOS 15.
> That is one time per install; every launch after it is a normal double-click. The DMG carries a
> `READ-ME-FIRST.txt` with exactly those steps, and the app explains itself once inside.
>
> It is **alpha**: Apple silicon only, no Windows or Linux, and the repo keeps a tactical list of
> what is known to be broken rather than pretending the list is empty. Several surfaces are still
> rough — a catalog of a few hundred repos draws every card instead of virtualizing the grid, and
> the Claude Code tab only shows what it can read from `~/.claude`.
>
> Free, MIT, source and issues here: <repo link>
> Download (DMG, 129 MB): <releases link>
>
> Happy to answer anything about how it scans, what it writes, or why the DMG is that big.

### r/SideProject

**Title:** I built a local-first Mac app to find the repo I forgot the name of (free, MIT)

> Same app, shorter post: years of side projects scattered over four folders, and no way to
> answer "which one had that queue worker in it?". AllTheRepos indexes every git repo under the
> folders you point it at, then gives you one searchable window — recency, language, dirty trees,
> ownership, dev servers, tags, groups, saved filters and a link map between repos.
>
> It is alpha, Apple silicon, and not notarised (macOS needs one Open Anyway from System Settings
> on first launch). Free and MIT.
>
> 90-second demo with no voiceover fluff: <video>
> <repo link> · <releases link>

## Before posting

- [ ] Install the published DMG the way a stranger would: download it in a browser, mount, drag to
      Applications, launch, take the refusal, do the Open Anyway step, then scan a folder and
      search. Nothing in this repository can prove that path works on somebody else's Mac.
- [ ] Check that every link lands on **v0.3.0**: the DMG name carries the version, and a saved
      `…/releases/latest` URL is fine only while 0.3.0 is the newest release.
- [ ] Upload the demo video natively on both platforms. Facebook throttles link posts; Reddit's
      video player is what people press.
- [ ] Post from your own account on a weekday morning US time, then stay in the thread for the
      first two hours. Both platforms weight early replies, and "dev answered every question" is
      the difference between a launch and a link drop.
- [ ] Check the room's rules before posting: r/macapps allows developer posts that disclose they
      are the developer; r/programming and r/webdev do not, and a removed post costs you the
      account's standing. r/SideProject exists for this.
- [ ] Point the repo's GitHub *Website* field and its topics at the release page before posting, so
      the sidebar of the source repo offers a download instead of nothing.
- [ ] Have the two answers ready before anyone asks: **why is it 129 MB** (Electron, with the fonts
      and the map renderer bundled) and **why does macOS say it is damaged** (it is not — it is
      un-notarised, and the Open Anyway step is the fix).

## Still true, and worth saying out loud in the thread

Notarisation (ATR-046) is the one launch gap no amount of writing fixes: it needs a paid Apple
Developer Program membership, and until then every first launch costs a person a trip to System
Settings. Everything else on this page is copy; that one is a purchase.
