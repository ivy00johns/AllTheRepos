# Changelog

Notable changes, newest first. The section for a version is what gets attached
as that release's notes — `scripts/release-notes.mjs` refuses to let a release
go out without one — so write the entry in the same commit that bumps the
version.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versions
follow [SemVer](https://semver.org/spec/v2.0.0.html). `package.json` is the
source of truth for the current version.

## [Unreleased]

### Added

- The update feed is checked on a schedule as well as on demand. It has its own workflow,
  `.github/workflows/updater-feed.yml`, for the reason the link check left `ci.yml`: it is a gate
  that has to run when *nothing here changed*, because a feed rots on its own — a release
  deleted, its assets re-uploaded under new names, the releases repo turned private — and every
  one of those is invisible to a trigger that only fires on a push. `release.yml` is tag-push
  and dispatch, so a schedule there would wake the whole release pipeline once a week to fire
  one job that needs nothing built. It now runs weekly (Mondays, 13:30 UTC, half an hour behind
  the link check's own sweep) and on any change to what it reads: the check itself, the manifest
  parser and repo lookup it reuses, and the `electron-builder.yml` publish block that is the
  feed's address. Running it by hand is `gh workflow run updater-feed.yml`. A rate limit or a lost
  network is reported and does not fail the run, because a runner shares its address with every
  other job on the machine and an unauthenticated address gets 60 API requests an hour — the
  check went red on its own first dispatch for exactly that reason, and a gate that cries wolf is
  one people stop reading. A missing repo, or a crash, still fails: that is the checker rather
  than the world.
- A release is rehearsed every week. The whole pipeline — the tag/version guard, typecheck, the
  unit suite, the native rebuild, packaging, the upload, `release:verify` against its own draft,
  and the notes and body it would attach — now runs against `main` on a schedule (Mondays,
  14:00 UTC) as well as on demand, under a scratch version, leaving what it builds a draft that
  the same run deletes. A release pipeline is otherwise only ever exercised *by releasing*, which
  is the one moment a break in the guard, the notes step or electron-builder's configuration
  costs a version that is already tagged and pushed; now it turns up on a quiet Monday instead.
  Only a tag push can publish — inside that job "rehearse" means only "not a push", so a trigger
  added to the workflow later rehearses by accident rather than publishing by accident. It costs
  about five macOS runner minutes a week.
- A tag push launches the app it just built, and the same run walks the whole install path. The
  launch check used to be a rehearsal's alone, because only a rehearsal's build is behind the feed:
  a tag push builds the version it just published, so there is nothing newer to offer it. It runs on
  both paths now, with the opposite expectation named rather than guessed — a rehearsal's build must
  be *offered* the release that is live, and a tag push's must report that it is *on* the latest
  release. That half waits up to two minutes for `releases/latest` to name the version it published,
  because the feed is a cache and the release is seconds old, and fails only if it never arrives.
  The same spec now also verifies the **install path**, which is the half a Linux runner cannot
  reach: the archive `latest-mac.yml` names is downloaded, hashed against the sha512 the manifest
  promises, unpacked, and its bundle is handed to `codesign --verify --deep --strict`, with the
  bundle's version checked against the manifest's. A download that hashes correctly and cannot be
  launched is still a broken update, and that is the failure nobody sees until the hundred megabytes
  are already on disk. Not `spctl`: this build is ad-hoc signed and not notarised, so Gatekeeper
  refusing a downloaded copy is the documented right-click → Open rather than rot.
- A weekly digest reports whether the scheduled gates actually ran. A scheduled workflow is the one
  kind of gate that fails by *not happening* — nothing goes red, nothing is logged, the run simply
  never appears — and there are four clocks here now: the link check, the feed check, the release
  rehearsal, and this digest. GitHub disables scheduled workflows after 60 days without repository
  activity, one can be disabled by hand, a cron can be edited into a shape GitHub reads differently,
  and a `schedule:` added anywhere but the default branch never fires at all — which this repository
  has already been through once, with `release.yml`. So `.github/workflows/schedule-health.yml` runs
  every Monday at 15:00 UTC, after the 13:30 and 14:00 sweeps have had their turn, and asks GitHub
  the only question that settles it: for every workflow in the checkout that declares a `schedule`,
  when did it last produce an `event=schedule` run, and is it still `active`? The gates are read out
  of the workflow files rather than from a list of its own, so a schedule added tomorrow is covered
  the day it lands. A gate that is disabled, that GitHub has no workflow for, or that has gone longer
  than its own cadence plus a window without a run fails the digest, and the report goes on the run's
  summary so a green week says something too. A gate that could not be read is reported and does not
  fail — the same bargain the link check and the feed check strike — but a digest that cannot look at
  all, because it has no token or no `actions: read`, fails loudly: that silence is exactly what it
  exists to catch.
- A release rehearsal now launches the app it just built and makes it read the live feed, so the
  updater is exercised end to end rather than only its feed. Every other step in that job verifies
  the **upload** — the three assets exist, the manifest names them — and none of them runs the
  thing a person installs. The rehearsal is the only run that can assert this: its build is
  stamped `0.0.0`, below every release, so the app is genuinely behind the feed and must offer the
  release that is live — a version that appears nowhere in the build, and so can only have come
  from the fetch the check exists to make. It is the same opt-in
  `tests/e2e/packaged-update-check.spec.ts` a developer runs by hand, told which bundle to launch
  with `ATR_PACKAGED_UPDATE_BEHIND_BUNDLE` rather than given a second copy of the assertion; a
  bundle named that way has to exist and has to be behind the feed, because a skip there would be
  a check reporting success without having asserted anything. That is also why the scratch version
  lost its `-rehearse.<run id>` suffix: `electron-updater` reads a build whose own version carries
  a pre-release tag as being on *that* pre-release's channel and goes looking for releases tagged
  for it, so a `0.0.0-rehearse.7` build reports "No published versions on GitHub" instead of
  reading the feed. Only a rehearsal runs the step — a tag push builds the version it is
  releasing, so the feed has nothing newer to offer it, and reading `releases/latest` seconds
  after publishing would be racing GitHub.
- A release is **signed and notarised** when there is a certificate to do it with, and says which
  kind of release it is when there is not. The build was ad-hoc signed, which Apple silicon needs
  in order to execute the binary at all but which macOS refuses to *update*: Squirrel.Mac will not
  apply an update to anything that is not validly code-signed and accepted by Gatekeeper, so the
  updater could check for releases for ever and never install one. That made signing the whole
  remaining distance to a self-updating app. `electron-builder.yml` now runs a hardened runtime —
  required for notarisation, harmless for an ad-hoc build — and
  `afterSign: scripts/notarize.mjs`, which submits the bundle to Apple and then checks the result
  rather than trusting it: `xcrun stapler validate` has to find the ticket on it, because a
  signature Gatekeeper will not honour is an update that downloads and then does nothing. The hook
  reads `ATR_NOTARIZE` as `auto` (notarise a Developer-ID signed bundle whose credentials are
  complete; skip anything else), `require` (fail unless both are true — what a tag push sets, so a
  release cannot quietly publish something that looks installable and is not), or `skip`.
  Credentials are an App Store Connect API key or an Apple ID with an app-specific password, and a
  partly configured set is always an error naming what is missing rather than a silent skip.
  `scripts/signing-identity.mjs` picks the certificate — refusing "Apple Development", which signs
  a build that runs locally and cannot be notarised, and falling back to a bare `-` for ad-hoc when
  the keychain holds nothing — and `pnpm electron:dist:signed` is the local equivalent of what CI
  does. Without `CSC_LINK` the workflow still publishes and emits a `::warning::` that this release
  is not installable: a release is not blocked on a procurement decision, it is required to say
  which kind of release it is. `node scripts/notarize.mjs` reports the whole decision for a bundle
  on disk without submitting anything.
- The updater **installs** its own updates on a build macOS will let it, and explains itself on one
  it will not. Installing is now a fact about the *running* bundle rather than an assumption made
  at build time: `src/main/services/signing.ts` reads `codesign -dvvv` for a Developer ID
  authority and `spctl --assess` for Gatekeeper's verdict — which is what additionally requires
  the notarisation ticket — and the updater turns `autoDownload` on only when both agree. Off the
  bundle rather than off the config, because the two differ exactly when it matters: a build that
  silently fell back to ad-hoc because a certificate was missing, or a copy whose signature broke
  in transit. On a signed, notarised build an update now downloads, reports its progress, and
  offers **Restart to install**, which relaunches into the new version. On every other build the
  app does what it did before — it checks, it reports what it found, and it opens the release page
  — and Settings states the reason, so the affordance that is missing is explained rather than
  simply absent. It is the same classification `scripts/notarize.mjs` makes about what it submits,
  and a unit test drives both with the same fixtures so the two cannot drift apart.

## [0.1.6] - 2026-10-07

### Added

- read the update feed the way the app does, and rehearse a release
- generate the tests badge, prove the draft cleanup on demand, check links inside the repo
- The update feed is checked the way a shipped app reads it. `pnpm release:verify` inspects the
  manifest with a credential, at the moment of publishing, against the release it was just
  uploaded with — and an install does the opposite of all three: anonymously, through
  `releases/latest`, weeks later, refusing the archive unless the sha512 in the manifest matches
  the bytes it downloaded. Nothing read the feed that way, so it could rot in that gap — the
  release deleted, the assets re-uploaded under new names, the repo turned private — and the
  first symptom would be somebody's app saying nothing had ever been published.
  `scripts/check-updater-feed.mjs` now performs exactly that read, on demand (a `feed` job,
  dispatched like the drill): no credential at all, the live `latest-mac.yml`, and the archive it
  names, downloaded and hashed. Its tests assert that no request carries an `authorization`
  header even when the environment holds a token, because a check that passes only because the
  machine running it is authenticated is the failure being guarded.
- A release can be **rehearsed**. `gh workflow run release.yml -f rehearse=true` runs the whole
  pipeline — the tag/version guard, typecheck, the unit suite, the native rebuild, packaging,
  the upload, `release:verify` against its own draft, and the notes and release body a real
  release would attach — under a scratch version, leaving the result a draft that the same run
  deletes. `releases/latest` skips drafts, so nothing it creates can reach the update feed, and
  `0.0.0-rehearse.<run id>` sorts below every released `0.1.x`, so even a scratch release that
  escaped could not be offered to an install as an update. It is the same job as a release, with
  the version, the tag and the draft flag settled in one place, rather than a copy of it that
  could drift from the steps that actually ship.
- The tests badge in the README is generated instead of typed. `pnpm test:report` writes the
  suite's own totals and `pnpm badges` draws `docs/images/tests.svg` from them, and CI does
  the same thing on every push to `main` and commits the result when the counts move — so the
  number cannot drift the way a hand-written one does — this one had already drifted twice.
  `pnpm badges --check` reports a stale badge without writing it.
- The release workflow's draft cleanup is provable on demand. It is the failure path, so it
  only runs when a release has already gone wrong — the one thing that never happens on
  purpose — which makes it the code nothing exercises. A `workflow_dispatch` **drill** now
  leaves a real draft (and an asset) in the releases repo, runs the same
  `scripts/discard-draft-release.mjs` a failed release would, and fails the job if the draft
  survives; then it publishes a **pre-release**, runs the cleanup again and fails if that
  release was touched. Pre-release on purpose: `releases/latest` skips those, so a drill can    never become the release the app offers. A plain dispatch cannot publish anything — the
    release job is reachable from one only with `rehearse=true`, and what that builds stays a
    draft.
- `pnpm links:check` resolves relative links too, and runs on a schedule. A target that is not
  in the repository — or that climbs out of it — is dead, resolved from the file that names it,
  because the same `./PLAN.md` means two different files in two directories. The check moved
  out of `ci.yml` into `.github/workflows/doc-links.yml`, which runs on Markdown changes and
  **weekly**: a page upstream can rot, and a published release can be deleted, without a commit
  here, and a push trigger can never see that.

### Changed

- correct the README's test count to what CI ran

### Fixed

- make the release drill's cleanup actually reach its scratch release
- stop the link check failing on the version being released
- The release drill failed on its first dispatch, for the two reasons a drill exists to find,
  and both are now fixed. A step cannot hand `scripts/discard-draft-release.mjs` a scratch tag
  through the environment: `GITHUB_`-prefixed names are reserved, so GitHub silently keeps the
  real one — `main`, the branch a dispatch runs on — and the cleanup reported that there was
  nothing to clean up while the draft sat there. The tag now goes in as `--tag`, which no
  reservation applies to. And a release created with `--draft` has no tag of its own: GitHub
  files it under a placeholder like `untagged-2da6…`, so the drill's scratch cleanup now
  deletes the draft by release alone and only passes `--cleanup-tag` for the pre-release,
  which does own a tag.
- Two archived documents had been pointing at files that moved: `docs/archive/plan-mvp.md` at
  the design-system master, and the MCP plan at `mcp/README.md`. Found by the new relative-link
  check on its first run.
- `pnpm links:check` no longer fails on every release commit. A `chore: release vX`
  commit is pushed before its artifacts are — that is what tagging means — so the
  version link it writes to the changelog answers 404 for the minutes until the
  release workflow publishes, and the check called that rot on its first two CI
  runs. That one URL is now excused by name, because it is the release in flight
  and the workflow's own `release:verify` owns the question of whether the release
  ever appears. Everything else is judged as before, and as soon as the next bump
  moves `package.json` on, that version's link is an ordinary one again — so a
  release that never published is still caught, on the next run rather than this
  one.

## [0.1.5] - 2026-10-07

### Added

- The release workflow deletes the draft it leaves behind when a run fails partway.
  A release that only ever reached a draft is invisible to `releases/latest` and to
  `GET /releases/tags/{tag}`, so the half-uploaded state that a red build left was
  never seen by anyone — which is how `v0.1.1` sat as a draft until it was found by
  hand. A final step, on failure or cancel only, reads the release back and removes
  it while it is still a draft. A published release is never touched, and neither is
  the tag, which lives in the source repo rather than the releases repo.
- `pnpm links:check` resolves every external link in the tracked Markdown and fails on a
  404 — the failure mode that let a changelog entry point at a deleted release and a
  contract cite a page upstream had moved, for as long as anyone can tell. GitHub URLs go
  through the API, so a private repository's links are judged with a credential instead of
  being guessed at, and anything that could not be judged — a rate limit, a bot wall, a
  timeout — is reported without failing the run. It is its own CI job, because it is the
  one gate that talks to the internet.
- The release workflow's cleanup step is now guarded by a test: the step, its
  `failure() || cancelled()` trigger, and the fact that it deletes only while the API still
  reports a **draft** are asserted, and the step's own shell is run against a stub `gh` so a
  published release is proven untouched rather than assumed.

### Fixed

- repair the dangling 0.1.1 changelog link, and clean up the draft a failed release leaves
- The changelog's link for the one version that was never published points somewhere
  real again. `[0.1.1]` aimed at a release tag that does not exist, because the
  release was deleted along with its tag; it now compares against the release commit
  in the source repository. It would have been re-broken on the next bump, so
  `release:next` no longer rewrites every version link — only the ones pointing at a
  release the source repo moved away from — and a destination chosen by hand survives.
- `contracts/actions.v1.md` cited Electron's accelerator page, which upstream has since
  moved; it points at the current keyboard-shortcuts page. Found by `pnpm links:check` on
  its first run.

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

> **Never published.** This version's assets only ever reached a draft, which was
> deleted along with its tag, so the link below compares against the release commit
> in the source repository rather than a release page that does not exist.

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

[Unreleased]: https://github.com/ivy00johns/AllTheRepos/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.6
[0.1.5]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.5
[0.1.4]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.4
[0.1.3]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.3
[0.1.2]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.2
[0.1.1]: https://github.com/ivy00johns/AllTheRepos/compare/v0.1.0...2669d50b6405a84a6d9a6b5f5109750df2041f96
[0.1.0]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.0
