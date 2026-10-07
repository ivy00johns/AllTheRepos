# Releasing AllTheRepos

How to cut a build you can install, and how updates reach you.

---

## Quick reference

```bash
pnpm release:next   # derive the next version + changelog from the commits (plan only)
pnpm release:check  # guard: tag/version agree, and the changelog has notes
pnpm release:verify # check a published release: all three assets, and coherent
pnpm icons          # regenerate resources/icon.icns from the design tokens
pnpm electron:dist  # build a local DMG + ZIP into release/ (no publishing)
pnpm release        # build AND publish to GitHub Releases (runs release:check first)

node scripts/signing-identity.mjs  # which certificate would sign a build ("-" = ad-hoc)
node scripts/notarize.mjs          # what notarisation would do to a built .app
pnpm electron:dist:signed          # a signed, notarised DMG + ZIP (needs a certificate)

gh workflow run release.yml                  # prove the draft cleanup
gh workflow run updater-feed.yml             # read the live update feed the way the app does
node scripts/check-updater-feed.mjs          # ... the same check, on this machine
gh workflow run release.yml -f rehearse=true # run the whole pipeline, publish nothing
gh workflow run schedule-health.yml          # ask whether the scheduled gates have been running
node scripts/check-schedule-health.mjs       # ... the same digest, on this machine
```

`release/` output:

| File                                  | What it's for                                                          |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `AllTheRepos-<version>-arm64.dmg`     | What a human installs                                                  |
| `AllTheRepos-<version>-arm64-mac.zip` | What the updater reads — Squirrel.Mac can't apply an update from a DMG |
| `latest-mac.yml`                      | The update manifest: version + sha512 of the ZIP                       |

All three must be attached to a release for update checks to work — which is what
`pnpm release:verify` reads back and insists on once it is published.

---

## Releasing from CI

Pushing a tag does the whole thing, without a laptop:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

> **Prerequisite:** the `RELEASES_TOKEN` repository secret has to exist before the
> first tag. The workflow cannot publish to the releases repo with its own
> `GITHUB_TOKEN`, and the first step fails with instructions if the secret is
> missing — see *Where the artifacts live*.
>
> **Optional, and the difference between an installable release and a
download-only one:** `CSC_LINK`, `CSC_KEY_PASSWORD` and one notarisation
credential set. Without them a release still publishes — ad-hoc signed, with a
`::warning::` saying it is not installable. See *Signing, notarising, and
installing*.

`.github/workflows/release.yml` then:

1. **Guards the tag.** `pnpm release:check "<tag>"` fails in seconds if the tag and
   `package.json` disagree, or if `CHANGELOG.md` has no non-empty section for that
   version. Nothing is built or uploaded until both pass.
2. **Runs `typecheck` and the unit suite.** A tag can point at a commit no pull request
   ever carried. The Electron E2E suite is deliberately *not* repeated here: it is the
   push/PR gate and it needs a GUI session, so making it a release prerequisite would let
   a flaky window launch block a DMG that is already correct.
3. **Resolves the signing identity, then builds and uploads as a draft** (`EP_DRAFT=true`), so
   the assets exist before anyone can see a release with no notes on it. With `CSC_LINK` set the
   build is Developer-ID signed and notarised, and the bundle is verified on the runner before it
   goes anywhere; without it the build is ad-hoc signed and the run emits a `::warning::` that
   this release is not installable. See *Signing, notarising, and installing*.
4. **Verifies the draft** — `pnpm release:verify --allow-draft` reads it back and fails the
   job if the DMG, the ZIP or `latest-mac.yml` is missing, or if the manifest disagrees with
   what was uploaded. The release is still invisible at this point, which is the whole
   reason the check runs here first.
5. **Attaches the changelog and publishes the draft** with `gh release edit`. The body it
   writes opens with a **download link for the DMG** — its name, a human-readable size, the
   SHA-256, and the first-launch instructions — then says what the other assets are for, and
   only then prints the changelog. That order is deliberate: GitHub orders the asset list by
   rules of its own and appends two source archives of its own, so the page led with
   `…-mac.zip` on the first releases and read as "this release is a zip" rather than "this
   release is a DMG".

   > The notes are captured with `pnpm --silent`. Without it, the banner pnpm prints for the
   > script it is running (`> alltherepos@0.1.2 release:check …` plus the runner's absolute
   > path) is captured into the notes file and published as the first line of the release.
