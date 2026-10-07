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

- gate the outward prose, with the house style kept in a config. `pnpm lint:prose` runs a vendored
  prose checker over the tree on the fast CI job, beside `pnpm lint`, and `.prose-guard.json` is
  where this project's decisions live: em dashes are deliberate, so that rule is a warning rather
  than the error it ships as — 1,200-odd of them are in the tree and none of them fails a build —
  while a banned phrase, AI vocabulary or a sycophantic opener still fails the run. `CHANGELOG.md`
  is scanned rather than skipped, because it is prose this project writes and releases. The gate
  was proved able to fail rather than only able to pass: a file carrying a banned phrase took it to
  exit 1, and removing that file took it back to exit 0.
- draft the launch post, in [`docs/announcement.md`](./docs/announcement.md), written under that
  same gate rather than exempted from it and deliberately not linked from the README until the
  wording is approved.
- review the app's UI/UX and file what the sweep found. The
  [2026-10-07 review](./docs/audits/2026-10-07-ui-ux-review.md) re-checks the six findings of the
  earlier plan (four resolved, two partly) and adds **16 ledger items, ATR-059…074**, four of them
  P1 — two accessibility blockers and two viewport-height clipping bugs, both measured against a
  real window rather than read off the source. Nothing was fixed by that sweep: it files, it does
  not touch.

### Changed

- run the fast CI job on Linux, and leave the Macs to the jobs that launch the app. `typecheck`, `lint`,
  the prose gate, the document and architecture checks and the unit suite open no window and package
  nothing, and all three native modules the suite loads build or ship for Linux — while macOS runner
  minutes bill at **ten times** the Linux rate on a private repository, which is the budget this
  pipeline actually spends. `e2e` on both Mac architectures, `refusal` and `drill` stay where they
  were, and the split is pinned by `tests/unit/workflows/ci.spec.ts`, so the tidy-up that puts every
  job back on one runner fails rather than passes. Three specs had to stop assuming a Mac before the
  suite could follow: the menu spec pins `process.platform` instead of inheriting the host's, the
  release-script fixture gives its throwaway repository a git identity instead of borrowing the
  developer's, and the two tests that bind a real listening socket stop with a reason where `lsof`
  is missing. The Ubuntu image does not carry `lsof`, so the fast job installs it — the one step
  there a developer does not run.
- put the graph page's controls back on the design system. The six signal filters are one segmented
  control, each showing how many links it holds; zoom and fit are icon buttons with accessible
  names in a single bar instead of hand-styled divs with no name at all; the map carries a counted
  summary for a screen reader; and a graph filtered down to nothing, or one that failed to build,
  offers the action that gets you out rather than a dead screen.
- state where the tree came from in one paragraph at the front door, instead of re-telling two
  waves at the length of the closure log and the ledger that own them.

### Fixed

- stop the documents praising their own honesty. Three of them described their status as an
  "honest" list and one labelled its own gaps as "stated plainly rather than glossed", while the
  evidence was already in each document.
- clear the AI vocabulary the new gate caught, in the two archived planning docs and one audit
  heading, and the "is the point" construction it found four times in `RELEASING.md`.

## [0.1.8] - 2026-10-07

### Added

- assert the sentence the app shows when GitHub refuses its own read
- fail the lint gate on a suppression that suppresses nothing
- prove the refusal check can fail, and define a refusal once
- The release pipeline opens the DMG before it publishes it. Every other gate looked at the upload or
  at the bundle on the runner — `release:verify` reads the three assets back from GitHub, and "Verify
  what was signed" runs `codesign` against `release/mac-arm64/AllTheRepos.app` — and neither of them
  ever opened the disk image, which is the one artifact a person actually installs. The failure that
  hides there is quiet: `dmg.contents` is a config block that replaces electron-builder's defaults,
  so dropping the `READ-ME-FIRST.txt` entry ships a DMG whose only instructions on a refused first
  launch are simply absent, and the first symptom would be somebody stuck at a Gatekeeper dialog with
  nothing to read. `pnpm verify:dmg` mounts the image read-only and checks that the app, the
  `/Applications` link and a `READ-ME-FIRST.txt` byte-identical to what `scripts/first-launch.mjs`
  renders are all inside it, that the bundle carries the version being released, and that it passes
  `codesign --verify --deep --strict` — then detaches the volume, because a runner that leaves one
  mounted fails the next step with a message about the disk. The release workflow runs it between the
  signing check and the draft read-back, so a bad image leaves a draft rather than a release. It was
  found by hand: v0.1.7's DMG was downloaded and mounted to confirm the file had made it in, because
  no step could answer that question.
