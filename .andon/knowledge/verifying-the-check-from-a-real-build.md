---
title: Verifying the check from a real build
tags: [verifying-the-check-from-a-real-build]
paths: [latest-mac.yml]
updated: 2026-11-10
---

Imported from `docs/RELEASING.md:515` by Andon (import docs/RELEASING.md:515 5d4b746e4327a5e7); the original stays there.

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
GitHub API, with no token in the child environment.

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