6. **Verifies the published release** — `pnpm release:verify`, the same check in the state
   users actually see: `releases/latest` resolves, and the feed the updater reads is the
   thing being asserted on.
7. **Deletes the draft again if the run failed.** A final step that runs only on a failure or
   a cancel reads the release back and removes it *while it is still a draft*, so a run that
   died partway — the assets uploaded, the notes not attached — cannot leave an invisible
   release behind for someone to find later, or for the next run to silently reuse. It does
   not try to publish instead: the assets of a run that failed partway are the ones there is
   least reason to trust. A **published** release is never touched (the verification steps
   above can fail too, and that release is what people are downloading), and neither is the
   tag — it lives in the source repo, so `--cleanup-tag` would aim at the wrong one. If the
   delete does not take, the step fails and says to remove it by hand. The decisions live in
   `scripts/discard-draft-release.mjs` so they can be unit-tested, and the failure path itself
   is provable on demand — see *Proving the failure path* below.

Two phases on purpose: `releases/latest` ignores drafts, so a job that dies between
"assets uploaded" and "notes attached" leaves an invisible draft rather than an empty
release the updater would happily offer. The verification steps bracket that: a broken
upload fails while it is still invisible, and the published release is checked again
because that is the one an update check will actually resolve. The last step then takes the
invisible draft away as well, so a red build leaves nothing behind.

Re-running is safe. While the release is still a draft, electron-builder reuses it and
re-uploads — though a failed run will have deleted it first, so a re-run after a failure
starts from nothing rather than carrying whatever the failed attempt had uploaded. Once
published, electron-builder will not touch it; see the two-hour rule below.

### Proving the failure path

A cleanup that silently does nothing looks exactly like one that works, right up until a
stale draft turns up — which is how `v0.1.1` was found. And the cleanup only runs when a
release has *already* gone wrong, so left alone it is the one piece of this workflow that
never executes. So it can be run on purpose:

```bash
gh workflow run release.yml      # runs the `drill` job
```

The drill creates a **real** draft in the releases repo, with an asset, exactly the way a run
that died mid-upload leaves one; runs the same `scripts/discard-draft-release.mjs` a failed
release would; and fails the job if that draft is still there. It then proves the half that
matters more: it creates a pre-release, runs the cleanup again, and fails if that release was
touched at all.

It aims the cleanup with `--tag`, not by exporting `GITHUB_REF_NAME` from the step: names
with that prefix are reserved, so a step that sets one is **silently ignored** and the script
reads the real value — `main`, the branch a dispatch runs on — instead. That is exactly what
made the drill's first dispatch fail, with the cleanup reporting that there was nothing to
clean up while the draft sat there untouched.

Two safety notes. The published half uses a **pre-release**, deliberately: `releases/latest`
skips pre-releases, so a drill can never become the release the app offers. And every scratch
release the drill creates is deleted again in an `always()` step. That is the one place
`--cleanup-tag` is correct, because it aims at a tag in the releases repo that the drill
itself made, unlike the version tag, which belongs to the source repo. It is also the one
place to be careful with it: a `--draft` release has no tag of its own — GitHub files it
under a placeholder like `untagged-2da6…` — so the step deletes the draft by release alone,
and only cleans a tag up for the pre-release, which does own one.

A dispatch without the `rehearse` input cannot reach the `release` job at all, so the drill is
everything a plain dispatch of that workflow can do.

### Rehearsing a release

The whole pipeline can be run without publishing anything:

```bash
gh workflow run release.yml -f rehearse=true   # by hand, now
```

It runs the same job a tag push runs — the tag/version guard, typecheck, the unit suite, the
native rebuild, packaging, the upload, `release:verify` against its own draft, the notes and
release body a real release would attach, and **the app itself, launched and made to read the
live feed** — with the version, the tag and the draft flag settled differently. The build is
stamped `0.0.0` and uploaded under that tag, the release stays a **draft**, and the run deletes
the draft when it is finished, so a botched rehearsal leaves no more trace than a clean one.

And it runs itself: **every Monday at 14:00 UTC, against `main`**. That is the point of it. A
release pipeline is otherwise only ever exercised *by releasing*, which is the one moment a break
in the guard, the notes step or electron-builder's configuration costs a version that is already
tagged and pushed. Five macOS runner minutes a week is a cheap price for finding that on a quiet
Monday instead. (GitHub disables a scheduled workflow after 60 days without repository activity,
which is the one way this goes quietly idle.)

