# Launch posts — Facebook and Reddit

Draft posts for the 0.4.0 launch, written to be pasted as they are. Not linked from `README.md` or
`START-HERE.md`: this is the copy, not part of the project's documentation.

Last checked against the shipped build on **2026-10-25**. If a number or a limitation here stops
being true, the post is wrong — fix the post, do not soften it in the comments.

## What the posts may claim

| Claim                                                                  | Where it is true today                                                                                                                              |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version 0.4.0, published 2026-10-25                                    | [`alltherepos-releases` v0.4.0](https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.4.0) — DMG 129,418,374 bytes, plus the update feed |
| Per-repo markdown notes, stored in the app's own directory             | [`src/main/services/notes.ts`](../src/main/services/notes.ts) — one file per repo at `{userData}/notes/<repoId>.md`, keyed on the catalog row          |
| This repository's Releases tab points at the download                  | [`AllTheRepos` v0.4.0](https://github.com/ivy00johns/AllTheRepos/releases/tag/v0.4.0) — a signpost page with no assets, so it cannot drift from the feed |
| Free, MIT licensed, source public                                      | [`LICENSE`](../LICENSE); `github.com/ivy00johns/AllTheRepos`                                                                                        |
| macOS, Apple silicon only                                              | the DMG is `arm64`; there is no Intel, Windows or Linux build                                                                                       |
| Ad-hoc signed, **not** notarised                                       | the release notes and `READ-ME-FIRST.txt` inside the DMG both say so                                                                                |
| No account, no telemetry, one SQLite file on your disk                 | [`docs/COMMAND-DISCLOSURE.md`](./COMMAND-DISCLOSURE.md) inventories every command, write and request                                                |
| The updater is the only automatic network call                         | same document; the check is anonymous and hands you the release page                                                                                |
| Full-text search by default, vector ranking when Ollama runs           | `src/main/services/search.ts`; without Ollama the results say they are keyword-only                                                                 |
| MCP server for coding agents, added by hand                            | [`mcp/README.md`](../mcp/README.md) — the app never starts it                                                                                       |
| Groups can be filled, and a filter can be saved as one                 | three doors (detail panel, toolbar over a selection, create-and-fill) and two ways to remove; gated by `tests/e2e/groups-flow.spec.ts`              |
| ~3 seconds to the shell (measured, 6.6s before)                        | `scripts/measure-cold-start.mjs`, recorded in the 0.2.0 changelog                                                                                   |

Do **not** claim: notarised install, a one-click first launch, "open source" without naming MIT,
Windows or Linux, or that the demo video shows notes.

Groups **are** fillable in this build — ATR-043 closed on 2026-10-22. A group is filled from the
repo's own panel, from a selection in the toolbar, or in one step when it is created; a saved
filter is a group defined by a rule instead of a list. The older DMGs still in the releases
repository can do none of that, so every link in these posts has to point at **v0.4.0**.

Notes are new in this build, and they are the honest headline for 0.4.0. Every repository's panel
has a **Notes** tab beside Details and Claude: a plain markdown editor with a live preview rendered
through the same sanitized allowlist a README gets, autosaved a moment after you stop typing — the
status line reads `Saving…`, then `Saved`, and shows the error text when a write is refused. The
file is one per repository in the app's own data directory, keyed on the catalog row rather than the
path, so a note follows a repository you move. It is never written inside your repository; that
write is exactly what the command disclosure says does not happen. Clearing the editor empties the
file rather than deleting it, because this app has no delete.

The other thing worth saying out loud: this repository's Releases tab is no longer empty. It used
to show nothing while the binaries lived on another page, which read as "nothing has shipped, build
it yourself" and was the most common confusion around 0.3.1. Every tag now writes a page here that
leads with the download link, explains why the build lives on the releases-only repository, and
says the **Source code (zip)** and **(tar.gz)** rows GitHub appends are the tree rather than an
installer. Nothing is attached to it, on purpose.

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
> rule. Every repo has a notes scratchpad now too — markdown with a live preview, autosaved, stored
> in the app's own folder rather than inside your repository. No account, no telemetry, no cloud
> index.
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
> search still works and says the results are keyword-only. Groups and saved filters are new-ish
> (0.3.1); notes are new in the build you just downloaded — a markdown editor and a live preview
> per repository, one file inside the app's data directory, autosaved as you type. There is a small
> MCP server beside it so a coding agent can read the catalog and the links between repos, but you
> install that yourself — the app never starts it.

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
> by a rule, a markdown notes scratchpad per repo, curated links between repos you know belong
> together, a relationship map, `⌘K` for everything, a spotlight window that does not raise the main
> window, and a menu-bar presence with a dock badge for the dev servers it detects.
>
> **What it does not do.** No account, no telemetry, no cloud index — the catalog is one SQLite
> file in `~/Library/Application Support/AllTheRepos/`. Every git command, filesystem write and
> network request the app can make is inventoried with file and line citations in the repository's
> command disclosure. Notes obey that: one markdown file per repository inside the app's own data
> directory, never inside a repository. The only automatic call is an anonymous update check
> against GitHub, and it hands you the release page rather than installing anything.
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
> The source repository's Releases tab now carries a page that points at the download rather than
> at nothing, so if you land there first it will get you to the right place.
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
> ownership, dev servers, tags, groups, saved filters, a markdown note per repo, and a link map
> between repos.
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
- [ ] Check that every link lands on **v0.4.0**: the DMG name carries the version, and a saved
      `…/releases/latest` URL is fine only while 0.4.0 is the newest release.
- [ ] Upload the demo video natively on both platforms. Facebook throttles link posts; Reddit's
      video player is what people press.
- [ ] Watch the film once before you upload it. It was cut before the Notes tab shipped, so nothing
      in it shows notes — introduce it as the tour, not as a notes demo.
- [ ] Post from your own account on a weekday morning US time, then stay in the thread for the
      first two hours. Both platforms weight early replies, and "dev answered every question" is
      the difference between a launch and a link drop.
- [ ] Check the room's rules before posting: r/macapps allows developer posts that disclose they
      are the developer; r/programming and r/webdev do not, and a removed post costs you the
      account's standing. r/SideProject exists for this.
- [x] Point the repo's GitHub *Website* field and its topics at the release page before posting, so
      the sidebar of the source repo offers a download instead of nothing. Done on 2026-10-25:
      *Website* is `…/releases/latest`, which follows its redirect to the newest tag — `v0.4.0` as
      of this writing — and the topics are `macos`, `apple-silicon`, `electron`, `git`,
      `local-first`, `sqlite`, `fts5`, `developer-tools`, `repository-management` and `typescript`.
      Neither is a file, so this line is the repository's only record of the setting.
- [ ] Have the two answers ready before anyone asks: **why is it 129 MB** (Electron, with the fonts
      and the map renderer bundled) and **why does macOS say it is damaged** (it is not — it is
      un-notarised, and the Open Anyway step is the fix).

## Still true, and worth saying out loud in the thread

Notarisation (ATR-046) is the one launch gap no amount of writing fixes: it needs a paid Apple
Developer Program membership, and until then every first launch costs a person a trip to System
Settings. Everything else on this page is copy; that one is a purchase.
