---
title: Cutting a release
tags: [cutting-a-release]
paths: [package.json, CHANGELOG.md, electron-builder.yml, releases/latest]
updated: 2026-11-10
---

Imported from `docs/RELEASING.md:406` by Andon (import docs/RELEASING.md:406 425f65b519f5a4f0); the original stays there.

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
