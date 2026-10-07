# Changelog

Notable changes, newest first. The section for a version is what gets attached
as that release's notes — `scripts/release-notes.mjs` refuses to let a release
go out without one — so write the entry in the same commit that bumps the
version.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versions
follow [SemVer](https://semver.org/spec/v2.0.0.html). `package.json` is the
source of truth for the current version.

## [Unreleased]

## [0.1.4] - 2026-10-07

### Changed

- seed the e2e profiles from a catalog instead of your own library
- The Electron e2e suite runs against a seeded catalog instead of your own library. Global
  setup migrates a throwaway profile, seeds three synthetic repos into it (each with a
  `CLAUDE.md` and a skill) and every spec launch copies it, so specs that want a repo card
  now click a real one rather than bailing to their empty-state branch. Doing this while
  isolating each profile also surfaced a `claude-flow` assertion that could never have
  passed — it looked for "install Claude Code" text this app does not render, which the
  empty-catalog fallback had been hiding.
- Process detection reads the host in three subprocess rounds per tick instead of one per
  parent hop per listener. The parent map is a single `ps -axo pid=,ppid=`; the cwd lookups
  are batched (32 PIDs per `lsof`, up to 4 batches in flight) for the listeners plus every
  ancestor the walk can reach; and the walk itself now runs in memory. A tick measured
  24–45s on a developer Mac and is now ~0.5s of subprocess work, so the process panel
  answers within a poll interval rather than most of a minute. The `process-flow` spec's
  detection leg went from 30s to 13ms and that spec from 1.1m to 13s.
- The process panel sweeps on demand instead of waiting for the poll interval. It now asks
  main for a fresh scan when it mounts and when its **Refresh** action is pressed
  (`process:refresh`), so a server started a moment ago is visible immediately rather than
  after the next tick — which was up to 15s away while the app was blurred. Concurrent
  callers join one sweep instead of doubling the subprocess load.

### Fixed

- match repos the catalog holds through a symlink, and sweep the port panel on demand
- read the host's listeners in three subprocess rounds, not one per hop
- stop the Electron e2e suite colliding with the app you already have open
- stop the catalog grid collapsing and unshadow the menu shortcuts
- The Electron e2e suite no longer collides with a copy of the app you already have open.
  Every spec launched against the default userData directory, so
  `requestSingleInstanceLock` found the running app holding the lock, took the `app.quit()`
  branch, and exited 0 before a window existed — which Playwright reports only as "Target
  page, context or browser has been closed", indistinguishable from a crash. Launches now
  go through `tests/e2e/_launch-app.ts`, which gives each one a private `--user-data-dir`
  and deletes it again on close. The suite stops reading and writing your real catalog and
  settings as a side effect.
- A listening port is bound to its repo again. The cwd lookup ran
  `lsof -p <pid> -F n -d cwd` without `-a`, and lsof ORs its selection options — so the
  query answered with *every* process's cwd and the parser read the first line of that
  listing (`/` on a developer Mac) as the listener's own. Every row was therefore
  unattributed, which also sent each one down the full ten-hop parent walk that made a tick
  take tens of seconds. The batched lookup carries `-a`, and `process-flow` now spawns a
  server inside a seeded repo and asserts the row links to that repo's slug.
- The seeded e2e profile no longer imports your real library. A fresh profile has no
  `MIGRATED` sentinel, so the app's one-shot legacy migration copied `~/.alltherepos/` into
  the template — the "three synthetic repos" were three repos sitting on top of your whole
  catalog, and the suite depended on whose machine it ran. Global setup now claims both
  legacy sentinels before the first boot and canonicalises the temp root, so the seeded
  repo paths match the cwd the kernel reports to `lsof`.
- A repo reached through a symlink now matches its own listeners. The catalog stores
  whatever path the scanner walked — `~/Code` symlinked onto another volume, or anything
  under `/tmp` on macOS — while `lsof` reports the cwd the kernel resolved, so comparing
  them unresolved meant those ports showed no repo at all. Both sides are canonicalised
  now (memoised, so a large library does not pay for it on every scan).

## [0.1.3] - 2026-10-06

### Changed

- keep the README screenshots from looking like a temp machine
- rewrite the README around the desktop app
- generate README screenshots from a demo library

### Fixed

- let the default editor be any editor we actually detected
- make a released DMG look like the download it is
- The default editor is now actually respected. `defaultEditor` was a closed three-value
  enum (`vscode`/`cursor`/`none`), so picking any of the other twelve editors the launcher
  detects — Devin, Zed, IntelliJ, … — was rejected by settings validation and never saved.
  The enum now covers every `EditorId`, `git:openInEditor` builds a URL for all of them
  instead of a `vscode`/`cursor` switch, and the duplicate hardcoded editor radio group in
  Settings is gone in favour of the detected list (which also names the app on the repo
  detail button).
- `defaultTerminal` was being silently dropped by settings validation, so the "Default
  terminal" picker persisted nothing.
- The release body now opens with a named `.dmg` download link (and its SHA-256). The
  asset list put `…-mac.zip` first, so a release that shipped a DMG read as a release that
  shipped a zip — and the two source archives GitHub appends made it worse.
- Release notes no longer begin with pnpm's `> script` banner, which was being captured
  into the notes file and published as the first thing on the release page.

## [0.1.2] - 2026-10-06

### Fixed

- see draft releases when verifying an upload

## [0.1.1] - 2026-10-06

### Added

- `pnpm release:next` derives the next version and its changelog section from
  the commits since the last `v*` tag — the level by conventional-commit rules,
  hand-written `[Unreleased]` bullets merged in rather than replaced — and only
  writes, commits and tags with `--write --tag`. Bumping the version was the
  last step that could go wrong quietly.
- `pnpm release:verify` reads a published release back and fails if the DMG,
  the ZIP or `latest-mac.yml` is missing, if the tag disagrees with
  `package.json`, or if the manifest names a version or file the release does
  not carry. CI runs it twice: on the draft, before it can be seen, and again
  once published.

### Changed

- record the first green CI run, and narrow the tag caveat
- record that the first CI run is blocked, not pending
- warn that a re-run can pass without uploading
- document the opt-in packaged update check
- verify the packaged app's update check against the live feed
- Update checks read a public releases repository, so they work for anyone who
  installs the app. Previously the feed was private and the app needed a GitHub
  token on the machine, which meant a copy on anyone else's Mac could never
  check.
- Releases are built and published by CI on a `v*` tag, with the changelog
  section below as the release notes.

## [0.1.0] - 2026-10-06

The first version with a release pipeline. Everything below reached the tree
well before this file existed; this entry is the backfill.

### Added

- **Catalog** — filesystem scanner with a debounced live watcher, folder
  grouping on disk, repo moves that survive through a relocation journal,
  favorites, covers, per-repo tasks, and a table view built for triaging
  hundreds of repos.
- **Claude integration** — per-project usage trends, a transcript viewer, and
  MCP server detection, on top of the existing process and launcher services.
- **Relationship map** — a `/graph` canvas over derived signals (shared
  libraries, references, submodules, owner, naming) with curated links folded
  in at the highest weight.
- **MCP server** (`mcp/`) — six tools (`find_repos`, `get_repo`, `get_map`,
  `link`, `unlink`, `list_links`) so a Claude Code session can read the
  catalog and curate relationships.
- **Curating from the app** — the repo detail panel and the map's inspector
  assert and remove links themselves, stamped with their origin, with the same
  rules the MCP enforces.
- **Updates** — a GitHub Releases feed checked on launch and from Settings,
  with an "Update to X" affordance. Installing stays manual: this build is
  ad-hoc signed, and macOS refuses to apply an update that isn't validly
  code-signed.

### Changed

- Repos are addressed by path, not slug, below the UI, so identity survives a
  rename or a move.

### Fixed

- Tag search was missing freshly-scanned rows: the FTS insert trigger wrote an
  empty tag column, so a repo only became findable by tag after a later
  update. Triggers are recreated on every boot, which repairs existing
  databases rather than only new ones.

### Notes

- macOS only, Apple silicon, ad-hoc signed. A downloaded DMG needs one
  right-click → **Open** on first launch.
- Native modules are rebuilt per runtime ABI; `pnpm test` (host Node) and
  `pnpm test:electron-e2e` (Electron) each put the tree in the state they need.

[Unreleased]: https://github.com/ivy00johns/AllTheRepos/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.4
[0.1.3]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.3
[0.1.2]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.2
[0.1.1]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.1
[0.1.0]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.0