Three reasons that is safe. `releases/latest` skips drafts, so nothing a rehearsal creates can
reach the update feed at all; `0.0.0` sorts below every released `0.1.x` — so even a scratch
release that somehow escaped could not be offered to an install as an update; and only a tag push
can publish, because inside that job "rehearse" means only "not a push", so a trigger added to
this workflow later rehearses by accident rather than publishing by accident.

It is the *same* job rather than a copy of it on purpose. A rehearsal that ran its own steps
could drift from the ones that ship, which is the thing it exists to prevent.

#### The app the rehearsal launches

The step that launches the build is the one end-to-end claim a tag push cannot make. Everything
before it verifies the **upload** — the three assets exist, the manifest names what was attached —
and none of it runs the thing a person installs. The rehearsal stamps its build `0.0.0`, below
every release, so the app it launches is genuinely behind the feed and has to offer the release
that is live: a version that appears nowhere in the build, and which can therefore only have come
from fetching the feed. It is the same opt-in `tests/e2e/packaged-update-check.spec.ts` a developer
runs by hand, told which bundle to launch with `ATR_PACKAGED_UPDATE_BEHIND_BUNDLE`, rather than a
second copy of the assertion. A bundle named that way has to exist and has to be behind the feed,
because a skip there would report success without asserting anything.

The scratch version dropped its `-rehearse.<run id>` suffix for this, and not for tidiness:
`electron-updater` reads a build whose own version carries a pre-release tag as being on *that*
pre-release's channel and goes looking for releases tagged for it, so `0.0.0-rehearse.7` finds
nothing and reports *No published versions on GitHub*. A plain `0.0.0` takes the path a real
install takes. The tag it uploads under is `v0.0.0` — a name no release will ever want, and one
that a failed run's cleanup removes like any other scratch release, so the next rehearsal reuses
it rather than leaving a trail.

Both ways into the job run that step, and they assert opposite things. A tag push has just published
the version it built, so its check must come back *you're on the latest release* — the state every
install is in once it takes the release. The spec waits up to two minutes for `releases/latest` to
name that version rather than racing a cache that is seconds old, and fails only if it never does,
which is then a release nobody would be offered. A rehearsal is the other half: its build is stamped
`0.0.0`, below every release, so it has to *offer* the release that is live — a version that appears
nowhere in the build, and can therefore only have come from the fetch the check exists to make.

The same run also walks the **install path**, which is the half an Ubuntu runner cannot reach: it
downloads the archive `latest-mac.yml` names, hashes it against the sha512 the manifest promises,
unpacks it, and runs `codesign --verify --deep --strict` on the bundle inside — then checks that
bundle's version is the one the manifest names. A download that hashes correctly and cannot be
launched is still a broken update, and it is the failure nobody sees until the hundred megabytes are
already on disk. On a release that is **Developer-ID signed** it goes further and requires what an
install actually needs: `spctl --assess` accepting the unpacked bundle, and a notarisation ticket
stapled to it — because a signature Gatekeeper will not honour is an update that downloads and
cannot be applied. On an **ad-hoc** release it deliberately stops at `codesign`: Gatekeeper
refusing a downloaded copy is then the documented right-click → Open rather than rot, and the spec
reports which of the two it found instead of deciding for itself which release it is looking at.
On a tag push the archive it verifies is the one that run just published; on a rehearsal it is
the release that is live, which is the previous one.

### Checking the update feed

```bash
node scripts/check-updater-feed.mjs    # by hand
gh workflow run updater-feed.yml       # the same check, on a runner
```

`release:verify` inspects the manifest with a credential, at the moment of publishing, against
the release it was just uploaded with. An install does the opposite of all three: anonymously,
through `releases/latest`, weeks later — and it refuses the archive unless the sha512 in the
manifest matches the bytes it downloaded. Nothing here read the feed that way, so it could rot
in the gap between those two reads: the release deleted, the assets re-uploaded under new names,
the repo turned private. The first symptom would be somebody's app reporting that nothing has
ever been published.

