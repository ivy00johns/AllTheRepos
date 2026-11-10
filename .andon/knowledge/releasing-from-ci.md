---
title: Releasing from CI
tags: [releasing-from-ci]
paths: [.github/workflows/release.yml, package.json, CHANGELOG.md, push/PR, latest-mac.yml, releases/latest, scripts/source-release.mjs, scripts/discard-draft-release.mjs]
updated: 2026-11-10
---

Imported from `docs/RELEASING.md:49` by Andon (import docs/RELEASING.md:49 b210da87a121320c); the original stays there.

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

7. **Points this repository's Releases tab at the download.** A second job, `source-release`,
   writes a release at the same tag **in this repository** carrying no assets, whose body leads
   with the link to the releases repo. It exists because artifacts living elsewhere left this
   repo's Releases tab empty, which reads as "nothing has been released yet" and sends a person
   looking for a build command; `v0.3.1` was published, verified and announced for a day in
   exactly that state. It writes with the workflow's own `GITHUB_TOKEN` rather than
   `RELEASES_TOKEN`, and fails if anything is ever attached to that release — a second copy of the
   DMG would have to be kept in step with `latest-mac.yml` by hand. The body comes from
   `scripts/source-release.mjs`, and the step that reads it back asserts the asset list is
   empty.

   The job also runs in the weekly rehearsal, for the reason the section below gives about the
   rest of the pipeline: it only ever ran on a tag push, which made the one run of it that
   mattered the first run of it. A rehearsal writes the same page as a **draft** at a scratch tag
   (`0.0.0-signpost.<run id>`), reads it back, and deletes it. A draft is what can be written and
   read back without being published — no Releases tab entry, no notification, no tag ref of its
   own — and the last of those is also what keeps the scratch name from matching this workflow's
   `v*` filter and starting a second release.

8. **Deletes the draft again if the run failed.** A final step that runs only on a failure or
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
