<!-- Draft launch post, written for Show HN. Not linked from README.md or START-HERE.md yet. Assumes the source is still private, so it names the disclosure document and the ledger without linking them; link both if the repository goes public before this ships. -->

# AllTheRepos

## Show HN: one window for every git repository on your machine

I keep a few dozen git repositories spread across `~/Projects`, `~/Work` and an archive folder. Every week or so I need something from one of them and can't remember which. Finder search is the wrong tool, grepping all of them is slower, and my editor only knows the folders I happened to open.

AllTheRepos is a macOS desktop app that solves that one problem. Point it at the folders where you keep code. It walks them, indexes every repository it finds into SQLite with FTS5 full-text search, and gives you one window to search, filter, tag and open them. When Ollama is running it also embeds the repositories and ranks results by meaning; when Ollama is not running, search falls back to FTS5 instead of failing.

Once it has scanned, you get:

- One search field over every repository at once, with a folder rail, so `~/Work` and `~/Archive` are filters rather than separate apps.
- Tags, favourites, groups, and curated links between repositories you know belong together, drawn as a relationship map.
- An activity ramp from "minutes ago" to "dormant", so the repo you touched yesterday looks different from the one you abandoned in 2023.
- Ownership marks derived from the git remote, so a clone of somebody else's project cannot be mistaken for your work.
- Dev-server and port detection for the repositories you actually have running, and a dock badge that counts them.
- `⌘K` for everything, a global spotlight window for a search that does not raise the main window, and a menu-bar presence.

## What it does to your machine

The app touches your whole repository collection, so the part worth reading is the disclosure. There is no account, no telemetry and no cloud index: the catalog is one SQLite file inside `~/Library/Application Support/AllTheRepos/`. Every git command, filesystem write and network request the app can make is inventoried with file and line citations in the repository's command disclosure. The entire git surface is nine `simple-git` methods, and two of them write anything (`git fetch --prune` and `git pull --ff-only`). No destructive git command exists in the codebase, nothing deletes a file you own, and nothing fetches or pulls on a timer. If you find behaviour that document does not list, that is a bug, and I want to hear about it.

There is also an MCP server beside the app, so a Claude Code session can read the catalog and record how repositories relate to one another. Six tools, two of which write, both of them to the same `repo_links` table. The app never starts that server; you install and launch it yourself.

## What alpha means here

This is pre-1.0 and it shows in specific, known ways:

- The build is ad-hoc signed and not notarised, because notarisation needs an Apple Developer Program membership. macOS refuses the first launch, and you allow it once through **System Settings → Privacy & Security → Open Anyway**. The DMG carries those steps in `READ-ME-FIRST.txt`, because once the launch has been refused there is nothing on screen that could explain anything.
- The updater checks for new versions anonymously, then hands you the release page. It does not install updates on an ad-hoc build, and it says so in Settings rather than offering an install macOS would refuse.
- Cold start is about 22 seconds: the main window waits for every service to finish booting before it is created. It is measured and filed, and the fix is designed but not written.
- Apple silicon only. Linux and Windows are not started.
- The source is private for now, the downloads live in a public releases-only repository, and there is no license file yet, so nothing here grants reuse rights.

## Try it

1. Download the `.dmg` from the [releases repository](https://github.com/ivy00johns/alltherepos-releases/releases/latest). The `.zip`, `.blockmap` and `latest-mac.yml` next to it are the update feed, not a second installer.
2. macOS will refuse the first launch. Open **System Settings → Privacy & Security** and click **Open Anyway**, the way `READ-ME-FIRST.txt` inside the DMG describes.
3. In the app, add a folder that contains repositories (the rail's *Add folder to scan*).
4. Press **Scan**, then use the top-bar field or `⌘K`.

The screenshots in the README are generated, not staged. A script launches the real app against a throwaway profile seeded with demo data, and refuses to write the images if any repository outside that demo data appears on screen.

## Why

Built nights and weekends, and given away. No account, no paid tier, no telemetry. If it saves you one "which repo was that?", star the releases repository, tell somebody with a folder full of mystery repositories, or file a concrete bug. If something breaks, the tactical ledger in the repository is the list of what is already known to be broken, and it is longer than I would like.