So `.github/workflows/updater-feed.yml` performs that read — `GET /releases/latest` with **no
credential at all**, the live `latest-mac.yml`, and the archive it names, downloaded and hashed.
Exit `0` means the feed is usable, `1` means it is broken (every reason printed), and `2` means
the check could not run for a reason that is **not about the feed** — GitHub allows an
unauthenticated address 60 API requests an hour, and a runner shares its address with every
other job on the machine. The workflow reports `2` and does **not** fail on it, the way the link
check treats a bot wall: a red run there would be somebody else's job, and a gate that cries
wolf is one people stop reading. `3` — no repo to read, or a crash — does fail, because that is
the checker being wrong rather than the world being unavailable.

It has its own workflow rather than a job in `release.yml`, for the reason `pnpm links:check`
left `ci.yml`: it is a gate that has to run when **nothing here changed**, and a feed rots
without a commit — a release deleted, its assets re-uploaded under new names, the releases repo
turned private. `release.yml` is tag-push and dispatch, so a schedule there would wake the whole
release pipeline weekly to fire one job that needs nothing built. So this one runs **weekly** —
Mondays, 13:30 UTC, half an hour behind the link check's own sweep — and on any change to what
it reads: the check itself, the manifest parser and repo lookup it reuses, and the
`electron-builder.yml` publish block that is the feed's address. Its unit tests assert that no request carries an `authorization` header
even when the environment holds a token, because a check that passes merely because the machine
running it is authenticated is the exact failure being guarded against.

### Reporting on the clocks

```bash
node scripts/check-schedule-health.mjs   # by hand
gh workflow run schedule-health.yml      # the same digest, on a runner
```

Four workflows here run on a clock rather than on a push — the link check, the feed check, the
release rehearsal, and this digest itself — and a scheduled workflow is the one kind of gate that
fails by *not happening*.
Nothing goes red, nothing is logged, no notification is sent: the run simply never appears. GitHub
disables scheduled workflows after 60 days without repository activity, one can be disabled by hand
while somebody debugs a cron, a cron can be edited into something GitHub reads differently, and a
`schedule:` added anywhere but the default branch never fires at all — which this repository has
already been through once, with `release.yml` itself.

So `.github/workflows/schedule-health.yml` asks, every Monday at **15:00 UTC** — after the 13:30 and
14:00 sweeps have had their turn, so a gap left that morning is reported that afternoon rather than
the following week. It reads the gates out of the workflow files rather than from a list of its own,
so a schedule added tomorrow is covered the day it lands and one that is deleted stops being
reported on, and it prints a line per gate:

- **A gate that is not `active`** fails the run, whatever its history says.
- **A gate whose last `event=schedule` run is older than its own cadence plus a window** — a day for
a weekly sweep, a few hours for a daily one, half an hour for an hourly one — fails the run. The
window is the point: GitHub runs scheduled workflows on a best-effort basis and delays them under
load, so a window of exactly one period would report ordinary jitter as rot.
- **A gate that has never run on its clock** fails the run only once the workflow itself is older
than that window. A schedule added on a Tuesday has not missed its Monday yet.
- **A gate GitHub has no workflow for** fails the run. That is the branch case, and from here it is
invisible otherwise.

Exit `0` means every clock is ticking; `1` means at least one has gone quiet, with the gate named;
`2` means GitHub could not be read — a rate limit, a 5xx, a lost network — which says nothing about
the gates, so the workflow reports it and does not fail; and `3` means the digest cannot look at
all: no token, a token without `actions: read`, or a cron in a shape it has no window for. That last
one fails loudly on purpose, because a digest that cannot look is the silence it exists to catch.

The one thing it cannot catch is every clock stopping at once: it is itself a scheduled workflow, so
if the whole set goes quiet it goes quiet with them. It answers the question that has an owner — one
gate has stopped while the repository is alive and being pushed to.

### What `release:verify` checks

```bash
pnpm release:verify                  # newest tag: v<package.json version>
pnpm release:verify --tag v0.2.0     # a specific one
pnpm release:verify --allow-draft    # before publishing (what CI does first)
```

It reads the release back over the API — anonymously, since the releases repo is public —
and exits `1` (printing every reason) for: a release still in **draft**, a tag that
disagrees with `package.json`, a missing **`.dmg`**, a missing **`-mac.zip`**, a missing
**`latest-mac.yml`**, a manifest whose version is not the packaged one, a manifest naming a
file the release does not carry, and a manifest size that disagrees with the attached file
— the last one being the signature of a rebuilt asset against a stale manifest.

Two things it only warns about, because they are not always wrong: a release marked
**pre-release** (invisible to `releases/latest`), and `releases/latest` currently resolving
to a **different tag** — a correct release that is still not the one the updater offers.