- A release run no longer goes red because GitHub declined to answer. The launch check reads the feed
  anonymously — that is the property under test, which is why nothing in it carries a token — and an
  unauthenticated address gets 60 API requests an hour, shared with every other job on the runner. So
  a 403 or a 429 is GitHub refusing to answer rather than a verdict on the release, and the check now
  stops with a reason and a `::warning::` instead of failing: on the feed read, on the app's own read,
  and on the manifest and archive downloads. That is the rule `scripts/check-updater-feed.mjs` already
  applied — a refusal is exit 2 there and not a failure — and the same distinction the app itself
  makes when it says an anonymous check is rate-limited rather than that nothing has been published.
  What it gives up, that *this* release is the one being offered, is asserted authenticated by
  `release:verify` in the step before. It is not hypothetical: it is what turned the v0.1.7 release
  run red while the release itself was complete and correct.
- The in-app first-launch notice is rendered from the one source the other three surfaces are, so the
  last hand-written copy of those sentences is gone. Its heading and body are written once in
  `scripts/first-launch.mjs` and generated into `src/shared/adhoc-notice.ts`, which the component
  imports, and `pnpm first-launch:check` fails when that module has drifted — the same byte-for-byte
  guard the DMG's file has had since the instructions were unified. It is generated rather than
  imported because the source reads `node:fs` to compare the DMG's copy and a Chromium bundle cannot
  load that, and it lives in `src/shared/` because it is the one directory both TypeScript projects
  include. The notice composes the shared facts rather than restating them — it interpolates the
  System Settings path — so the day that procedure is named differently, all four surfaces follow:
  the file inside the DMG, the paragraph the release notes carry, the CI warning, and the notice.
- The rate-limit branch of the packaged update check is exercised on every push instead of whenever
  a runner happens to be out of API allowance. The check stops with a reason — not a failure — when
  GitHub declines an anonymous read, because a 403 says nothing about a release, and that bargain has
  one hole in it: a skip is not a pass, and the branch that skips is the branch nothing runs.
  `pnpm test:packaged-update-refused` closes it by arranging the refusal instead of awaiting it.
  `scripts/refuse-github.cjs` is required into the Playwright worker and answers every GitHub read
  with GitHub's own rate-limit 403, leaving the spec byte for byte the file the release runs — a spec
  that knew it was mocked would be a second code path, taken only here. `scripts/refused-update-check.mjs`
  then reads Playwright's own JSON report rather than the log, and fails unless the tests that read
  the feed stopped because of that refusal, said so with a `::warning::`, and nothing else in the
  suite failed. A run that skipped for the ordinary reason, or that never reached the mock, is a
  failure — which is the whole difference between covering a skip path and appearing to. It is a new
  job in `ci.yml` beside the Electron suite, because it packages the app rather than only building
  it, and because it is the one job whose apparatus has to lie about the network. One detail of the
  mock is not cosmetic: every diagnostic goes to **stderr**. Loading a file into every Node process
  in the tree also loads it into the short-lived ones other tools use for command substitution, and
  `binding.gyp` resolves an include directory with `<!@(node -p …)`, so a marker on stdout became
  part of the path handed to the compiler — the rebuild failed with `'napi.h' file not found`, which
  reads like a broken dependency and was really the mock talking.
