# Releasing AllTheRepos

How to cut a build you can install, and how updates reach you.

---

## Quick reference

```bash
pnpm icons          # regenerate resources/icon.icns from the design tokens
pnpm electron:dist  # build a local DMG + ZIP into release/ (no publishing)
pnpm release        # build AND publish to GitHub Releases
```

`release/` output:

| File                                  | What it's for                                                          |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `AllTheRepos-<version>-arm64.dmg`     | What a human installs                                                  |
| `AllTheRepos-<version>-arm64-mac.zip` | What the updater reads — Squirrel.Mac can't apply an update from a DMG |
| `latest-mac.yml`                      | The update manifest: version + sha512 of the ZIP                       |

All three must be attached to a release for update checks to work.

---

## Cutting a release

1. **Bump the version** in `package.json`. electron-builder takes the
   version from there, and the updater compares against it — a release
   whose tag doesn't match the packaged version will never be offered.

2. **Build and publish:**

   ```bash
   pnpm release
   ```

   This needs a GitHub token with `repo` scope. It's picked up from
   `GH_TOKEN`, or from the `gh` CLI if you're already logged in
   (`gh auth login`).

3. **Tag.** electron-builder publishes to a release tagged `v<version>`
   (so `v0.1.0` for version `0.1.0`). It creates that release as a draft
   — **publish the draft** or the updater won't see it: `releases/latest`
   ignores drafts.

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

### Why the repo being private matters

The update feed lives on a private repo, so reading it needs a token.
That token is **not** embedded in the app — it's resolved at runtime from
`GH_TOKEN` or the `gh` CLI on the machine running it. That's fine while
you're the only user. It does not generalise: you cannot ship this to
someone else and expect their copy to check for updates.

For a distributable app, move releases somewhere publicly readable — a
separate public repo holding only the binaries, or an S3/R2 bucket — and
point `publish` in `electron-builder.yml` at it.

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
- **Version and tag must agree.** `package.json` says `0.2.0`, the tag
  must be `v0.2.0`.
- **Ship the ZIP, not just the DMG.** `latest-mac.yml` references the ZIP;
  without it a check succeeds and the download fails.
- **`resources/**/\*`must stay in`files`** in `electron-builder.yml`.
`buildResources` only tells electron-builder where to find build inputs
  — it does not put anything in the bundle. Drop that line and the
  menu-bar icon silently disappears from packaged builds.
- **Native modules are rebuilt per Electron ABI.** `pnpm test` rebuilds
  them for host Node; `pnpm electron:rebuild` puts them back. The release
  scripts do this for you.