Exit `2` means the check itself could not run (bad usage, or GitHub refused the request),
so a failure is never mistaken for a verdict.

> **Drafts are hidden from `GET /releases/tags/{tag}`.** GitHub excludes drafts from that
> endpoint, so a draft release answers **404** — which, before this was handled, made the
> workflow's first verification step fail with "no release tagged v0.1.1" while all four
> assets sat on the draft. A 404 is therefore looked up in the releases *list* as well, and
> the assets are read back through the asset API, because a draft's `browser_download_url`
> is not public yet. Both fallbacks need a token: `--allow-draft` is only meaningful with
> `GH_TOKEN` (or `GITHUB_TOKEN`) set, which is why the workflow's step passes
> `RELEASES_TOKEN` into it.

---

## Bumping the version

```bash
pnpm release:next                       # plan: version, section, nothing written
pnpm release:next --level minor         # when the guess is wrong
pnpm release:next --write --tag         # bump both files, commit, tag — still local
pnpm release:next --write --tag --push  # ... and push the tag, which starts CI
```

The section for a version *is* the release's notes, and the version drives the tag,
`app-update.yml` and the updater's comparison — two facts that have to agree and are easy to
get subtly wrong by hand. So they are derived from the commits since the last `v*` tag:

- the **level**, by conventional-commit rules — `!` or a `BREAKING CHANGE` trailer means
  major, any `feat` means minor, anything else means patch;
- the **changelog section**, grouped Added / Changed / Fixed, with whatever you already
  wrote by hand under `[Unreleased]` merged in rather than replaced;
- the **version** in `package.json`, and the changelog's link references.

Nothing is written without `--write`, and nothing leaves the machine without `--push`. That
pause is the approval step, and the reason the default is a plan: read it, then re-run.

Because the baseline is the last `v*` tag, it refuses to run on a repository that has never
been tagged — it cannot tell which commits already shipped, and counting the whole history
would fold released work into the next version. Tag what is already out (`git tag v0.1.0`),
or name a baseline with `--from <ref>`.

---

## Cutting a release

1. **Bump the version** — `pnpm release:next --write --tag` above does both halves:
   `package.json` and the matching `## [<version>]` section in `CHANGELOG.md`. By hand it
   is those two edits, and `pnpm release:check` (which `pnpm release` runs first) refuses
   to let a release go out if they disagree with each other or with the tag.

2. **Build and publish:**

   ```bash
   pnpm release
   ```

   This needs a token that can write to the releases repo — `GH_TOKEN`, or the
   `gh` CLI's own token if that account has access there (`gh auth login`).
   See *Where the artifacts live* below.

3. **Tag.** electron-builder publishes to a release tagged `v<version>` (so
   `v0.1.0` for version `0.1.0`). With `publish.releaseType: release` in
   `electron-builder.yml` that release goes live the moment the upload finishes.
   Run it as `EP_DRAFT=true pnpm release` instead to get a draft you review first,
   then publish it yourself with `gh release edit v<version> --draft=false` — which
   is what CI does. Either way, a draft that stays a draft is a release the updater
   never sees: `releases/latest` skips them.

---

## How updating works today

The app checks GitHub about eight seconds after launch, and whenever you
press **Check for updates** in Settings. When a newer version exists it says
so — and what the button beside it does then depends on one thing: whether
macOS will let *this build* update itself.

**On a Developer-ID signed, notarised build, it installs.** The ZIP the
manifest names is downloaded, a **Restart to install** button appears, and
pressing it relaunches into the new version. That is the real path, through
`electron-updater` and Squirrel.Mac — which is why the signing below is not
cosmetic.

**On an ad-hoc signed build — every build this project makes without an Apple
Developer membership — it offers the DMG instead.** Squirrel.Mac refuses to
install anything that is not validly code-signed *and* accepted by Gatekeeper,
so a silent auto-update would download ~115 MB and then fail at the last step
with an error you couldn't do anything about. So on that build the updater
keeps `autoDownload` off entirely and the button opens the release page.

Which of the two you have is decided at runtime, off the bundle on disk rather
than off the build config — see *Will this build install updates?* below. Those
differ exactly when it matters: a build that silently fell back to ad-hoc
because a certificate was missing, or a copy whose signature broke in transit.

### Where the artifacts live