- The rule for "GitHub declined to answer" is defined once instead of three times. The update check is
  anonymous — that is what makes it work on somebody else's machine rather than only on the one that
  built the app — so an exhausted hourly allowance comes back `403`/`429` instead of an answer about
  the release, and three separate places had to agree about what that means: the app shows a person a
  sentence for it, `scripts/check-updater-feed.mjs` exits "could not run" rather than failing, and the
  packaged update check stops with a reason rather than failing. They agreed by convention — a copied
  `isRefusal` here, another there, and a `raw.includes("401")` chain in the app — which is a three-way
  drift waiting for its first edit. `src/shared/github-refusal.json` now holds the statuses and the two
  sentences, `src/shared/github-refusal.ts` is the typed, commented view of them, and all four readers
  read it. Data rather than a module because two of those readers are plain Node scripts with no build
  step, and Node cannot import a `.ts` file on the versions this project supports: the data file is the
  one shape a script and the bundled app can both read.
- The rate-limit check now covers every test that reads the feed, and its own failure path is proven on
  a runner. The third update-check test — the one that offers a release to a build that is behind it —
  only reads the feed once it has found a bundle that is genuinely older, so the refusal job builds
  `electron:pack-older` as well and demands that this one stop for the refusal too; a missing bundle
  now fails the job rather than quietly reducing what it asserts. And because the regression worth
  fearing is the quiet one — the mock loads, refuses nothing, and every test goes green for its
  ordinary reasons — `gh workflow run ci.yml` additionally dispatches a `drill` job that runs the same
  command with `ATR_REFUSE_GITHUB=off`, and asserts the check comes back *failed*, naming the refusal.
  A check that passed, or that failed because a bundle was missing, is a failed drill.
- The sentence a person is shown when GitHub declines an anonymous check is asserted end to end,
  instead of only tolerated. The packaged update check *stopped* on the app's own refusal — the right
  answer to meeting one on a runner whose address has spent its hour — which meant the string itself
  was asserted only by its absence, by a test that would have gone on passing if the app had stopped
  producing it at all. The worker's `fetch` mock cannot reach that read: `electron-updater` builds an
  `ElectronHttpExecutor` and calls `net.request`, so it rides Chromium's network stack in the main
  process rather than the worker's `fetch`. `tests/e2e/_refused-github.ts` refuses the request where it
  is really made: it points the updater's own session at a loopback proxy, lets that session accept the
  certificate the test signs for itself, and answers inside the tunnel with the status a refusal is
  served with — read from the same shared definition as everything else. The app is not told and does
  not branch: it makes its own request, gets GitHub's own answer, classifies it with its own
  `describeError`, and renders the sentence it has always shown. A refusal met at the wrong layer does
  not look like one, which is why the test also fails on the raw error a refused `CONNECT` produces —
  `net::ERR_TUNNEL_CONNECTION_FAILED` — rather than accepting a message that merely *is* a message. It
  needs no network, so unlike the tests beside it, this one cannot be reduced by a rate limit.
- There is a linter (ATR-054). `lint` was `next lint`, it left with the Next stack, and `ci.yml`
  carried a comment explaining why it ran no linter at all. `eslint.config.mjs` is a flat config on
  `typescript-eslint`'s recommended set, wired into the fast job as `pnpm lint` — no build, no network,
  no native rebuild. Type-aware rules and nothing else: `eslint:recommended`'s `no-undef` on a codebase
  whose globals come from three tsconfigs and two Electron processes reports noise rather than
  findings, and the type-checked set is deliberately left for whoever wants to pay a second per file
  for it. The first run found fourteen real things — unused imports, a `require` reached for out of
  habit, four empty input interfaces that accept `0`, a string and an array — and twenty-seven
  `eslint-disable` comments naming rules belonging to the linter that no longer exists. All of them are
  fixed or gone, so the gate starts clean rather than starting ignored. It also fails on a suppression
  that suppresses nothing, which is how the twenty-seven were found: a dead `eslint-disable` reads as a
  decision somebody made, so the next person keeps the shape it was working around and never learns the
  rule was satisfied or has gone. Asked for in the config rather than by a flag on the command, so an
  editor's ESLint integration, a hook and CI all answer the same.

### Fixed

- The link check no longer goes red for a release that has been *prepared* and not yet pushed. A
  release leaves two links pointing at a version that does not exist yet, and only one of them was
  excused: the release page. The other is the changelog's own `[Unreleased]` link, which
  `scripts/next-release.mjs` rewrites to `compare/v<version>...HEAD` on the bump commit — so following
  the repository's own instructions, on its own tooling, left the one gate that runs on a schedule
  failing until the tag was pushed. `check-doc-links.mjs` now excuses that compare by the same rule it
  already applied to the release page: the version being released, and no other, so a compare against
  a version that has genuinely gone remains a dead link. It was found the way the DMG was: by doing the
  thing by hand.

