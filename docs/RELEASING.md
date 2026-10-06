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

`.github/workflows/release.yml` then:

1. **Guards the tag.** `pnpm release:check "<tag>"` fails in seconds if the tag and
   `package.json` disagree, or if `CHANGELOG.md` has no non-empty section for that
   version. Nothing is built or uploaded until both pass.
2. **Runs `typecheck` and the unit suite.** A tag can point at a commit no pull request
   ever carried. The Electron E2E suite is deliberately *not* repeated here: it is the
   push/PR gate and it needs a GUI session, so making it a release prerequisite would let
   a flaky window launch block a DMG that is already correct.
3. **Builds and uploads as a draft** (`EP_DRAFT=true`), so the assets exist before anyone
   can see a release with no notes on it.
4. **Verifies the draft** — `pnpm release:verify --allow-draft` reads it back and fails the
   job if the DMG, the ZIP or `latest-mac.yml` is missing, or if the manifest disagrees with
   what was uploaded. The release is still invisible at this point, which is the whole
   reason the check runs here first.
5. **Attaches the changelog and publishes the draft** with `gh release edit`.
6. **Verifies the published release** — `pnpm release:verify`, the same check in the state
   users actually see: `releases/latest` resolves, and the feed the updater reads is the
   thing being asserted on.

Two phases on purpose: `releases/latest` ignores drafts, so a job that dies between
"assets uploaded" and "notes attached" leaves an invisible draft rather than an empty
release the updater would happily offer. The verification steps bracket that: a broken
upload fails while it is still invisible, and the published release is checked again
because that is the one an update check will actually resolve.

Re-running is safe while the release is still a draft — electron-builder reuses it and
re-uploads. Once published it will not touch it; see the two-hour rule below.

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
press **Check for updates** in Settings. When a newer version exists, an
"Update to X" button appears in the top bar; clicking it opens the release
page so you can download the DMG.

**Installing is manual, on purpose.** macOS applies updates through
Squirrel.Mac, which refuses anything that isn't validly code-signed. This
build is ad-hoc signed, not Developer ID signed, so a silent auto-update
would download ~115 MB and then fail at the last step with an error you
couldn't do anything about. Checking is the half that genuinely works, so
that's the half that's wired.

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

The second build exists because the comparison cannot be faked from outside.
`electron-updater` reads `app.getVersion()` once, when the updater is
constructed, so by the time a test can reach into the running process the
version is already cached — a spoofed version is simply never read.
`-c.extraMetadata.version=0.0.1` makes `app.getVersion()` genuinely report it,
which is what puts the app behind the feed and makes the update affordances
appear.

---

## Turning on real auto-update

Everything except the certificate is already in place. Once you have an
Apple Developer account ($99/yr):

1. **Install a Developer ID Application certificate** in the login
   keychain. `security find-identity -v -p codesigning` should list it.

2. **Update `electron-builder.yml`:**

   ```yaml
   mac:
     identity: "Developer ID Application: Your Name (TEAMID)"
     hardenedRuntime: true
     notarize: true
   ```

3. **Provide notarisation credentials** as environment variables:
   `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

4. **Enable installing** in `src/main/services/updater.ts`: set
   `autoUpdater.autoDownload = true`, handle the `update-downloaded`
   event, and call `autoUpdater.quitAndInstall()`. The feed, the version
   comparison, the status stream and the UI are already wired — this is
   the only code change.

Signing also removes the Gatekeeper friction below.

---

## Installing an unsigned build

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
  skips drafts. Publish it.
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
- **Ship the ZIP, not just the DMG.** `latest-mac.yml` references the ZIP;
  without it a check succeeds and the download fails.
- **`resources/**/\*`must stay in`files`** in `electron-builder.yml`.
`buildResources` only tells electron-builder where to find build inputs
  — it does not put anything in the bundle. Drop that line and the
  menu-bar icon silently disappears from packaged builds.
- **Native modules are rebuilt per Electron ABI.** `pnpm test` rebuilds
  them for host Node; `pnpm electron:rebuild` puts them back. The release
  scripts do this for you.