Releases are published to **`ivy00johns/alltherepos-releases`** — a public repo
holding nothing but the binaries and `latest-mac.yml` — while the source stays
private. That split is the point: a public feed means a shipped copy can check
for updates with an anonymous request, so it works for anyone who installs the
app rather than only on the machine that built it. The app carries no token and
reads none from the environment (`services/updater.ts`).

Two consequences worth knowing:

- **Publishing there needs its own credential.** A workflow's `GITHUB_TOKEN`
  only reaches the repo it runs in, so CI uses a repository secret,
  `RELEASES_TOKEN` — a fine-grained token with `contents: write` on the releases
  repo. `pnpm release` from a laptop uses whatever `GH_TOKEN` the shell has.
- **The feed address is written down three times:** `publish` in
  `electron-builder.yml`, `FEED_OWNER`/`FEED_REPO` in
  `src/main/services/updater.ts`, and `RELEASES_REPO` in the release workflow.
  `tests/unit/main/services/updater-feed.spec.ts` fails if they disagree —
  a mismatch would mean every install quietly checks the wrong repo.

The releases repo also gets the changelog section as its release notes, so write
those expecting them to be public.

### Verifying the check from a real build

Nothing in the ordinary suite can reach this path: `updater.check()` returns
early when the app isn't packaged ("Update checks only run in a packaged
build"), and every Electron spec runs from `out/`. So the feed is covered by an
opt-in spec that launches the real bundle instead:

```bash
pnpm electron:pack          # the current build — the "up to date" branch
pnpm electron:pack-older    # the same app at 0.0.1 — the "newer release" branch
pnpm test:packaged-update   # launches both, against the live feed
```

It needs a **published release** and the **network**: it really does call the
GitHub API, with no token in the child environment, which is the whole point of
the assertion.

The release workflow runs this spec itself, and tells it which half to assert
through the environment:

```bash
ATR_PACKAGED_UPDATE_BEHIND_BUNDLE=<a bundle> pnpm test:packaged-update  # must offer the release that is live
ATR_PACKAGED_UPDATE_EXPECT=current           pnpm test:packaged-update  # must be on the latest release
ATR_REQUIRE_NOTARIZED=1                      pnpm test:packaged-update  # the archive must be signed *and* stapled
```

A bundle named that way has to exist and has to be behind the feed — the caller
asked for that branch, so a skip would be a check that reported success without
asserting anything — while `current` waits for the feed to name the build's own
version before it asks the app, because a tag push does this seconds after
publishing the release it is asserting on.

`ATR_REQUIRE_NOTARIZED` is the other end of the signing promise. Set, the bundle
inside the archive the feed offers must be Developer-ID signed, accepted by
Gatekeeper, and carry a **stapled** notarisation ticket — so a release that
resolved a certificate cannot pass by publishing something unnotarised, which is
the one state that looks signed and still will not launch from a download.
Unset, those assertions run only when the archive turns out to be Developer-ID
signed anyway, which is what lets an ad-hoc release be verified *as* an ad-hoc
release instead of failing for not being something it never claimed to be.

The file's third test needs no packaged app and no bundle name: it works on the
release the live feed offers, whoever built it — the archive `latest-mac.yml`
names, downloaded, hashed against the digest the manifest promises, unpacked, and
verified with `codesign`.

The second build exists because the comparison cannot be faked from outside.
`electron-updater` reads `app.getVersion()` once, when the updater is
constructed, so by the time a test can reach into the running process the
version is already cached — a spoofed version is simply never read.
`-c.extraMetadata.version=0.0.1` makes `app.getVersion()` genuinely report it,
which is what puts the app behind the feed and makes the update affordances
appear.

---

## Signing, notarising, and installing

The whole install path is wired. What is missing on a machine without one — and
the only thing missing — is a certificate: a **Developer ID Application**
certificate, which requires a paid Apple Developer membership ($99/yr).

### Will this build install updates?

`src/main/services/signing.ts` asks that about the *running* bundle, once, at
first use:

- `codesign -dvvv` — is this bundle signed by a **Developer ID Application**
  authority? (`scripts/notarize.mjs` classifies the same output the same way,
  because the two decisions have to agree about what "Developer ID signed"
  means; a unit test drives both with the same fixtures and fails if they ever
  drift.)
- `spctl --assess --type execute` — would *this machine's* Gatekeeper run it?
  That additionally requires the notarisation ticket, stapled to the bundle or
  available from Apple.