## [0.1.7] - 2026-10-07

### Added

- explain the first launch, in the DMG and once inside the app
- sign and notarise releases, and install updates where macOS allows
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
  refusing a downloaded copy is the documented **Open Anyway** step rather than rot.
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
- A first launch that macOS refuses now explains itself, in the only two places it can
  actually be read. A downloaded copy of an ad-hoc signed build does not open: macOS shows
  *"Apple could not verify … is free of malware"* and waits for a person to allow it by hand.
  Nothing inside the app can say so at that moment, because the app is not running — so the DMG
  window now carries `READ-ME-FIRST.txt` beside the app and the Applications link, and the app
  says it once more from the inside, on the first run after you get in: a dismissable notice at
  the top of the window, remembered as `adHocNoticeDismissed` so it never returns, and never shown
  at all on a notarised build. Writing that down exposed a second problem worth naming. The
  instructions this project had been shipping — right-click the app, choose **Open** — stopped
  working in macOS 15, where Apple removed the Finder contextual-menu override that had allowed
  it, so they had been wrong for every release cut from a current Mac, including the machine this
  repository builds on. The documented procedure is now the one Apple documents: try to open the
  app, then **System Settings → Privacy & Security → Open Anyway**, then confirm the warning.
- The first-launch instructions are rendered from one source instead of written three times, and a
  guard fails the build when any page still gives the removed advice. `scripts/first-launch.mjs`
  holds the facts — the **Open Anyway** path, the macOS 15 removal of the right-click override, the
  `xattr` command — and the file inside the DMG, the paragraph the release notes carry and the
  `::warning::` a certificate-less CI run prints all render from it, so the three cannot disagree
  about what somebody has to click. They disagreed for several releases, because each carried its
  own copy: all three said right-click → **Open** after Apple had removed it, and the copy that was
  missed is the one a person reads while stuck at a launch macOS refused. `pnpm first-launch:check`
  runs in `ci.yml` on every push and pull request and does two things. `--check` fails when
  `resources/READ-ME-FIRST.txt` has drifted from what the source renders — naming the line that
  drifted, so `--write` is an obvious repair — which is what makes the file's contents a fact about
  the code rather than a promise somebody kept. And `scripts/check-first-launch-advice.mjs` reads
  every tracked Markdown, text, workflow and source file, plus the text the source renders, and
  fails on any paragraph that offers a right-click as the way to open the app. That one is a
  heuristic and it is shaped to be one people leave switched on: it fires on the sentence that
  shipped, and it stays silent on the tray's own right-click menu, which a rule that looked only at
  the words would have broken on. The four steps a person follows are unchanged; they are now
  written once.

### Changed

- write the first-launch instructions once, and hold them there
- launch the released build too, walk the install path, and digest the clocks
- launch the app a rehearsal builds and make it read the live feed
- rehearse a release every week, before a tag can find the break
- check the update feed on a clock, not only when someone asks

### Fixed

- stop the feed check going red on somebody else's rate limit

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

- macOS only, Apple silicon, ad-hoc signed. A downloaded DMG needs **System
  Settings → Privacy & Security → Open Anyway** on first launch; the right-click
  → **Open** shortcut older macOS accepted was removed in macOS 15.
- Native modules are rebuilt per runtime ABI; `pnpm test` (host Node) and
  `pnpm test:electron-e2e` (Electron) each put the tree in the state they need.

[Unreleased]: https://github.com/ivy00johns/AllTheRepos/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.8
[0.1.7]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.7
[0.1.6]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.6
[0.1.5]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.5
[0.1.4]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.4
[0.1.3]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.3
[0.1.2]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.2
[0.1.1]: https://github.com/ivy00johns/AllTheRepos/compare/v0.1.0...2669d50b6405a84a6d9a6b5f5109750df2041f96
[0.1.0]: https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.0
