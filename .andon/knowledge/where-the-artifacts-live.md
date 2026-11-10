---
title: Where the artifacts live
tags: [where-the-artifacts-live]
paths: [ivy00johns/alltherepos-releases, latest-mac.yml, services/updater.ts, electron-builder.yml, src/main/services/updater.ts, tests/unit/main/services/updater-feed.spec.ts, scripts/source-release.mjs, ivy00johns/AllTheRepos, scripts/release-notes.mjs, tag/version]
updated: 2026-11-10
---

Imported from `docs/RELEASING.md:458` by Andon (import docs/RELEASING.md:458 cd5ece801f0a86a1); the original stays there.

Releases are published to **`ivy00johns/alltherepos-releases`** — a public repo
holding nothing but the binaries and `latest-mac.yml` — while the source stays
private. A public feed means a shipped copy can check
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

**This repository's Releases tab carries a signpost, not the binaries.** The split
above is right for the app and was wrong for a person browsing the source: an empty
Releases tab reads as "there is no release, so I will build one". So every tag push
also writes a release **here**, at the same tag, with no assets and a body that opens
with the download link, says why the binaries are on the other page, and points out
that the `Source code (zip)` / `(tar.gz)` rows GitHub appends to every release are
the tree rather than an installer. `scripts/source-release.mjs` writes it — run it by
hand for a version that shipped before the job existed, or to repair one:

```bash
GH_TOKEN=... RELEASES_REPO=ivy00johns/alltherepos-releases \
  node scripts/source-release.mjs --tag v0.3.1 --repo ivy00johns/AllTheRepos
node scripts/source-release.mjs --tag v0.3.1 --dry-run   # the body alone, printed
```

It creates the release when the tag has none and edits it when it does, so re-running
after a failed job is safe. The changelog section it carries is extracted by
`scripts/release-notes.mjs`, which means the signpost is also guarded by the same
tag/version check the real release passes first.

`--rehearse` is the flag a rehearsal passes — the weekly run, or a dispatch with `rehearse` — and it
writes the page as a draft at a scratch tag, for that rehearsal to read back and delete. It is
also how the job is proved by hand, on a branch, without publishing a page that points at nothing:

```bash
RELEASES_REPO=ivy00johns/alltherepos-releases \
  node scripts/source-release.mjs --tag 0.0.0-signpost.7 --rehearse \
  --repo ivy00johns/AllTheRepos
```

It refuses a `v` tag. A draft filed at `v0.5.0` would be a release the next real `v0.5.0` could
not create — `gh` answers "already exists" — and being a draft, nothing would say why.