Both, or the answer is no. A Developer-ID signed bundle with no ticket passes the
first and fails the second, and it is the second that decides whether an update
can actually be applied. The answer travels in every `UpdateStatus` as
`canInstall` and `signature`, and it is what the UI explains when it offers a
download instead of an install.

That is the whole gate. Nothing else in the app changes behaviour between the
two builds: it checks on the same schedule, against the same feed, and reports
the same way.

### Building one

```bash
security find-identity -v -p codesigning   # is there a Developer ID here at all?
node scripts/signing-identity.mjs          # what would we sign with? ("-" = ad-hoc)
pnpm electron:dist:signed                  # build a signed, notarised DMG + ZIP
```

`scripts/signing-identity.mjs` prints the identity name, or a bare `-` for the
ad-hoc fallback. It deliberately refuses to pick an "Apple Development"
certificate, which the Xcode toolchain creates on demand: that one signs a build
that runs locally and **cannot be notarised**. `pnpm electron:dist:signed` feeds
its answer to electron-builder as `-c.mac.identity=…` and demands notarisation —
the same command-line override `extraMetadata.version` already uses for a
rehearsal, which is why `electron-builder.yml` can keep `identity: "-"` as a
default that works everywhere. `pnpm electron:dist` stays the no-certificate
build.

### What notarisation does, and when it declines

`scripts/notarize.mjs` is electron-builder's `afterSign` hook. It reads
`ATR_NOTARIZE`:

| `ATR_NOTARIZE`  | Behaviour                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------- |
| unset (`auto`)  | Notarise a Developer-ID signed bundle whose credentials are complete. Anything else is skipped, silently. |
| `require`       | Fail unless *both* are true. This is what a tag push sets.                                   |
| `skip`          | Do nothing.                                                                                  |

The `require` mode is the reason the mode exists at all: it makes it impossible
for a release to quietly publish something that looks installable and is not. If
the secrets behind a signed release go missing, the run goes red rather than
shipping a build whose install button does nothing.

Credentials are one of two **complete** sets:

```bash
# App Store Connect API key — preferred: revocable on its own, and it does not
# have to be regenerated whenever the Apple ID password changes.
APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8
APPLE_API_KEY_ID=XXXXXXXXXX
APPLE_API_ISSUER=<uuid>          # Team keys only; omit it for an Individual key

# ... or an Apple ID with an app-specific password.
APPLE_ID=you@example.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=XXXXXXXXXX
```

A *partly* configured set is always an error, naming the variables that are
missing — never a silent skip. "One secret out of three" is a mistake, not an
absent certificate, and the two deserve different answers.

Once Apple accepts the build, the hook checks the result rather than trusting it:
`xcrun stapler validate` has to find the ticket on the bundle, or the run fails. A
missing ticket is exactly the state that looks fine in a log and fails on
somebody else's machine.

None of it needs a build to inspect:

```bash
node scripts/notarize.mjs                # what would happen to release/mac-arm64/AllTheRepos.app
node scripts/notarize.mjs --app <path>   # ... to some other bundle
node scripts/notarize.mjs --notarize     # actually submit it
```

It prints the signature it detected (`developer-id`, `ad-hoc`, `unsigned` or
`unknown`), which credential set it found, whether a ticket is stapled, and the
decision — then exits `1` when the decision is to fail, so it works as a gate and
not only as a report. On this repository's own ad-hoc bundle it says, correctly:

```
[notarize] signature    ad-hoc
[notarize] credentials  none
[notarize] decision     skip — this build is ad-hoc, not Developer-ID signed
```

### In CI

`release.yml` resolves the identity before it packages:

- **With `CSC_LINK` set** — a base64-encoded Developer ID Application `.p12` — it
  imports the certificate into a temporary keychain, points `security` at it,
  requires a Developer ID identity from `scripts/signing-identity.mjs --require`,
  and sets `ATR_NOTARIZE=require` for the rest of the job. After packaging it
  verifies the bundle it built: `codesign --verify --deep --strict` always, and on
  this path also that the authority really is a Developer ID one and that a
  notarisation ticket is stapled. It then tests the install path with
  `ATR_REQUIRE_NOTARIZED=1`, so the archive the feed actually offers is held to
  the same standard as the bundle on the runner.
- **With no `CSC_LINK`** — the fallback. The build is ad-hoc signed,
  `ATR_NOTARIZE=skip`, the release still publishes, and the run emits a
  `::warning::` saying exactly what that means: this release is not installable and
  its updater will offer the DMG. A release is not blocked on a procurement
  decision; it is required to say which kind of release it is.

New repository secrets: `CSC_LINK` and `CSC_KEY_PASSWORD`, plus whichever
notarisation credential set you use. `RELEASES_TOKEN` is unchanged.

Signing also removes the Gatekeeper friction below.

---

## Installing an ad-hoc signed build

This is the **no-certificate fallback** — what `pnpm electron:dist` produces, and
what a CI release produces when its run printed the `::warning::` about not being
installable. To tell which kind of build you are holding:

```bash
codesign -dvvv /Applications/AllTheRepos.app 2>&1 | grep -E 'Authority|Signature='
```

`Authority=Developer ID Application: …` is a signed, notarised build that updates
itself. `Signature=adhoc` is this section. The app says the same thing in words on
its Settings page, because that is where somebody will actually look.

The DMG is ad-hoc signed, which is enough for macOS to _run_ it locally
but not enough for Gatekeeper to trust a copy that was downloaded.

- **Built on this machine:** open it normally — no quarantine flag, no
  warning.
- **Downloaded from GitHub:** macOS will say it "can't be opened". Right-
  click the app → **Open** → **Open**, once. Or clear the flag:

  ```bash
  xattr -dr com.apple.quarantine /Applications/AllTheRepos.app
  ```

Ad-hoc signing (`identity: "-"`) is deliberate and not the same as no
signing. Apple Silicon refuses to execute an arm64 binary with no
signature at all; `identity: null` skips signing entirely and leaves a
bundle that fails `codesign --verify`.

---

## Things that will bite you

- **A draft release is invisible to the updater.** `releases/latest`
  skips drafts. Publish it. A failed CI run deletes the draft it left, so a stale
  one should not outlive a red build — but a draft you made by hand
  (`EP_DRAFT=true pnpm release`) is yours to clean up, and the next run for that
  tag will *reuse* it rather than replace it.
- **Re-running the workflow for a tag whose release is already published uploads
  nothing — and still passes.** electron-publish only reuses an existing release
  when its type matches the one it was asked to publish: with `EP_DRAFT=true`
  and a release that is already live, it logs "GitHub release not created"
  (`reason: "existing type not compatible with publishing type"`) and exits
  successfully. The steps after it — the notes edit and both `release:verify`
  runs — then pass against the release that was already there, so a green run is
  **not** proof that this run uploaded anything. Delete the release first when
  you want the workflow to do the whole job.
- **A published release older than two hours won't accept uploads.**
  electron-builder refuses to reopen a release published more than two hours ago —
  its guard against clobbering something already shipped — and logs "GitHub release
  not created" rather than failing loudly, so a re-run looks successful while
  uploading nothing. Delete the release first, or set `EP_GH_IGNORE_TIME=true`.
- **The release notes come from `CHANGELOG.md`.** No section for the version means
  `release:check` fails and nothing is published.
- **Version and tag must agree.** `package.json` says `0.2.0`, the tag
  must be `v0.2.0`.
- **A repository with no `v*` tag has no baseline.** `release:next` stops rather than
  counting the whole history, which would fold already-released work into the next
  version. Tag the version that shipped, or pass `--from <ref>`.
- **A Developer ID signature is not enough on its own — the *ticket* is what
  Gatekeeper checks.** A bundle can be validly Developer-ID signed and still be
  refused from a download if it was never notarised, or if the ticket was not
  stapled to it. That is why `scripts/notarize.mjs` runs `stapler validate` after
  Apple accepts a build and fails when there is no ticket, and why the app's
  install gate checks `spctl` as well as `codesign`. Sign without notarising and
  the failure looks like "the update downloaded and nothing happened".
- **Ship the ZIP, not just the DMG.** `latest-mac.yml` references the ZIP;
  without it a check succeeds and the download fails.
- **`resources/**/\*`must stay in`files`** in `electron-builder.yml`.
`buildResources` only tells electron-builder where to find build inputs
  — it does not put anything in the bundle. Drop that line and the
  menu-bar icon silently disappears from packaged builds.
- **Native modules are rebuilt per Electron ABI.** `pnpm test` rebuilds
  them for host Node; `pnpm electron:rebuild` puts them back. The release
  scripts do this for you.
